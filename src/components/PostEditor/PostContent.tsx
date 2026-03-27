import Note from '@/components/Note'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  createCommentDraftEvent,
  createPollDraftEvent,
  createPublicMessageDraftEvent,
  createPublicMessageReplyDraftEvent,
  createShortTextNoteDraftEvent,
  createHighlightDraftEvent,
  deleteDraftEventCache,
  createVoiceDraftEvent,
  createVoiceCommentDraftEvent,
  createPictureDraftEvent,
  createVideoDraftEvent,
  createLongFormArticleDraftEvent,
  createWikiArticleDraftEvent,
  createWikiArticleMarkdownDraftEvent,
  createPublicationContentDraftEvent,
  createCitationInternalDraftEvent,
  createCitationExternalDraftEvent,
  createCitationHardcopyDraftEvent,
  createCitationPromptDraftEvent,
  createGitReleaseDraftEvent
} from '@/lib/draft-event'
import { ExtendedKind } from '@/constants'
import { parseRepoOwnerPubkeyInput } from '@/lib/git-republic-event'
import { cn, isTouchDevice } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useReply } from '@/providers/ReplyProvider'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import { normalizeUrl, rewritePlainTextHttpUrls } from '@/lib/url'
import logger from '@/lib/logger'
import postEditorCache from '@/services/post-editor-cache.service'
import storage from '@/services/local-storage.service'
import { TPollCreateData } from '@/types'
import {
  ImageUp,
  ListTodo,
  MessageCircle,
  MessagesSquare,
  Settings,
  Smile,
  X,
  Highlighter,
  FileText,
  Quote,
  Upload,
  Mic,
  Music,
  Video,
  Film,
  Laugh
} from 'lucide-react'
import { getMediaKindFromFile } from '@/lib/media-kind-detection'
import { hasPrivateRelays, getPrivateRelayUrls } from '@/lib/private-relays'
import mediaUpload from '@/services/media-upload.service'
import { successfulPublishRelayUrls, type TRelayPublishStatus } from '@/lib/publish-relay-urls'
import client, { eventService } from '@/services/client.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import noteStatsService from '@/services/note-stats.service'
import CreateThreadDialog from '@/pages/primary/DiscussionsPage/CreateThreadDialog'
import { getReplaceableCoordinateFromEvent, isProtectedEvent as isEventProtected, isReplaceableEvent, isReplyNoteEvent } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import EmojiPickerDialog from '../EmojiPickerDialog'
import GifPicker from '../GifPicker'
import MemePicker from '../MemePicker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Mentions, { extractMentions } from './Mentions'
import PollEditor from './PollEditor'
import PostOptions from './PostOptions'
import PostRelaySelector from './PostRelaySelector'
import PostTextarea, { TPostTextareaHandle } from './PostTextarea'
import { NeventPickerProvider } from './PostTextarea/Mention/NeventNaddrPickerDialog'
import { MentionAndEventToolbarButtons } from './PostTextarea/Mention/MentionAndEventToolbarButtons'
import Uploader from './Uploader'
import HighlightEditor, { HighlightData } from './HighlightEditor'

export default function PostContent({
  defaultContent = '',
  parentEvent,
  close,
  openFrom,
  initialHighlightData,
  initialPublicMessageTo,
  onPublishSuccess
}: {
  defaultContent?: string
  parentEvent?: Event
  close: () => void
  openFrom?: string[]
  initialHighlightData?: HighlightData
  /** When set, opens in public message mode with this pubkey in the mention list. */
  initialPublicMessageTo?: string
  /** Called after a reply/post is successfully published, before closing. */
  onPublishSuccess?: () => void
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const { feedInfo } = useFeed()
  const { addReplies } = useReply()

  const mergePublishedReplyIntoThread = useCallback(
    (reply: Event, relayStatuses?: TRelayPublishStatus[]) => {
      if (!parentEvent) return
      const clean = { ...reply } as Event
      delete (clean as any).relayStatuses
      addReplies([clean])
      const isQuotePost = clean.tags.some((t) => t[0] === 'q' && t[1])
      noteStatsService.updateNoteStatsByEvents(
        [clean],
        undefined,
        isQuotePost ? undefined : { replyParentNoteId: parentEvent.id }
      )
      const rootInfo =
        parentEvent.kind === ExtendedKind.RSS_THREAD_ROOT
          ? (() => {
              const articleUrl = getArticleUrlFromCommentITags(parentEvent)
              if (articleUrl) {
                return {
                  type: 'I' as const,
                  id: canonicalizeRssArticleUrl(articleUrl)
                }
              }
              return { type: 'E' as const, id: parentEvent.id, pubkey: parentEvent.pubkey }
            })()
          : !isReplaceableEvent(parentEvent.kind)
            ? { type: 'E' as const, id: parentEvent.id, pubkey: parentEvent.pubkey }
            : {
                type: 'A' as const,
                id: getReplaceableCoordinateFromEvent(parentEvent),
                eventId: parentEvent.id,
                pubkey: parentEvent.pubkey,
                relay: client.getEventHint(parentEvent.id)
              }
      const cached = discussionFeedCache.getCachedReplies(rootInfo) ?? []
      const next = cached.filter((r) => r.id !== clean.id).concat([clean])
      discussionFeedCache.setCachedReplies(rootInfo, next)

      const urls = successfulPublishRelayUrls(relayStatuses)
      if (!clean.id || urls.length === 0) return

      const delayMs = 1600
      setTimeout(() => {
        void eventService.fetchEventWithExternalRelays(clean.id, urls).then((fresh) => {
          if (!fresh || fresh.id !== clean.id) return
          addReplies([fresh])
          const merged = (discussionFeedCache.getCachedReplies(rootInfo) ?? []).filter((r) => r.id !== fresh.id)
          discussionFeedCache.setCachedReplies(rootInfo, [...merged, fresh])
          client.addEventToCache(fresh)
        })
      }, delayMs)
    },
    [addReplies, parentEvent]
  )
  const [text, setText] = useState('')
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const [posting, setPosting] = useState(false)
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void }[]
  >([])
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [addClientTag, setAddClientTag] = useState(() => storage.getAddClientTag())
  const [mentions, setMentions] = useState<string[]>([])
  const [isNsfw, setIsNsfw] = useState(false)
  const [isPoll, setIsPoll] = useState(false)
  const [isPublicMessage, setIsPublicMessage] = useState(!!initialPublicMessageTo)
  const [extractedMentions, setExtractedMentions] = useState<string[]>(
    initialPublicMessageTo ? [initialPublicMessageTo] : []
  )
  const [isProtectedEvent, setIsProtectedEvent] = useState(false)
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  const [isHighlight, setIsHighlight] = useState(!!initialHighlightData)
  const [highlightData, setHighlightData] = useState<HighlightData>(
    initialHighlightData || {
      sourceType: 'nostr',
      sourceValue: ''
    }
  )
  const [pollCreateData, setPollCreateData] = useState<TPollCreateData>({
    isMultipleChoice: false,
    options: ['', ''],
    endsAt: undefined,
    relays: []
  })
  const [minPow, setMinPow] = useState(0)
  const [createThreadOpen, setCreateThreadOpen] = useState(false)
  const [mediaNoteKind, setMediaNoteKind] = useState<number | null>(null)
  const [mediaImetaTags, setMediaImetaTags] = useState<string[][]>([])
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [isLongFormArticle, setIsLongFormArticle] = useState(false)
  const [isWikiArticle, setIsWikiArticle] = useState(false)
  const [isWikiArticleMarkdown, setIsWikiArticleMarkdown] = useState(false)
  const [isPublicationContent, setIsPublicationContent] = useState(false)
  const [articleTitle, setArticleTitle] = useState('')
  const [articleDTag, setArticleDTag] = useState('')
  const [articleImage, setArticleImage] = useState('')
  const [articleSubject, setArticleSubject] = useState('')
  const [articleSummary, setArticleSummary] = useState('')
  const [isCitationInternal, setIsCitationInternal] = useState(false)
  const [isCitationExternal, setIsCitationExternal] = useState(false)
  const [isCitationHardcopy, setIsCitationHardcopy] = useState(false)
  const [isCitationPrompt, setIsCitationPrompt] = useState(false)
  
  // Citation metadata fields
  // Internal Citation (30)
  const [citationInternalCTag, setCitationInternalCTag] = useState('')
  const [citationInternalRelayHint, setCitationInternalRelayHint] = useState('')
  // External Citation (31) 
  const [citationExternalUrl, setCitationExternalUrl] = useState('')
  const [citationExternalOpenTimestamp, setCitationExternalOpenTimestamp] = useState('')
  // Hardcopy Citation (32)
  const [citationHardcopyPageRange, setCitationHardcopyPageRange] = useState('')
  const [citationHardcopyChapterTitle, setCitationHardcopyChapterTitle] = useState('')
  const [citationHardcopyEditor, setCitationHardcopyEditor] = useState('')
  const [citationHardcopyPublishedIn, setCitationHardcopyPublishedIn] = useState('')
  const [citationHardcopyVolume, setCitationHardcopyVolume] = useState('')
  const [citationHardcopyDoi, setCitationHardcopyDoi] = useState('')
  // Prompt Citation (33)
  const [citationPromptLlm, setCitationPromptLlm] = useState('')
  // Shared citation fields
  const [citationTitle, setCitationTitle] = useState('')
  const [citationAuthor, setCitationAuthor] = useState('')
  const [citationPublishedOn, setCitationPublishedOn] = useState('')
  const [citationPublishedBy, setCitationPublishedBy] = useState('')
  const [citationAccessedOn, setCitationAccessedOn] = useState('')
  const [citationLocation, setCitationLocation] = useState('')
  const [citationGeohash, setCitationGeohash] = useState('')
  const [citationVersion, setCitationVersion] = useState('')
  const [citationSummary, setCitationSummary] = useState('')
  const [isGitRelease, setIsGitRelease] = useState(false)
  const [releaseRepoOwnerInput, setReleaseRepoOwnerInput] = useState('')
  const [releaseRepoId, setReleaseRepoId] = useState('')
  const [releaseTagName, setReleaseTagName] = useState('')
  const [releaseTagHash, setReleaseTagHash] = useState('')
  const [releaseTitle, setReleaseTitle] = useState('')
  const [releaseDownloadUrl, setReleaseDownloadUrl] = useState('')
  const [releaseDraft, setReleaseDraft] = useState(false)
  const [releasePrerelease, setReleasePrerelease] = useState(false)

  const [hasPrivateRelaysAvailable, setHasPrivateRelaysAvailable] = useState(false)
  const [showMediaKindDialog, setShowMediaKindDialog] = useState(false)
  const [pendingMediaUpload, setPendingMediaUpload] = useState<{ url: string; tags: string[][]; file: File } | null>(null)
  const uploadedMediaFileMap = useRef<Map<string, File>>(new Map())
  /** Accumulates imeta tags for kind 20 (picture) so multiple rapid uploads don’t overwrite each other. */
  const pictureImetaTagsRef = useRef<string[][]>([])
  useEffect(() => {
    if (mediaNoteKind === ExtendedKind.PICTURE && mediaImetaTags.length > 0) {
      pictureImetaTagsRef.current = mediaImetaTags
    }
  }, [mediaNoteKind, mediaImetaTags])
  const isFirstRender = useRef(true)
  const releaseFieldsOk = useMemo(() => {
    if (!isGitRelease) return true
    const owner = parseRepoOwnerPubkeyInput(releaseRepoOwnerInput)
    return (
      !!owner &&
      !!releaseRepoId.trim() &&
      !!releaseTagName.trim() &&
      /^[0-9a-f]{40}$/i.test(releaseTagHash.trim())
    )
  }, [isGitRelease, releaseRepoOwnerInput, releaseRepoId, releaseTagName, releaseTagHash])

  const canPost = useMemo(() => {
    const isArticle = isLongFormArticle || isWikiArticle || isWikiArticleMarkdown || isPublicationContent
    const result = (
      !!pubkey &&
      !posting &&
      !uploadProgresses.length &&
      // For media notes, text is optional - just need media; Git releases use the editor as release notes (optional)
      ((mediaNoteKind !== null && mediaUrl) || !!text || isGitRelease) &&
      (!isPoll || pollCreateData.options.filter((option) => !!option.trim()).length >= 2) &&
      (!isPublicMessage || extractedMentions.length > 0 || parentEvent?.kind === ExtendedKind.PUBLIC_MESSAGE) &&
      (!isProtectedEvent || additionalRelayUrls.length > 0) &&
      (!isHighlight || highlightData.sourceValue.trim() !== '') &&
      // For articles, dTag is mandatory
      (!isArticle || !!articleDTag.trim()) &&
      (!isGitRelease || releaseFieldsOk) &&
      // For citations, required fields must be filled
      (!isCitationInternal || !!citationInternalCTag.trim()) &&
      (!isCitationExternal || (!!citationExternalUrl.trim() && !!citationAccessedOn.trim())) &&
      (!isCitationHardcopy || !!citationAccessedOn.trim()) &&
      (!isCitationPrompt || (!!citationPromptLlm.trim() && !!citationAccessedOn.trim()))
    )
    
    return result
  }, [
    pubkey,
    text,
    posting,
    uploadProgresses,
    mediaNoteKind,
    mediaUrl,
    isPoll,
    pollCreateData,
    isPublicMessage,
    extractedMentions,
    parentEvent?.kind,
    isProtectedEvent,
    additionalRelayUrls,
    isHighlight,
    highlightData,
    isLongFormArticle,
    isWikiArticle,
    isWikiArticleMarkdown,
    isPublicationContent,
    articleDTag,
    isGitRelease,
    releaseFieldsOk,
    isCitationInternal,
    citationInternalCTag,
    isCitationExternal,
    citationExternalUrl,
    citationAccessedOn,
    isCitationHardcopy,
    isCitationPrompt,
    citationPromptLlm
  ])

  // Clear highlight data when initialHighlightData changes or is removed
  useEffect(() => {
    if (initialHighlightData) {
      // Set highlight mode and data when provided
      setIsHighlight(true)
      setHighlightData(initialHighlightData)
    } else {
      // Clear highlight mode and data when not provided
      setIsHighlight(false)
      setHighlightData({
        sourceType: 'nostr',
        sourceValue: ''
      })
    }
  }, [initialHighlightData])

  // Extract mentions from content for public messages
  const extractMentionsFromContent = useCallback(async (content: string) => {
    try {
      // Extract nostr: protocol mentions
      const { pubkeys: nostrPubkeys } = await extractMentions(content, undefined)
      
      // For now, we'll use the nostr mentions
      // In a real implementation, you'd also resolve @ mentions to pubkeys
      setExtractedMentions(nostrPubkeys)
    } catch (error) {
      logger.error('Error extracting mentions', { error })
      setExtractedMentions([])
    }
  }, [])

  useEffect(() => {
    if (!text) {
      if (!initialPublicMessageTo) setExtractedMentions([])
      return
    }

    // Debounce the mention extraction for all posts (not just public messages)
    const timeoutId = setTimeout(() => {
      extractMentionsFromContent(text)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [text, extractMentionsFromContent, initialPublicMessageTo])

  // Check for private relays availability
  useEffect(() => {
    if (!pubkey) {
      setHasPrivateRelaysAvailable(false)
      return
    }
    
    hasPrivateRelays(pubkey).then(setHasPrivateRelaysAvailable).catch(() => {
      setHasPrivateRelaysAvailable(false)
    })
  }, [pubkey])

  // Helper function to determine the kind that will be created
  const getDeterminedKind = useMemo((): number => {
    // Public messages always take priority - even with media, they stay as PMs
    if (isPublicMessage) {
      return ExtendedKind.PUBLIC_MESSAGE
    } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
      return ExtendedKind.PUBLIC_MESSAGE
    }
    
    // For voice comments in replies, check mediaNoteKind even if mediaUrl is not set yet (for preview)
    if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
      return ExtendedKind.VOICE_COMMENT
    } else if (mediaNoteKind !== null && mediaUrl) {
      return mediaNoteKind
    } else if (isLongFormArticle) {
      return kinds.LongFormArticle
    } else if (isWikiArticle) {
      return ExtendedKind.WIKI_ARTICLE
    } else if (isWikiArticleMarkdown) {
      return ExtendedKind.WIKI_ARTICLE_MARKDOWN
    } else if (isPublicationContent) {
      return ExtendedKind.PUBLICATION_CONTENT
    } else if (isGitRelease) {
      return ExtendedKind.GIT_RELEASE
    } else if (isCitationInternal) {
      return ExtendedKind.CITATION_INTERNAL
    } else if (isCitationExternal) {
      return ExtendedKind.CITATION_EXTERNAL
    } else if (isCitationHardcopy) {
      return ExtendedKind.CITATION_HARDCOPY
    } else if (isCitationPrompt) {
      return ExtendedKind.CITATION_PROMPT
    } else if (isHighlight) {
      return kinds.Highlights
    } else if (isPoll) {
      return ExtendedKind.POLL
    } else if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
      return ExtendedKind.COMMENT
    } else {
      return kinds.ShortTextNote
    }
  }, [
    mediaNoteKind,
    mediaUrl,
    isLongFormArticle,
    isWikiArticle,
    isWikiArticleMarkdown,
    isPublicationContent,
    isGitRelease,
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isHighlight,
    isPublicMessage,
    isPoll,
    parentEvent
  ])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      const cachedSettings = postEditorCache.getPostSettingsCache({
        kind: getDeterminedKind,
        defaultContent,
        parentEvent
      })
      if (cachedSettings) {
        setIsNsfw(cachedSettings.isNsfw ?? false)
        setIsPoll(cachedSettings.isPoll ?? false)
        setPollCreateData(
          cachedSettings.pollCreateData ?? {
            isMultipleChoice: false,
            options: ['', ''],
            endsAt: undefined,
            relays: []
          }
        )
        setAddClientTag(cachedSettings.addClientTag ?? storage.getAddClientTag())
      }
      return
    }
    postEditorCache.setPostSettingsCache(
      { kind: getDeterminedKind, defaultContent, parentEvent },
      {
        isNsfw,
        isPoll,
        pollCreateData,
        addClientTag
      }
    )
  }, [getDeterminedKind, defaultContent, parentEvent, isNsfw, isPoll, pollCreateData, addClientTag])

  const rssReplyExtraPreviewTags = useMemo((): string[][] | undefined => {
    if (!parentEvent || parentEvent.kind !== ExtendedKind.RSS_THREAD_ROOT) return undefined
    const raw =
      parentEvent.tags.find((t) => t[0] === 'I')?.[1] ??
      parentEvent.tags.find((t) => t[0] === 'i')?.[1]
    if (!raw) return undefined
    const c = canonicalizeRssArticleUrl(raw)
    return [['i', c], ['I', c]]
  }, [parentEvent])

  // Shared function to create draft event - used by both preview and posting
  const createDraftEvent = useCallback(async (cleanedText: string): Promise<any> => {
    // Get expiration and quiet settings
    const isChattingKind = (kind: number) => 
      kind === kinds.ShortTextNote || 
      kind === ExtendedKind.COMMENT || 
      kind === ExtendedKind.VOICE || 
      kind === ExtendedKind.VOICE_COMMENT
    
    const addExpirationTag = storage.getDefaultExpirationEnabled()
    const expirationMonths = storage.getDefaultExpirationMonths()
    const addQuietTag = storage.getDefaultQuietEnabled()
    const quietDays = storage.getDefaultQuietDays()
    
    // Determine if we should use protected event tag
    let shouldUseProtectedEvent = false
    if (parentEvent) {
      const isParentOP = !isReplyNoteEvent(parentEvent)
      const parentHasProtectedTag = isEventProtected(parentEvent)
      shouldUseProtectedEvent = isParentOP && parentHasProtectedTag
    }

    // Public messages - check BEFORE media notes to ensure PMs with media stay as PMs
    if (isPublicMessage) {
      return await createPublicMessageDraftEvent(cleanedText, extractedMentions, {
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays,
        mediaImetaTags: mediaNoteKind !== null && mediaUrl ? mediaImetaTags : undefined
      })
    } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
      // For PM replies, always create PM even if there's media
      return await createPublicMessageReplyDraftEvent(cleanedText, parentEvent, mentions, {
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays,
        mediaImetaTags: mediaNoteKind !== null && mediaUrl ? mediaImetaTags : undefined
      })
    }

    // Check for voice comments (only for non-PM replies)
    if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
      const url = mediaUrl || 'placeholder://audio'
      const tags = mediaImetaTags.length > 0 ? mediaImetaTags : [['imeta', `url ${url}`, 'm audio/mpeg']]
      return await createVoiceCommentDraftEvent(
        cleanedText,
        parentEvent,
        url,
        tags,
        mentions,
        {
          addClientTag,
          protectedEvent: shouldUseProtectedEvent,
          isNsfw,
          addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.VOICE_COMMENT),
          expirationMonths,
          addQuietTag,
          quietDays
        }
      )
    }

    // Media notes
    if (mediaNoteKind !== null && mediaUrl) {
      if (mediaNoteKind === ExtendedKind.VOICE) {
        return await createVoiceDraftEvent(
          cleanedText,
          mediaUrl,
          mediaImetaTags,
          mentions,
          {
            addClientTag,
            isNsfw,
            addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.VOICE),
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
      } else if (mediaNoteKind === ExtendedKind.PICTURE) {
        return await createPictureDraftEvent(
          cleanedText,
          mediaImetaTags,
          mentions,
          {
            addClientTag,
            isNsfw,
            addExpirationTag: false,
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
      } else if (mediaNoteKind === ExtendedKind.VIDEO || mediaNoteKind === ExtendedKind.SHORT_VIDEO) {
        return await createVideoDraftEvent(
          cleanedText,
          mediaImetaTags,
          mentions,
          mediaNoteKind,
          {
            addClientTag,
            isNsfw,
            addExpirationTag: false,
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
      }
    }

    // Parse topics from subject field for articles
    const topics = articleSubject.trim()
      ? articleSubject.split(/[,\s]+/).filter(s => s.trim())
      : []

    // Articles
    if (isLongFormArticle) {
      return await createLongFormArticleDraftEvent(cleanedText, mentions, {
        dTag: articleDTag.trim(),
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays
      })
    } else if (isWikiArticle) {
      return await createWikiArticleDraftEvent(cleanedText, mentions, {
        dTag: articleDTag.trim(),
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays
      })
    } else if (isWikiArticleMarkdown) {
      return await createWikiArticleMarkdownDraftEvent(cleanedText, mentions, {
        dTag: articleDTag.trim(),
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays
      })
    } else if (isPublicationContent) {
      return await createPublicationContentDraftEvent(cleanedText, mentions, {
        dTag: articleDTag.trim(),
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays
      })
    }

    if (isGitRelease) {
      const ownerHex = parseRepoOwnerPubkeyInput(releaseRepoOwnerInput)
      if (!ownerHex) {
        throw new Error(t('Invalid repository owner pubkey'))
      }
      return createGitReleaseDraftEvent(cleanedText, {
        repoOwnerPubkey: ownerHex,
        repoId: releaseRepoId.trim(),
        tagName: releaseTagName.trim(),
        tagHash: releaseTagHash.trim().toLowerCase(),
        title: releaseTitle.trim() || undefined,
        downloadUrl: releaseDownloadUrl.trim() || undefined,
        isDraft: releaseDraft,
        isPrerelease: releasePrerelease
      })
    }

    // Citations
    if (isCitationInternal) {
      return createCitationInternalDraftEvent(cleanedText, {
        cTag: citationInternalCTag.trim(),
        relayHint: citationInternalRelayHint.trim() || undefined,
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() || undefined,
        accessedOn: citationAccessedOn.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        summary: citationSummary.trim() || undefined
      })
    } else if (isCitationExternal) {
      return createCitationExternalDraftEvent(cleanedText, {
        url: citationExternalUrl.trim(),
        accessedOn: citationAccessedOn.trim() || new Date().toISOString(),
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() || undefined,
        publishedBy: citationPublishedBy.trim() || undefined,
        version: citationVersion.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        openTimestamp: citationExternalOpenTimestamp.trim() || undefined,
        summary: citationSummary.trim() || undefined
      })
    } else if (isCitationHardcopy) {
      // Convert date strings to ISO 8601 format if they exist
      const formatDateToISO = (dateStr: string): string => {
        if (!dateStr || !dateStr.trim()) return ''
        // If already in ISO format, return as is
        if (dateStr.includes('T')) return dateStr
        // If in YYYY-MM-DD format, convert to ISO
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return new Date(dateStr + 'T00:00:00Z').toISOString()
        }
        return dateStr
      }
      
      const hardcopyOptions = {
        accessedOn: formatDateToISO(citationAccessedOn.trim()) || new Date().toISOString(),
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        pageRange: citationHardcopyPageRange.trim() || undefined,
        chapterTitle: citationHardcopyChapterTitle.trim() || undefined,
        editor: citationHardcopyEditor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() ? formatDateToISO(citationPublishedOn.trim()) : undefined,
        publishedBy: citationPublishedBy.trim() || undefined,
        publishedIn: citationHardcopyPublishedIn.trim() || undefined,
        volume: citationHardcopyVolume.trim() || undefined,
        doi: citationHardcopyDoi.trim() || undefined,
        version: citationVersion.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        summary: citationSummary.trim() || undefined
      }
      
      return createCitationHardcopyDraftEvent(cleanedText, hardcopyOptions)
    } else if (isCitationPrompt) {
      return createCitationPromptDraftEvent(cleanedText, {
        llm: citationPromptLlm.trim(),
        accessedOn: citationAccessedOn.trim() || new Date().toISOString(),
        version: citationVersion.trim() || undefined,
        summary: citationSummary.trim() || undefined,
        url: citationExternalUrl.trim() || undefined
      })
    }

    // Highlights
    if (isHighlight) {
      return await createHighlightDraftEvent(
        cleanedText,
        highlightData.sourceType,
        highlightData.sourceValue,
        highlightData.context,
        undefined,
        {
          addClientTag,
          isNsfw,
          addExpirationTag: false,
          expirationMonths,
          addQuietTag,
          quietDays
        }
      )
    }


    // Comments and replies
    if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
      return await createCommentDraftEvent(cleanedText, parentEvent, mentions, {
        addClientTag,
        protectedEvent: shouldUseProtectedEvent,
        isNsfw,
        addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.COMMENT),
        expirationMonths,
        addQuietTag,
        quietDays
      })
    }

    // Polls
    if (isPoll) {
      return await createPollDraftEvent(pubkey!, cleanedText, mentions, pollCreateData, {
        addClientTag,
        isNsfw,
        addExpirationTag: false,
        expirationMonths,
        addQuietTag,
        quietDays
      })
    }

    // Default: Short text note
    return await createShortTextNoteDraftEvent(cleanedText, mentions, {
      parentEvent,
      addClientTag,
      protectedEvent: shouldUseProtectedEvent,
      isNsfw,
      addExpirationTag: addExpirationTag && isChattingKind(kinds.ShortTextNote),
      expirationMonths,
      addQuietTag,
      quietDays
    })
  }, [
    parentEvent,
    mediaNoteKind,
    mediaUrl,
    mediaImetaTags,
    mentions,
    isLongFormArticle,
    isWikiArticle,
    isWikiArticleMarkdown,
    isPublicationContent,
    isGitRelease,
    releaseRepoOwnerInput,
    releaseRepoId,
    releaseTagName,
    releaseTagHash,
    releaseTitle,
    releaseDownloadUrl,
    releaseDraft,
    releasePrerelease,
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isHighlight,
    highlightData,
    isPublicMessage,
    extractedMentions,
    isPoll,
    pollCreateData,
    addClientTag,
    isNsfw,
    articleDTag,
    articleTitle,
    articleImage,
    articleSubject,
    articleSummary,
    pubkey,
    t
  ])

  // Function to generate draft event JSON for preview
  const getDraftEventJson = useCallback(async (): Promise<string> => {
    // For articles, validate dTag is provided
    const isArticle = isLongFormArticle || isWikiArticle || isWikiArticleMarkdown || isPublicationContent
    if (isArticle && !articleDTag.trim()) {
      throw new Error(t('D-Tag is required for articles'))
    }
    if (isGitRelease && !releaseFieldsOk) {
      throw new Error(t('Fill repository release fields'))
    }

    if (!pubkey) {
      return JSON.stringify({ error: 'Not logged in' }, null, 2)
    }

    try {
      // Clean tracking parameters from URLs in the post content
      const cleanedText = rewritePlainTextHttpUrls(text)
      
      const draftEvent = await createDraftEvent(cleanedText)
      return JSON.stringify(draftEvent, null, 2)
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)
    }
  }, [
    text,
    pubkey,
    isLongFormArticle,
    isWikiArticle,
    isWikiArticleMarkdown,
    isPublicationContent,
    articleDTag,
    isGitRelease,
    releaseFieldsOk,
    createDraftEvent,
    t
  ])

  const post = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    checkLogin(async () => {
      if (!canPost) {
        logger.warn('Attempted to post while canPost is false')
        return
      }

      // console.log('🚀 Starting post process:', {
      //   isPublicMessage,
      //   parentEventKind: parentEvent?.kind,
      //   parentEventId: parentEvent?.id,
      //   text: text.substring(0, 50) + '...',
      //   mentions: mentions.length,
      //   canPost
      // })

      setPosting(true)
      let newEvent: any = null
      let draftEvent: any = null
      
      try {
        // Clean tracking parameters from URLs in the post content
        const cleanedText = rewritePlainTextHttpUrls(text)
        
        // Determine relay URLs for private events
        let privateRelayUrls: string[] = []
        const isPrivateEvent = isPublicationContent || isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt
        if (isPrivateEvent) {
          // Use all private relays (outbox + cache)
          privateRelayUrls = await getPrivateRelayUrls(pubkey!)
        }

        // Create draft event using shared function
        draftEvent = await createDraftEvent(cleanedText)

        // console.log('Publishing draft event:', draftEvent)
        // For private events, only publish to private relays
        const relayUrls = isPrivateEvent && privateRelayUrls.length > 0 
          ? privateRelayUrls 
          : (additionalRelayUrls.length > 0 ? additionalRelayUrls : undefined)
        
        newEvent = await publish(draftEvent, {
          specifiedRelayUrls: relayUrls,
          additionalRelayUrls: isPoll ? pollCreateData.relays : (isPrivateEvent ? privateRelayUrls : additionalRelayUrls),
          minPow,
          disableFallbacks: additionalRelayUrls.length > 0 || isPrivateEvent, // Don't use fallbacks if user explicitly selected relays or for private events
          addClientTag
        })
        // console.log('Published event:', newEvent)
        
        // Check if we need to refresh the current relay view
        if (feedInfo.feedType === 'relay' && feedInfo.id) {
          const currentRelayUrl = normalizeUrl(feedInfo.id)
          const publishedRelays = additionalRelayUrls
          
          // If we published to the current relay being viewed, trigger a refresh after a short delay
          if (publishedRelays.some(url => normalizeUrl(url) === currentRelayUrl)) {
            setTimeout(() => {
              // Trigger a page refresh by dispatching a custom event that the relay view can listen to
              window.dispatchEvent(new CustomEvent('relay-refresh-needed', { 
                detail: { relayUrl: currentRelayUrl } 
              }))
            }, 1000) // 1 second delay to allow the event to propagate
          }
        }
        
        // Show publishing feedback
        if ((newEvent as any).relayStatuses) {
          showPublishingFeedback({
            success: true,
            relayStatuses: (newEvent as any).relayStatuses,
            successCount: (newEvent as any).relayStatuses.filter((s: any) => s.success).length,
            totalCount: (newEvent as any).relayStatuses.length
          }, {
            message: parentEvent ? t('Reply published') : t('Post published'),
            duration: 6000
          })
        } else {
          showSimplePublishSuccess(parentEvent ? t('Reply published') : t('Post published'))
        }
        
        // Full success - clean up and close
        postEditorCache.clearPostCache({ kind: getDeterminedKind, defaultContent, parentEvent })
        deleteDraftEventCache(draftEvent)
        const relayStatuses = (newEvent as any).relayStatuses as TRelayPublishStatus[] | undefined
        const cleanEvent = { ...newEvent }
        delete (cleanEvent as any).relayStatuses

        if (parentEvent) {
          mergePublishedReplyIntoThread(cleanEvent, relayStatuses)
        }

        onPublishSuccess?.()
        close()
      } catch (error) {
        // AggregateError = "Failed to publish to any relay" is already logged in NostrProvider with relayStatuses; avoid duplicate noise
        if (!(error instanceof AggregateError && error.message === 'Failed to publish to any relay')) {
          logger.error('Publishing error', { error })
          logger.error('Publishing error details', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          })
        }

        // Check if we have relay statuses to display (even if publishing failed)
        if (error instanceof AggregateError && (error as any).relayStatuses) {
          const relayStatuses = (error as any).relayStatuses
          const successCount = relayStatuses.filter((s: any) => s.success).length
          const totalCount = relayStatuses.length
          
          // Show proper relay status feedback
          showPublishingFeedback({
            success: successCount > 0,
            relayStatuses,
            successCount,
            totalCount
          }, {
            message: successCount > 0 ? 
              (parentEvent ? t('Reply published to some relays') : t('Post published to some relays')) :
              (parentEvent ? t('Failed to publish reply') : t('Failed to publish post')),
            duration: 6000
          })
          
          // Handle partial success: show reply immediately (event already emitted by NostrProvider)
          if (successCount > 0) {
            const partialEvent = (error as any).event ?? newEvent
            if (parentEvent && partialEvent) {
              const clean = { ...partialEvent }
              delete (clean as any).relayStatuses
              mergePublishedReplyIntoThread(clean, (error as any).relayStatuses)
            }
            postEditorCache.clearPostCache({ kind: getDeterminedKind, defaultContent, parentEvent })
            if (draftEvent) deleteDraftEventCache(draftEvent)
            onPublishSuccess?.()
            close()
          }
        } else {
          // Use standard publishing error feedback for cases without relay statuses
          if (error instanceof AggregateError) {
            const errorMessages = error.errors.map((err: any) => err.message).join('; ')
            showPublishingError(`Failed to publish to relays: ${errorMessages}`)
          } else if (error instanceof Error) {
            showPublishingError(error.message)
          } else {
            showPublishingError('Failed to publish')
          }
          // Don't close form on complete failure - let user try again
        }
      } finally {
        setPosting(false)
      }
    })
  }

  const handlePollToggle = () => {
    if (parentEvent) return

    setIsPoll((prev) => !prev)
    if (!isPoll) {
      // When enabling poll mode, clear other modes
      setIsPublicMessage(false)
      setIsHighlight(false)
      setIsGitRelease(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
    }
  }

  const handlePublicMessageToggle = () => {
    if (parentEvent) return

    setIsPublicMessage((prev) => !prev)
    if (!isPublicMessage) {
      // When enabling public message mode, clear other modes
      setIsPoll(false)
      setIsHighlight(false)
      setIsGitRelease(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
    }
  }

  const handleHighlightToggle = () => {
    if (parentEvent) return

    setIsHighlight((prev) => !prev)
    if (!isHighlight) {
      // When enabling highlight mode, clear other modes and set client tag to true
      setIsPoll(false)
      setIsPublicMessage(false)
      setIsGitRelease(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setAddClientTag(true)
    }
  }

  const handleUploadStart = (file: File, cancel: () => void) => {
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
    // Track file for media upload
    if (file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')) {
      const mapKey = `${file.name}-${file.size}-${file.lastModified}`
      uploadedMediaFileMap.current.set(mapKey, file)
      
      // For replies and PMs, if it's an audio file, set mediaNoteKind immediately for preview
      if (parentEvent || isPublicMessage) {
        const fileType = file.type
        const fileName = file.name.toLowerCase()
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // For replies/PMs, webm/ogg/mp3/m4a files should be treated as audio since the microphone button only accepts audio/*
        // Even if the MIME type is incorrect, if it came through the audio uploader, it's audio
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        
        // For replies/PMs, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        if (isAudio) {
          // For PM replies, don't set mediaNoteKind - let PM reply handle it with imeta tags
          if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
            // Don't set mediaNoteKind - PM replies stay as kind 24 with imeta tags
          } else if (parentEvent) {
            setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
          } else if (isPublicMessage) {
            setMediaNoteKind(ExtendedKind.VOICE)
          }
          // Note: URL will be inserted when upload completes in handleMediaUploadSuccess
        }
      } else {
        // For new posts, detect the kind from the file (async)
        getMediaKindFromFile(file, false)
          .then((kind) => setMediaNoteKind(kind))
          .catch((error) => {
            logger.error('Error detecting media kind in handleUploadStart', { error, file: file.name })
          })
      }
    }
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) => (item.file === file ? { ...item, progress } : item))
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
    // Keep file in map until upload success is called
  }

  // Helper function to check if a file could be either audio or video
  const isAmbiguousMediaFile = (file: File): boolean => {
    if (parentEvent) {
      // For replies, we don't show the dialog - audio button only accepts audio/*
      return false
    }
    
    const fileType = file.type
    const fileName = file.name.toLowerCase()
    
    // Check if it's a webm or mp4 file that could be either audio or video
    const isWebm = /\.webm$/i.test(fileName)
    const isMp4 = /\.mp4$/i.test(fileName)
    
    if (isWebm || isMp4) {
      // If MIME type is missing, it's ambiguous
      if (!fileType || fileType === 'application/octet-stream') {
        return true
      }
      
      const isAudioMime = fileType.startsWith('audio/')
      const isVideoMime = fileType.startsWith('video/')
      
      // If MIME type doesn't clearly indicate one or the other, it's ambiguous
      // Some browsers report video/webm for audio-only webm files, so we show the dialog
      // to let the user choose
      if (isWebm) {
        // WebM files are often misreported, so show dialog
        return true
      }
      
      if (isMp4) {
        // MP4 files can be audio or video - if MIME type is video/mp4 but could be audio,
        // or if it's unclear, show dialog
        // Only show if MIME type suggests it could be either
        if (!isAudioMime && !isVideoMime) {
          return true
        }
        // If it's video/mp4, it could still be audio-only, so show dialog
        if (isVideoMime) {
          return true
        }
      }
    }
    
    return false
  }

  const handleMediaKindSelection = (selectedKind: number) => {
    if (!pendingMediaUpload) return
    
    const { url, tags, file } = pendingMediaUpload
    setShowMediaKindDialog(false)
    setPendingMediaUpload(null)
    
    // Process the upload with the selected kind
    processMediaUpload(url, tags, file, selectedKind)
  }

  const processMediaUpload = async (url: string, tags: string[][], uploadingFile: File, selectedKind?: number) => {
    try {
      let kind: number
      
      if (selectedKind !== undefined) {
        // Use the selected kind
        kind = selectedKind
      } else {
        // Auto-detect the kind
        kind = await getMediaKindFromFile(uploadingFile, false)
      }
      
      setMediaNoteKind(kind)
      
      // For picture notes, support multiple images by accumulating imeta tags
      if (kind === ExtendedKind.PICTURE) {
        // Get imeta tag from media upload service
        const imetaTag = mediaUpload.getImetaTagByUrl(url)
        let newImetaTag: string[]
        if (imetaTag) {
          newImetaTag = imetaTag
        } else if (tags && tags.length > 0 && tags[0]) {
          newImetaTag = tags[0]
        } else {
          // Create a basic imeta tag if none exists
          newImetaTag = ['imeta', `url ${url}`]
          if (uploadingFile.type) {
            newImetaTag.push(`m ${uploadingFile.type}`)
          }
        }
        
        // Accumulate multiple imeta tags for picture notes (use ref so rapid multi-upload doesn’t lose tags)
        const urlExists = pictureImetaTagsRef.current.some((tag) => {
          const urlItem = tag.find((item) => item.startsWith('url '))
          return urlItem && urlItem.slice(4).trim() === url
        })
        if (!urlExists) {
          pictureImetaTagsRef.current = [...pictureImetaTagsRef.current, newImetaTag]
          setMediaImetaTags([...pictureImetaTagsRef.current])
        }

        // Set the first URL as the primary mediaUrl (for backwards compatibility)
        if (!mediaUrl) {
          setMediaUrl(url)
        }
        
        // Insert the URL into the editor content so it shows in the edit pane
        // Use setTimeout to ensure the state has updated and editor is ready
        setTimeout(() => {
          if (textareaRef.current) {
            // Check the actual editor content, not the state variable (which might be stale)
            const currentText = textareaRef.current.getText()
            if (!currentText.includes(url)) {
              textareaRef.current.appendText(url, true)
            }
          }
        }, 100)
      } else {
        // For non-picture media, replace the existing tags (single media)
        pictureImetaTagsRef.current = []
        setMediaUrl(url)
        const imetaTag = mediaUpload.getImetaTagByUrl(url)
        if (imetaTag) {
          setMediaImetaTags([imetaTag])
        } else if (tags && tags.length > 0) {
          setMediaImetaTags(tags)
        } else {
          const basicImetaTag: string[] = ['imeta', `url ${url}`]
          // Update MIME type based on selected kind
          let mimeType = uploadingFile.type
          if (selectedKind === ExtendedKind.VOICE || selectedKind === ExtendedKind.VOICE_COMMENT) {
            // Ensure audio MIME type
            const fileName = uploadingFile.name.toLowerCase()
            if (/\.webm$/i.test(fileName)) {
              mimeType = 'audio/webm'
            } else if (/\.mp4$/i.test(fileName)) {
              mimeType = 'audio/mp4'
            }
          } else if (selectedKind === ExtendedKind.VIDEO || selectedKind === ExtendedKind.SHORT_VIDEO) {
            // Ensure video MIME type
            const fileName = uploadingFile.name.toLowerCase()
            if (/\.webm$/i.test(fileName)) {
              mimeType = 'video/webm'
            } else if (/\.mp4$/i.test(fileName)) {
              mimeType = 'video/mp4'
            }
          }
          if (mimeType) {
            basicImetaTag.push(`m ${mimeType}`)
          }
          setMediaImetaTags([basicImetaTag])
        }
        
        // Insert the URL into the editor content so it shows in the edit pane
        // Use setTimeout to ensure the state has updated and editor is ready
        setTimeout(() => {
          if (textareaRef.current) {
            // Check the actual editor content, not the state variable (which might be stale)
            const currentText = textareaRef.current.getText()
            if (!currentText.includes(url)) {
              textareaRef.current.appendText(url, true)
            }
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error processing media upload', { error, file: uploadingFile.name })
      // Fallback to picture if processing fails
      setMediaNoteKind(ExtendedKind.PICTURE)
      const imetaTag = mediaUpload.getImetaTagByUrl(url)
      const tagToAdd = imetaTag ?? (() => {
        const basic: string[] = ['imeta', `url ${url}`]
        if (uploadingFile.type) basic.push(`m ${uploadingFile.type}`)
        return basic
      })()
      pictureImetaTagsRef.current = [...pictureImetaTagsRef.current, tagToAdd]
      setMediaImetaTags([...pictureImetaTagsRef.current])
      if (!mediaUrl) {
        setMediaUrl(url)
      }
    }
  }

  const handleMediaUploadSuccess = async ({
    url,
    tags,
    file: fileFromCallback
  }: {
    url: string
    tags: string[][]
    file?: File
  }) => {
    try {
      let uploadingFile: File | undefined = fileFromCallback
      if (!uploadingFile) {
        for (const [, file] of uploadedMediaFileMap.current.entries()) {
          uploadingFile = file
          break
        }
      }
      if (!uploadingFile) {
        const progressItem = uploadProgresses.find((p) => p.file)
        uploadingFile = progressItem?.file
      }
      if (!uploadingFile) {
        logger.warn('Media upload succeeded but file not found')
        return
      }

      // Determine media kind from file
      // For replies, only audio comments are supported (kind 1244)
      // For new PMs, audio messages are supported (kind 1222)
      // For new posts, all media types are supported
      if (parentEvent || isPublicMessage) {
        // For replies and PMs, only allow audio
        const fileType = uploadingFile.type
        const fileName = uploadingFile.name.toLowerCase()
        // Check for audio files - including mp4/m4a/webm/ogg/mp3 which can be audio
        // mp4/m4a/webm/ogg/mp3 files can be audio if MIME type is audio/*
        // For replies/PMs, webm/ogg/mp3 files should be treated as audio since the microphone button only accepts audio/*
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        
        // For replies/PMs, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        if (isAudio) {
          // For PM replies, don't set mediaNoteKind - let PM reply handle it with imeta tags
          if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
            // Don't set mediaNoteKind - PM replies stay as kind 24 with imeta tags
            // Just set the URL and imeta tags
          } else if (parentEvent) {
            // For regular replies, always create voice comments (kind 1244), regardless of duration
            setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
          } else if (isPublicMessage) {
            // For new PMs, create voice notes (kind 1222)
            setMediaNoteKind(ExtendedKind.VOICE)
          }
          setMediaUrl(url)
          // Get imeta tag from media upload service
          const imetaTag = mediaUpload.getImetaTagByUrl(url)
          if (imetaTag) {
            setMediaImetaTags([imetaTag])
          } else if (tags && tags.length > 0) {
            setMediaImetaTags(tags)
          } else {
            const basicImetaTag: string[] = ['imeta', `url ${url}`]
            // For webm/ogg/mp3/m4a files uploaded via microphone, ensure MIME type is set to audio/*
            // even if the browser reports video/webm or video/mp4 (mobile browsers sometimes do this)
            let mimeType = uploadingFile.type
            const fileName = uploadingFile.name.toLowerCase()
            if (/\.m4a$/i.test(fileName)) {
              // m4a files are always audio, use audio/mp4 or audio/x-m4a
              mimeType = 'audio/mp4'
            } else if (/\.webm$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/webm'
            } else if (/\.ogg$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/ogg'
            } else if (/\.mp3$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/mpeg'
            }
            if (mimeType) {
              basicImetaTag.push(`m ${mimeType}`)
            }
            setMediaImetaTags([basicImetaTag])
          }
          // Insert the URL into the editor content so it shows in the edit pane
          // Use setTimeout to ensure the state has updated and editor is ready
          setTimeout(() => {
            if (textareaRef.current) {
              // Check if URL is already in the text
              const currentText = text || ''
              if (!currentText.includes(url)) {
                textareaRef.current.appendText(url, true)
              }
            }
          }, 100)
        } else {
          // Non-audio media in replies/PMs - don't set mediaNoteKind, will be handled as regular comment/PM
          // Clear any existing media note kind
          setMediaNoteKind(null)
          setMediaUrl('')
          setMediaImetaTags([])
          // Just add the media URL to the text content
          textareaRef.current?.appendText(url, true)
          return // Don't set media note kind for non-audio in replies/PMs
        }
      } else {
        // For new posts, check if file is ambiguous (could be audio or video)
        if (isAmbiguousMediaFile(uploadingFile)) {
          // Show dialog to let user choose
          setPendingMediaUpload({ url, tags, file: uploadingFile })
          setShowMediaKindDialog(true)
          return
        }
        
        // Not ambiguous, auto-detect and process
        await processMediaUpload(url, tags, uploadingFile)
      }
    } catch (error) {
      logger.error('Error in handleMediaUploadSuccess', { error })
      // Don't throw - just log the error so the upload doesn't fail completely
    }
    
    // Clear other note types when media is selected
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsWikiArticleMarkdown(false)
    setIsPublicationContent(false)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsGitRelease(false)

    // Clear uploaded file from map and picture accumulation ref
    uploadedMediaFileMap.current.clear()
    pictureImetaTagsRef.current = []
  }

  const handleArticleToggle = (type: 'longform' | 'wiki' | 'wiki-markdown' | 'publication') => {
    if (parentEvent) return // Can't create articles as replies
    
    setIsLongFormArticle(type === 'longform')
    setIsWikiArticle(type === 'wiki')
    setIsWikiArticleMarkdown(type === 'wiki-markdown')
    setIsPublicationContent(type === 'publication')
    
    // Clear other types
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setMediaNoteKind(null)
    setIsGitRelease(false)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    
    // Clear article metadata when switching off article mode
    if (type === null) {
      setArticleTitle('')
      setArticleDTag('')
      setArticleImage('')
      setArticleSubject('')
      setArticleSummary('')
      setArticleSummary('')
    }
    
    // Clear article fields when toggling off
    if (type === 'longform' || type === 'wiki' || type === 'wiki-markdown' || type === 'publication') {
      // Keep fields when switching between article types
    } else {
      setArticleTitle('')
      setArticleDTag('')
      setArticleImage('')
      setArticleSubject('')
      setArticleSummary('')
    }
  }

  const handleCitationToggle = (type: 'internal' | 'external' | 'hardcopy' | 'prompt') => {
    if (parentEvent) return // Can't create citations as replies

    setIsGitRelease(false)
    setIsCitationInternal(type === 'internal')
    setIsCitationExternal(type === 'external')
    setIsCitationHardcopy(type === 'hardcopy')
    setIsCitationPrompt(type === 'prompt')
    
    // Clear other types
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setMediaNoteKind(null)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsWikiArticleMarkdown(false)
    setIsPublicationContent(false)
    
    // Set default accessedOn if not already set
    if (!citationAccessedOn && (type === 'external' || type === 'hardcopy' || type === 'prompt')) {
      setCitationAccessedOn(new Date().toISOString().split('T')[0]) // ISO date format YYYY-MM-DD
    }
  }

  const handleGitReleaseFromMenu = () => {
    if (parentEvent) return

    setIsGitRelease(true)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setMediaNoteKind(null)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsWikiArticleMarkdown(false)
    setIsPublicationContent(false)
  }

  const handleClear = () => {
    // Clear the post editor cache
    postEditorCache.clearPostCache({ kind: getDeterminedKind, defaultContent, parentEvent })
    
    // Clear the editor content
    textareaRef.current?.clear()
    
    // Reset all state
    setText('')
    setMediaNoteKind(null)
    setMediaUrl('')
    setMediaImetaTags([])
    setMentions([])
    setExtractedMentions([])
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsWikiArticleMarkdown(false)
    setIsPublicationContent(false)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsGitRelease(false)
    setReleaseRepoOwnerInput('')
    setReleaseRepoId('')
    setReleaseTagName('')
    setReleaseTagHash('')
    setReleaseTitle('')
    setReleaseDownloadUrl('')
    setReleaseDraft(false)
    setReleasePrerelease(false)
    // Clear citation fields
    setCitationInternalCTag('')
    setCitationInternalRelayHint('')
    setCitationExternalUrl('')
    setCitationExternalOpenTimestamp('')
    setCitationHardcopyPageRange('')
    setCitationHardcopyChapterTitle('')
    setCitationHardcopyEditor('')
    setCitationHardcopyPublishedIn('')
    setCitationHardcopyVolume('')
    setCitationHardcopyDoi('')
    setCitationTitle('')
    setCitationAuthor('')
    setCitationPublishedOn('')
    setCitationPublishedBy('')
    setCitationAccessedOn('')
    setCitationLocation('')
    setCitationGeohash('')
    setCitationVersion('')
    setCitationSummary('')
    setCitationPromptLlm('')
    setPollCreateData({
      isMultipleChoice: false,
      options: ['', ''],
      endsAt: undefined,
      relays: []
    })
    setHighlightData({
      sourceType: 'nostr',
      sourceValue: ''
    })
    uploadedMediaFileMap.current.clear()
    pictureImetaTagsRef.current = []
    setUploadProgresses([])
  }

  return (
    <div className="space-y-2 min-w-0">
      {/* Dynamic Title based on mode */}
      <div className="text-lg font-semibold">
        {(() => {
          const determinedKind = getDeterminedKind
          if (parentEvent) {
            if (parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
              return t('Reply to Public Message')
            } else if (determinedKind === ExtendedKind.VOICE_COMMENT) {
              return t('Voice Comment')
            } else {
              return t('Reply to')
            }
          } else if (determinedKind === ExtendedKind.VOICE) {
            return t('Voice Note')
          } else if (determinedKind === ExtendedKind.PICTURE) {
            return t('Picture Note')
          } else if (determinedKind === ExtendedKind.VIDEO) {
            return t('Video Note')
          } else if (determinedKind === ExtendedKind.SHORT_VIDEO) {
            return t('Short Video Note')
          } else if (determinedKind === ExtendedKind.POLL) {
            return t('New Poll')
          } else if (determinedKind === ExtendedKind.PUBLIC_MESSAGE) {
            return t('New Public Message')
          } else if (determinedKind === kinds.Highlights) {
            return t('New Highlight')
          } else if (determinedKind === kinds.LongFormArticle) {
            return t('New Long-form Article')
          } else if (determinedKind === ExtendedKind.WIKI_ARTICLE) {
            return t('New Wiki Article')
          } else if (determinedKind === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
            return t('New Wiki Article (Markdown)')
          } else if (determinedKind === ExtendedKind.PUBLICATION_CONTENT) {
            return t('Take a note')
          } else if (determinedKind === ExtendedKind.CITATION_INTERNAL) {
            return t('New Internal Citation')
          } else if (determinedKind === ExtendedKind.CITATION_EXTERNAL) {
            return t('New External Citation')
          } else if (determinedKind === ExtendedKind.CITATION_HARDCOPY) {
            return t('New Hardcopy Citation')
          } else if (determinedKind === ExtendedKind.CITATION_PROMPT) {
            return t('New Prompt Citation')
          } else if (determinedKind === ExtendedKind.GIT_RELEASE) {
            return t('New Repository Release')
          } else {
            return t('New Note')
          }
        })()}
      </div>
      
      {parentEvent && (
        <ScrollArea className="flex max-h-48 flex-col overflow-y-auto rounded-lg border bg-muted/40">
          <div className="p-2 sm:p-3 pointer-events-none">
            <Note size="small" event={parentEvent} hideParentNotePreview />
          </div>
        </ScrollArea>
      )}
      
      {/* Article metadata fields */}
      {(isLongFormArticle || isWikiArticle || isWikiArticleMarkdown || isPublicationContent) && (
        <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
          <div className="space-y-2">
            <Label htmlFor="article-dtag" className="text-sm font-medium">
              {t('D-Tag')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="article-dtag"
              value={articleDTag}
              onChange={(e) => setArticleDTag(e.target.value)}
              placeholder={t('e.g., my-article-title')}
              className={!articleDTag.trim() ? 'border-destructive' : ''}
            />
            <p className="text-xs text-muted-foreground">
              {t('Unique identifier for this article (required)')}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-title" className="text-sm font-medium">
              {t('Title')}
            </Label>
            <Input
              id="article-title"
              value={articleTitle}
              onChange={(e) => setArticleTitle(e.target.value)}
              placeholder={t('Article title (optional)')}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-image" className="text-sm font-medium">
              {t('Image URL')}
            </Label>
            <Input
              id="article-image"
              value={articleImage}
              onChange={(e) => setArticleImage(e.target.value)}
              placeholder={t('https://example.com/image.jpg')}
            />
            <p className="text-xs text-muted-foreground">
              {t('URL of the article cover image (optional)')}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-subject" className="text-sm font-medium">
              {t('Subject / Topics')}
            </Label>
            <Input
              id="article-subject"
              value={articleSubject}
              onChange={(e) => setArticleSubject(e.target.value)}
              placeholder={t('topic1, topic2, topic3')}
            />
            <p className="text-xs text-muted-foreground">
              {t('Comma or space-separated topics (will be added as t-tags)')}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-summary" className="text-sm font-medium">
              {t('Summary')}
            </Label>
            <Textarea
              id="article-summary"
              value={articleSummary}
              onChange={(e) => setArticleSummary(e.target.value)}
              placeholder={t('Brief summary of the article (optional)')}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {t('A short description of the article content')}
            </p>
          </div>
        </div>
      )}
      
      {/* Citation metadata fields */}
      {(isCitationInternal ||
        isCitationExternal ||
        isCitationHardcopy ||
        isCitationPrompt ||
        isGitRelease) && (
        <div className="p-4 border rounded-lg bg-muted/30">
          <div className="text-sm font-medium mb-3">
            {isGitRelease
              ? t('Repository release')
              : isCitationInternal
                ? t('Internal Citation Settings')
                : isCitationExternal
                  ? t('External Citation Settings')
                  : isCitationHardcopy
                    ? t('Hardcopy Citation Settings')
                    : t('Prompt Citation Settings')}
          </div>
          {(isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          
          {/* Prompt Citation specific fields - shown first if prompt */}
          {isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-prompt-llm" className="text-sm font-medium">
                  {t('Language Model')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-prompt-llm"
                  value={citationPromptLlm}
                  onChange={(e) => setCitationPromptLlm(e.target.value)}
                  placeholder={t('e.g., GPT-4, Claude, etc. (required)')}
                  className={!citationPromptLlm.trim() ? 'border-destructive' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Name of the language model used')}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-external-url" className="text-sm font-medium">
                  {t('URL')}
                </Label>
                <Input
                  id="citation-external-url"
                  value={citationExternalUrl}
                  onChange={(e) => setCitationExternalUrl(e.target.value)}
                  placeholder={t('Website where LLM was accessed (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Shared fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-title" className="text-sm font-medium">
                  {t('Title')}
                </Label>
                <Input
                  id="citation-title"
                  value={citationTitle}
                  onChange={(e) => setCitationTitle(e.target.value)}
                  placeholder={t('Citation title (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-author" className="text-sm font-medium">
                  {t('Author')}
                </Label>
                <Input
                  id="citation-author"
                  value={citationAuthor}
                  onChange={(e) => setCitationAuthor(e.target.value)}
                  placeholder={t('Author name (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Internal Citation specific fields */}
          {isCitationInternal && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-internal-ctag" className="text-sm font-medium">
                  {t('C-Tag')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-internal-ctag"
                  value={citationInternalCTag}
                  onChange={(e) => setCitationInternalCTag(e.target.value)}
                  placeholder={t('kind:pubkey:hex format (required)')}
                  className={!citationInternalCTag.trim() ? 'border-destructive' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Reference to the cited Nostr event in kind:pubkey:hex format')}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-internal-relay-hint" className="text-sm font-medium">
                  {t('Relay Hint')}
                </Label>
                <Input
                  id="citation-internal-relay-hint"
                  value={citationInternalRelayHint}
                  onChange={(e) => setCitationInternalRelayHint(e.target.value)}
                  placeholder={t('Relay URL (optional)')}
                />
              </div>
            </>
          )}
          
          {/* External Citation specific fields */}
          {isCitationExternal && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-external-url" className="text-sm font-medium">
                  {t('URL')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-external-url"
                  value={citationExternalUrl}
                  onChange={(e) => setCitationExternalUrl(e.target.value)}
                  placeholder={t('https://example.com (required)')}
                  className={!citationExternalUrl.trim() ? 'border-destructive' : ''}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-external-open-timestamp" className="text-sm font-medium">
                  {t('Open Timestamp')}
                </Label>
                <Input
                  id="citation-external-open-timestamp"
                  value={citationExternalOpenTimestamp}
                  onChange={(e) => setCitationExternalOpenTimestamp(e.target.value)}
                  placeholder={t('e tag of kind 1040 event (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-published-by" className="text-sm font-medium">
                  {t('Published By')}
                </Label>
                <Input
                  id="citation-published-by"
                  value={citationPublishedBy}
                  onChange={(e) => setCitationPublishedBy(e.target.value)}
                  placeholder={t('Publisher name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Hardcopy Citation specific fields */}
          {isCitationHardcopy && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-page-range" className="text-sm font-medium">
                  {t('Page Range')}
                </Label>
                <Input
                  id="citation-hardcopy-page-range"
                  value={citationHardcopyPageRange}
                  onChange={(e) => setCitationHardcopyPageRange(e.target.value)}
                  placeholder={t('e.g., 123-145 (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-chapter-title" className="text-sm font-medium">
                  {t('Chapter Title')}
                </Label>
                <Input
                  id="citation-hardcopy-chapter-title"
                  value={citationHardcopyChapterTitle}
                  onChange={(e) => setCitationHardcopyChapterTitle(e.target.value)}
                  placeholder={t('Chapter title (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-editor" className="text-sm font-medium">
                  {t('Editor')}
                </Label>
                <Input
                  id="citation-hardcopy-editor"
                  value={citationHardcopyEditor}
                  onChange={(e) => setCitationHardcopyEditor(e.target.value)}
                  placeholder={t('Editor name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-published-in" className="text-sm font-medium">
                  {t('Published In')}
                </Label>
                <Input
                  id="citation-hardcopy-published-in"
                  value={citationHardcopyPublishedIn}
                  onChange={(e) => setCitationHardcopyPublishedIn(e.target.value)}
                  placeholder={t('Journal/Publication name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-volume" className="text-sm font-medium">
                  {t('Volume')}
                </Label>
                <Input
                  id="citation-hardcopy-volume"
                  value={citationHardcopyVolume}
                  onChange={(e) => setCitationHardcopyVolume(e.target.value)}
                  placeholder={t('Volume number (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-doi" className="text-sm font-medium">
                  {t('DOI')}
                </Label>
                <Input
                  id="citation-hardcopy-doi"
                  value={citationHardcopyDoi}
                  onChange={(e) => setCitationHardcopyDoi(e.target.value)}
                  placeholder={t('Digital Object Identifier (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-published-by" className="text-sm font-medium">
                  {t('Published By')}
                </Label>
                <Input
                  id="citation-published-by"
                  value={citationPublishedBy}
                  onChange={(e) => setCitationPublishedBy(e.target.value)}
                  placeholder={t('Publisher name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Shared date fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <div className="space-y-2">
              <Label htmlFor="citation-published-on" className="text-sm font-medium">
                {t('Published On')}
              </Label>
              <Input
                id="citation-published-on"
                type="date"
                value={citationPublishedOn}
                onChange={(e) => setCitationPublishedOn(e.target.value)}
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="citation-accessed-on" className="text-sm font-medium">
              {t('Accessed On')} {(isCitationExternal || isCitationHardcopy || isCitationPrompt) && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="citation-accessed-on"
              type="date"
              value={citationAccessedOn}
              onChange={(e) => setCitationAccessedOn(e.target.value)}
              className={(isCitationExternal || isCitationHardcopy || isCitationPrompt) && !citationAccessedOn.trim() ? 'border-destructive' : ''}
            />
          </div>
          
          {/* Summary field - different label for prompt citations - spans full width on desktop */}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="citation-summary" className="text-sm font-medium">
              {isCitationPrompt ? t('Prompt Conversation Script') : t('Summary')}
            </Label>
            <Textarea
              id="citation-summary"
              value={citationSummary}
              onChange={(e) => setCitationSummary(e.target.value)}
              placeholder={isCitationPrompt ? t('The full prompt conversation (optional)') : t('Brief summary (optional)')}
              rows={3}
            />
          </div>
          
          {/* Shared optional fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-location" className="text-sm font-medium">
                  {t('Location')}
                </Label>
                <Input
                  id="citation-location"
                  value={citationLocation}
                  onChange={(e) => setCitationLocation(e.target.value)}
                  placeholder={t('Location (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-geohash" className="text-sm font-medium">
                  {t('Geohash')}
                </Label>
                <Input
                  id="citation-geohash"
                  value={citationGeohash}
                  onChange={(e) => setCitationGeohash(e.target.value)}
                  placeholder={t('Geohash (optional)')}
                />
              </div>
            </>
          )}
          </div>
          )}
          {isGitRelease && (
            <div
              className={cn(
                'mt-4 grid grid-cols-1 gap-3 md:grid-cols-2',
                (isCitationInternal ||
                  isCitationExternal ||
                  isCitationHardcopy ||
                  isCitationPrompt) &&
                  'border-t border-border pt-4'
              )}
            >
              <p className="text-xs text-muted-foreground md:col-span-2">
                {t('Release notes use the editor below (optional).')}
              </p>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="release-repo-owner" className="text-sm font-medium">
                  {t('Repository owner (npub or hex)')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="release-repo-owner"
                  value={releaseRepoOwnerInput}
                  onChange={(e) => setReleaseRepoOwnerInput(e.target.value)}
                  placeholder="npub1…"
                  className={
                    releaseRepoOwnerInput.trim() && !parseRepoOwnerPubkeyInput(releaseRepoOwnerInput)
                      ? 'border-destructive'
                      : ''
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="release-repo-id" className="text-sm font-medium">
                  {t('Repository id (d-tag)')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="release-repo-id"
                  value={releaseRepoId}
                  onChange={(e) => setReleaseRepoId(e.target.value)}
                  placeholder={t('e.g. my-repo')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="release-tag-name" className="text-sm font-medium">
                  {t('Git tag name')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="release-tag-name"
                  value={releaseTagName}
                  onChange={(e) => setReleaseTagName(e.target.value)}
                  placeholder="v1.0.0"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="release-tag-hash" className="text-sm font-medium">
                  {t('Tag target (40-char commit hash)')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="release-tag-hash"
                  value={releaseTagHash}
                  onChange={(e) => setReleaseTagHash(e.target.value.trim())}
                  placeholder={t('40-character hex SHA-1')}
                  className={
                    releaseTagHash.trim() && !/^[0-9a-f]{40}$/i.test(releaseTagHash.trim())
                      ? 'border-destructive'
                      : ''
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="release-title" className="text-sm font-medium">
                  {t('Release title')}
                </Label>
                <Input
                  id="release-title"
                  value={releaseTitle}
                  onChange={(e) => setReleaseTitle(e.target.value)}
                  placeholder={t('Optional display title')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="release-download-url" className="text-sm font-medium">
                  {t('Download URL')}
                </Label>
                <Input
                  id="release-download-url"
                  value={releaseDownloadUrl}
                  onChange={(e) => setReleaseDownloadUrl(e.target.value)}
                  placeholder={t('https://…')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-6 md:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={releaseDraft}
                    onCheckedChange={(v) => setReleaseDraft(v === true)}
                  />
                  {t('Draft release')}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={releasePrerelease}
                    onCheckedChange={(v) => setReleasePrerelease(v === true)}
                  />
                  {t('Pre-release')}
                </label>
              </div>
            </div>
          )}
        </div>
      )}
      
      <NeventPickerProvider>
      <PostTextarea
          ref={textareaRef}
          text={text}
          setText={setText}
          defaultContent={defaultContent}
          parentEvent={parentEvent}
          onSubmit={() => post()}
          className={isPoll ? 'min-h-20' : 'min-h-52'}
          onUploadStart={handleUploadStart}
          onUploadProgress={handleUploadProgress}
          onUploadEnd={handleUploadEnd}
          kind={getDeterminedKind}
          highlightData={isHighlight ? highlightData : undefined}
          pollCreateData={isPoll ? pollCreateData : undefined}
          getDraftEventJson={getDraftEventJson}
          extraPreviewTags={rssReplyExtraPreviewTags}
          mediaImetaTags={mediaImetaTags}
          mediaUrl={mediaUrl}
          headerActions={
            <>
              {/* Media button - show for new posts only (replies have audio button at bottom) */}
              {!parentEvent && (
                <Uploader
                  onUploadSuccess={handleMediaUploadSuccess}
                  onUploadStart={handleUploadStart}
                  onUploadEnd={handleUploadEnd}
                  onProgress={handleUploadProgress}
                  accept="image/*,audio/*,video/*"
                >
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon"
                    title={t('Upload Media')}
                    className={mediaNoteKind !== null ? 'bg-accent' : ''}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </Uploader>
              )}
              {/* Note creation buttons - only show when not replying */}
              {!parentEvent && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('Create Highlight')}
                    className={isHighlight ? 'bg-accent' : ''}
                    onClick={handleHighlightToggle}
                  >
                    <Highlighter className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('Send Public Message')}
                    className={isPublicMessage ? 'bg-accent' : ''}
                    onClick={handlePublicMessageToggle}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('Create Poll')}
                    className={isPoll ? 'bg-accent' : ''}
                    onClick={handlePollToggle}
                  >
                    <ListTodo className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('Create Thread')}
                    onClick={() => checkLogin(() => setCreateThreadOpen(true))}
                  >
                    <MessagesSquare className="h-4 w-4" />
                  </Button>
                  {/* Article dropdown - only show if has private relays for publication content */}
                  {(hasPrivateRelaysAvailable || !isPublicationContent) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('Create Article')}
                          className={
                            isLongFormArticle || isWikiArticle || isWikiArticleMarkdown || isPublicationContent
                              ? 'bg-accent'
                              : ''
                          }
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleArticleToggle('longform')}>
                          {t('Long-form Article')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleArticleToggle('wiki')}>
                          {t('Wiki Article (AsciiDoc)')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleArticleToggle('wiki-markdown')}>
                          {t('Wiki Article (Markdown)')}
                        </DropdownMenuItem>
                        {hasPrivateRelaysAvailable && (
                          <DropdownMenuItem onClick={() => handleArticleToggle('publication')}>
                            {t('Take a note')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* Citations (private relays) + repository release */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('Create Citation')}
                        className={
                          isCitationInternal ||
                          isCitationExternal ||
                          isCitationHardcopy ||
                          isCitationPrompt ||
                          isGitRelease
                            ? 'bg-accent'
                            : ''
                        }
                      >
                        <Quote className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {hasPrivateRelaysAvailable ? (
                        <>
                          <DropdownMenuItem onClick={() => handleCitationToggle('internal')}>
                            {t('Internal Citation')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCitationToggle('external')}>
                            {t('External Citation')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCitationToggle('hardcopy')}>
                            {t('Hardcopy Citation')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCitationToggle('prompt')}>
                            {t('Prompt Citation')}
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground max-w-[14rem]">
                          {t('Citations require private relays (NIP-65).')}
                        </div>
                      )}
                      <DropdownMenuItem onClick={handleGitReleaseFromMenu}>
                        {t('Repository release')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              <GifPicker
                onSelect={(gifUrl) => {
                  textareaRef.current?.insertText(gifUrl)
                }}
              >
                <Button type="button" variant="ghost" size="icon" title={t('Insert GIF')}>
                  <Film className="h-4 w-4" />
                </Button>
              </GifPicker>
              <MemePicker
                onSelect={(memeUrl) => {
                  textareaRef.current?.insertText(memeUrl)
                }}
              >
                <Button type="button" variant="ghost" size="icon" title={t('Insert meme')}>
                  <Laugh className="h-4 w-4" />
                </Button>
              </MemePicker>
            </>
          }
        />
      {isPoll && (
        <PollEditor
          pollCreateData={pollCreateData}
          setPollCreateData={setPollCreateData}
          setIsPoll={setIsPoll}
          content={text}
        />
      )}
      {isHighlight && (
        <HighlightEditor
          highlightData={highlightData}
          setHighlightData={setHighlightData}
          setIsHighlight={setIsHighlight}
        />
      )}
      {isPublicMessage && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="mb-2 text-sm font-medium">{t('Recipients')}</div>
          <div className="space-y-2">
            <Mentions
              content={text}
              parentEvent={undefined}
              mentions={extractedMentions}
              setMentions={setExtractedMentions}
            />
            {extractedMentions.length > 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('Recipients detected from your message:')} {extractedMentions.length}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t('Add recipients using nostr: mentions (e.g., nostr:npub1...) or the recipient selector above')}
              </div>
            )}
          </div>
        </div>
      )}
      {uploadProgresses.length > 0 &&
        uploadProgresses.map(({ file, progress, cancel }, index) => (
          <div key={`${file.name}-${index}`} className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-muted-foreground mb-1">
                {file.name ?? t('Uploading...')}
              </div>
              <div className="h-0.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel?.()
                handleUploadEnd(file)
              }}
              className="text-muted-foreground hover:text-foreground"
              title={t('Cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      {!isPoll && (
        <PostRelaySelector
          setIsProtectedEvent={setIsProtectedEvent}
          setAdditionalRelayUrls={setAdditionalRelayUrls}
          parentEvent={parentEvent}
          openFrom={openFrom}
          content={text}
          isPublicMessage={isPublicMessage}
          mentions={extractedMentions}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex gap-2 items-center min-w-0 shrink-0">
          {/* Audio button for replies and new PMs - placed before image button */}
          {(parentEvent || isPublicMessage) && (
            <Uploader
              onUploadSuccess={handleMediaUploadSuccess}
              onUploadStart={handleUploadStart}
              onUploadEnd={handleUploadEnd}
              onProgress={handleUploadProgress}
              accept="audio/*"
            >
              <Button 
                type="button"
                variant="ghost" 
                size="icon" 
                title={parentEvent ? t('Upload Audio Comment') : t('Upload Audio Message')}
                className={mediaNoteKind === ExtendedKind.VOICE_COMMENT || (isPublicMessage && mediaNoteKind === ExtendedKind.VOICE) ? 'bg-accent' : ''}
              >
                <Mic className="h-4 w-4" />
              </Button>
            </Uploader>
          )}
          <Uploader
            onUploadSuccess={({ url }) => {
              textareaRef.current?.appendText(url, true)
            }}
            onUploadStart={handleUploadStart}
            onUploadEnd={handleUploadEnd}
            onProgress={handleUploadProgress}
            accept="image/*"
          >
            <Button type="button" variant="ghost" size="icon" title={t('Upload Image')}>
              <ImageUp />
            </Button>
          </Uploader>
          {/* I'm not sure why, but after triggering the virtual keyboard,
              opening the emoji picker drawer causes an issue,
              the emoji I tap isn't the one that gets inserted. */}
          {!isTouchDevice() && (
            <EmojiPickerDialog
              onEmojiClick={(emoji) => {
                if (!emoji) return
                textareaRef.current?.insertEmoji(emoji)
              }}
            >
              <Button variant="ghost" size="icon">
                <Smile />
              </Button>
            </EmojiPickerDialog>
          )}
          <MentionAndEventToolbarButtons
            insertAtCursor={(text) => textareaRef.current?.insertText(text)}
            variant="ghost"
          />
          <Button
            variant="ghost"
            size="icon"
            className={showMoreOptions ? 'bg-accent' : ''}
            onClick={() => setShowMoreOptions((pre) => !pre)}
          >
            <Settings />
          </Button>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          <Mentions
            content={text}
            parentEvent={parentEvent}
            mentions={mentions}
            setMentions={setMentions}
          />
          <div className="flex gap-2 items-center max-sm:hidden">
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
            >
              {t('Clear')}
            </Button>
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!canPost} onClick={post}>
              {posting && (
                <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />
              )}
              {parentEvent ? t('Reply') : isPublicMessage ? t('Send Public Message') : t('Post')}
            </Button>
          </div>
        </div>
      </div>
      <PostOptions
        posting={posting}
        show={showMoreOptions}
        addClientTag={addClientTag}
        setAddClientTag={setAddClientTag}
        isNsfw={isNsfw}
        setIsNsfw={setIsNsfw}
        minPow={minPow}
        setMinPow={setMinPow}
      />
      <div className="flex gap-2 items-center justify-around sm:hidden">
        <Button
          className="w-full"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            handleClear()
          }}
        >
          {t('Clear')}
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          {t('Cancel')}
        </Button>
        <Button className="w-full" type="submit" disabled={!canPost} onClick={post}>
          {posting && (
            <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />
          )}
          {parentEvent ? t('Reply') : t('Post')}
        </Button>
      </div>
      
      {/* Media Kind Selection Dialog */}
      <Dialog open={showMediaKindDialog} onOpenChange={setShowMediaKindDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Select Media Type')}</DialogTitle>
            <DialogDescription>
              {pendingMediaUpload && (
                <>
                  {t('This file could be either audio or video. Please select the correct type:')}
                  <br />
                  <span className="text-xs text-muted-foreground mt-2 block">
                    {pendingMediaUpload.file.name}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              variant="outline"
              className="flex items-center justify-start gap-3 h-auto p-4"
              onClick={() => {
                // User selected audio - always use VOICE (kind 1222)
                handleMediaKindSelection(ExtendedKind.VOICE)
              }}
            >
              <Music className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-medium">{t('Audio')}</span>
                <span className="text-xs text-muted-foreground">{t('Voice note or audio file')}</span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="flex items-center justify-start gap-3 h-auto p-4"
              onClick={() => {
                // Get duration to determine if it should be VIDEO (kind 21) or SHORT_VIDEO (kind 22)
                const file = pendingMediaUpload?.file
                if (file) {
                  // Create a temporary media element to get duration
                  const url = URL.createObjectURL(file)
                  const media = document.createElement('video')
                  
                  media.onloadedmetadata = () => {
                    const duration = media.duration || 0
                    URL.revokeObjectURL(url)
                    // Video files longer than 10 minutes (600 seconds) are long videos (kind 21)
                    // Otherwise use short video (kind 22)
                    const selectedKind = duration > 600 ? ExtendedKind.VIDEO : ExtendedKind.SHORT_VIDEO
                    handleMediaKindSelection(selectedKind)
                  }
                  
                  media.onerror = () => {
                    URL.revokeObjectURL(url)
                    // Fallback to SHORT_VIDEO if we can't determine duration
                    handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                  }
                  
                  media.src = url
                  media.load()
                  
                  // Timeout after 3 seconds
                  setTimeout(() => {
                    URL.revokeObjectURL(url)
                    handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                  }, 3000)
                } else {
                  // Fallback to SHORT_VIDEO if no file
                  handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                }
              }}
            >
              <Video className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-medium">{t('Video')}</span>
                <span className="text-xs text-muted-foreground">{t('Video file')}</span>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </NeventPickerProvider>
      {createThreadOpen && (
        <CreateThreadDialog
          onClose={() => setCreateThreadOpen(false)}
          onThreadCreated={() => {
            discussionFeedCache.clearDiscussionsListCache()
            setCreateThreadOpen(false)
            close()
          }}
        />
      )}
    </div>
  )
}
