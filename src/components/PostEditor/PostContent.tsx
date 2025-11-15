import Note from '@/components/Note'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  createCitationPromptDraftEvent
} from '@/lib/draft-event'
import { ExtendedKind } from '@/constants'
import { isTouchDevice } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useReply } from '@/providers/ReplyProvider'
import { normalizeUrl, cleanUrl } from '@/lib/url'
import logger from '@/lib/logger'
import postEditorCache from '@/services/post-editor-cache.service'
import storage from '@/services/local-storage.service'
import { TPollCreateData } from '@/types'
import { ImageUp, ListTodo, LoaderCircle, MessageCircle, Settings, Smile, X, Highlighter, FileText, Quote, Upload, Mic, Music, Video } from 'lucide-react'
import { getMediaKindFromFile } from '@/lib/media-kind-detection'
import { hasPrivateRelays, getPrivateRelayUrls, hasCacheRelays, getCacheRelayUrls } from '@/lib/private-relays'
import mediaUpload from '@/services/media-upload.service'
import { StorageKey } from '@/constants'
import { isProtectedEvent as isEventProtected, isReplyNoteEvent } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import EmojiPickerDialog from '../EmojiPickerDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Mentions, { extractMentions } from './Mentions'
import PollEditor from './PollEditor'
import PostOptions from './PostOptions'
import PostRelaySelector from './PostRelaySelector'
import PostTextarea, { TPostTextareaHandle } from './PostTextarea'
import Uploader from './Uploader'
import HighlightEditor, { HighlightData } from './HighlightEditor'

export default function PostContent({
  defaultContent = '',
  parentEvent,
  close,
  openFrom,
  initialHighlightData
}: {
  defaultContent?: string
  parentEvent?: Event
  close: () => void
  openFrom?: string[]
  initialHighlightData?: HighlightData
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const { feedInfo } = useFeed()
  const { addReplies } = useReply()
  const [text, setText] = useState('')
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const [posting, setPosting] = useState(false)
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void }[]
  >([])
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [addClientTag, setAddClientTag] = useState(true) // Default to true to always add client tag
  const [mentions, setMentions] = useState<string[]>([])
  const [isNsfw, setIsNsfw] = useState(false)
  const [isPoll, setIsPoll] = useState(false)
  const [isPublicMessage, setIsPublicMessage] = useState(false)
  const [extractedMentions, setExtractedMentions] = useState<string[]>([])
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
  const [mediaNoteKind, setMediaNoteKind] = useState<number | null>(null)
  const [mediaImetaTags, setMediaImetaTags] = useState<string[][]>([])
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [isLongFormArticle, setIsLongFormArticle] = useState(false)
  const [isWikiArticle, setIsWikiArticle] = useState(false)
  const [isWikiArticleMarkdown, setIsWikiArticleMarkdown] = useState(false)
  const [isPublicationContent, setIsPublicationContent] = useState(false)
  const [isCitationInternal, setIsCitationInternal] = useState(false)
  const [isCitationExternal, setIsCitationExternal] = useState(false)
  const [isCitationHardcopy, setIsCitationHardcopy] = useState(false)
  const [isCitationPrompt, setIsCitationPrompt] = useState(false)
  const [hasPrivateRelaysAvailable, setHasPrivateRelaysAvailable] = useState(false)
  const [hasCacheRelaysAvailable, setHasCacheRelaysAvailable] = useState(false)
  const [useCacheOnlyForPrivateNotes, setUseCacheOnlyForPrivateNotes] = useState(true) // Default ON
  const [showMediaKindDialog, setShowMediaKindDialog] = useState(false)
  const [pendingMediaUpload, setPendingMediaUpload] = useState<{ url: string; tags: string[][]; file: File } | null>(null)
  const uploadedMediaFileMap = useRef<Map<string, File>>(new Map())
  const isFirstRender = useRef(true)
  const canPost = useMemo(() => {
    const result = (
      !!pubkey &&
      !posting &&
      !uploadProgresses.length &&
      // For media notes, text is optional - just need media
      ((mediaNoteKind !== null && mediaUrl) || !!text) &&
      (!isPoll || pollCreateData.options.filter((option) => !!option.trim()).length >= 2) &&
      (!isPublicMessage || extractedMentions.length > 0 || parentEvent?.kind === ExtendedKind.PUBLIC_MESSAGE) &&
      (!isProtectedEvent || additionalRelayUrls.length > 0) &&
      (!isHighlight || highlightData.sourceValue.trim() !== '')
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
    highlightData
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

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      const cachedSettings = postEditorCache.getPostSettingsCache({
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
        setAddClientTag(cachedSettings.addClientTag ?? true) // Default to true
      }
      return
    }
    postEditorCache.setPostSettingsCache(
      { defaultContent, parentEvent },
      {
        isNsfw,
        isPoll,
        pollCreateData,
        addClientTag
      }
    )
  }, [defaultContent, parentEvent, isNsfw, isPoll, pollCreateData, addClientTag])

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
      setExtractedMentions([])
      return
    }

    // Debounce the mention extraction for all posts (not just public messages)
    const timeoutId = setTimeout(() => {
      extractMentionsFromContent(text)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [text, extractMentionsFromContent])

  // Check for private relays availability
  useEffect(() => {
    if (!pubkey) {
      setHasPrivateRelaysAvailable(false)
      setHasCacheRelaysAvailable(false)
      return
    }
    
    hasPrivateRelays(pubkey).then(setHasPrivateRelaysAvailable).catch(() => {
      setHasPrivateRelaysAvailable(false)
    })
    
    hasCacheRelays(pubkey).then(setHasCacheRelaysAvailable).catch(() => {
      setHasCacheRelaysAvailable(false)
    })
  }, [pubkey])

  // Load cache-only preference from localStorage
  // Default depends on whether cache relays exist
  useEffect(() => {
    const updateCachePreference = async () => {
      if (!pubkey) {
        setUseCacheOnlyForPrivateNotes(false)
        return
      }
      
      const hasCache = await hasCacheRelays(pubkey).catch(() => false)
      
      if (hasCache) {
        // If cache exists, load from localStorage or default to true (ON)
        const stored = window.localStorage.getItem(StorageKey.USE_CACHE_ONLY_FOR_PRIVATE_NOTES)
        setUseCacheOnlyForPrivateNotes(stored === null ? true : stored === 'true')
      } else {
        // If no cache, default to false (OFF) - use only outboxes
        setUseCacheOnlyForPrivateNotes(false)
      }
    }
    
    updateCachePreference()
  }, [pubkey])

  // Helper function to determine the kind that will be created
  const getDeterminedKind = useMemo((): number => {
    // For voice comments in replies, check mediaNoteKind even if mediaUrl is not set yet (for preview)
    // Debug logging
    console.log('🔍 getDeterminedKind: checking', { 
      parentEvent: !!parentEvent, 
      mediaNoteKind, 
      VOICE_COMMENT: ExtendedKind.VOICE_COMMENT,
      match: parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT
    })
    if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
      console.log('✅ getDeterminedKind: returning VOICE_COMMENT')
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
    } else if (isPublicMessage) {
      return ExtendedKind.PUBLIC_MESSAGE
    } else if (isPoll) {
      return ExtendedKind.POLL
    } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
      return ExtendedKind.PUBLIC_MESSAGE
    } else if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
      console.log('⚠️ getDeterminedKind: falling through to COMMENT', {
        parentEvent: !!parentEvent,
        parentEventKind: parentEvent?.kind,
        mediaNoteKind,
        mediaUrl
      })
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
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isHighlight,
    isPublicMessage,
    isPoll,
    parentEvent
  ])

  // Function to generate draft event JSON for preview
  const getDraftEventJson = useCallback(async (): Promise<string> => {
    if (!pubkey) {
      return JSON.stringify({ error: 'Not logged in' }, null, 2)
    }

    try {
      // Clean tracking parameters from URLs in the post content
      const cleanedText = text.replace(
        /(https?:\/\/[^\s]+)/g,
        (url) => {
          try {
            return cleanUrl(url)
          } catch {
            return url
          }
        }
      )
      
      // Get expiration and quiet settings
      // Only add expiration tags to chatting kinds: 1, 1111, 1222, 1244
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
      // Only use it when replying to an OP event that also has the "-" tag
      let shouldUseProtectedEvent = false
      if (parentEvent) {
        // Check if parent event is an OP (not a reply itself) and has the "-" tag
        const isParentOP = !isReplyNoteEvent(parentEvent)
        const parentHasProtectedTag = isEventProtected(parentEvent)
        shouldUseProtectedEvent = isParentOP && parentHasProtectedTag
      }

      let draftEvent: any = null

      // Check for voice comments first - even if mediaUrl is not set yet (for preview purposes)
      console.log('🔍 getDraftEventJson: checking voice comment', { 
        parentEvent: !!parentEvent, 
        mediaNoteKind, 
        VOICE_COMMENT: ExtendedKind.VOICE_COMMENT,
        match: parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT,
        typeof_mediaNoteKind: typeof mediaNoteKind
      })
      if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
        // Voice comment - use placeholder URL if mediaUrl not set yet
        console.log('✅ getDraftEventJson: creating voice comment draft event')
        const url = mediaUrl || 'placeholder://audio'
        const tags = mediaImetaTags.length > 0 ? mediaImetaTags : [['imeta', `url ${url}`, 'm audio/mpeg']]
        draftEvent = await createVoiceCommentDraftEvent(
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
      } else if (mediaNoteKind !== null && mediaUrl) {
          // Media notes
          if (mediaNoteKind === ExtendedKind.VOICE) {
            // Voice note
            draftEvent = await createVoiceDraftEvent(
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
            // Picture note
            draftEvent = await createPictureDraftEvent(
              cleanedText,
              mediaImetaTags,
              mentions,
              {
                addClientTag,
                isNsfw,
                addExpirationTag: false, // Picture notes are not chatting kinds
                expirationMonths,
                addQuietTag,
                quietDays
              }
            )
          } else if (mediaNoteKind === ExtendedKind.VIDEO || mediaNoteKind === ExtendedKind.SHORT_VIDEO) {
            // Video note
            draftEvent = await createVideoDraftEvent(
              cleanedText,
              mediaImetaTags,
              mentions,
              mediaNoteKind,
              {
                addClientTag,
                isNsfw,
                addExpirationTag: false, // Video notes are not chatting kinds
                expirationMonths,
                addQuietTag,
                quietDays
              }
            )
          }
        } else if (isLongFormArticle) {
          draftEvent = await createLongFormArticleDraftEvent(cleanedText, mentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isWikiArticle) {
          draftEvent = await createWikiArticleDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Wiki articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isWikiArticleMarkdown) {
          draftEvent = await createWikiArticleMarkdownDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Wiki articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isPublicationContent) {
          draftEvent = await createPublicationContentDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Publication content is not a chatting kind
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isCitationInternal) {
          // For now, use a simple format - in a real implementation, this would have a form
          draftEvent = createCitationInternalDraftEvent(cleanedText, {
            cTag: '', // Would need to be filled from a form
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationExternal) {
          draftEvent = createCitationExternalDraftEvent(cleanedText, {
            url: '', // Would need to be filled from a form
            accessedOn: new Date().toISOString(),
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationHardcopy) {
          draftEvent = createCitationHardcopyDraftEvent(cleanedText, {
            accessedOn: new Date().toISOString(),
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationPrompt) {
          draftEvent = createCitationPromptDraftEvent(cleanedText, {
            llm: '', // Would need to be filled from a form
            accessedOn: new Date().toISOString()
          })
        } else if (isHighlight) {
          // For highlights, pass the original sourceValue which contains the full identifier
          // The createHighlightDraftEvent function will parse it correctly
        draftEvent = await createHighlightDraftEvent(
          cleanedText,
          highlightData.sourceType,
          highlightData.sourceValue,
          highlightData.context,
          undefined, // description parameter (not used)
          {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Highlights are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
        } else if (isPublicMessage) {
          draftEvent = await createPublicMessageDraftEvent(cleanedText, extractedMentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Public messages are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
          draftEvent = await createPublicMessageReplyDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Public messages are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
          draftEvent = await createCommentDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            protectedEvent: shouldUseProtectedEvent,
            isNsfw,
            addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.COMMENT),
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isPoll) {
          draftEvent = await createPollDraftEvent(pubkey!, cleanedText, mentions, pollCreateData, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Polls are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else {
          // For regular kind 1 note OPs (no parentEvent), never use protectedEvent
          // protectedEvent should only be used when replying to an OP that has it
          draftEvent = await createShortTextNoteDraftEvent(cleanedText, mentions, {
            parentEvent,
            addClientTag,
            protectedEvent: shouldUseProtectedEvent,
            isNsfw,
            addExpirationTag: addExpirationTag && isChattingKind(kinds.ShortTextNote),
            expirationMonths,
            addQuietTag,
            quietDays
          })
        }

        // Return formatted JSON
        return JSON.stringify(draftEvent, null, 2)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)
      }
    }, [
      text,
      pubkey,
      parentEvent,
      mediaNoteKind,
      mediaUrl,
      mediaImetaTags,
      mentions,
      isLongFormArticle,
      isWikiArticle,
      isWikiArticleMarkdown,
      isPublicationContent,
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
      isNsfw
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
      let draftEvent: any = null
      let newEvent: any = null
      
      try {
        // Clean tracking parameters from URLs in the post content
        const cleanedText = text.replace(
          /(https?:\/\/[^\s]+)/g,
          (url) => {
            try {
              return cleanUrl(url)
            } catch {
              return url
            }
          }
        )
        
        // Get expiration and quiet settings
        // Only add expiration tags to chatting kinds: 1, 1111, 1222, 1244
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
        // Only use it when replying to an OP event that also has the "-" tag
        let shouldUseProtectedEvent = false
        if (parentEvent) {
          // Check if parent event is an OP (not a reply itself) and has the "-" tag
          const isParentOP = !isReplyNoteEvent(parentEvent)
          const parentHasProtectedTag = isEventProtected(parentEvent)
          shouldUseProtectedEvent = isParentOP && parentHasProtectedTag
        }

        // Determine relay URLs for private events
        let privateRelayUrls: string[] = []
        const isPrivateEvent = isPublicationContent || isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt
        if (isPrivateEvent) {
          if (useCacheOnlyForPrivateNotes && hasCacheRelaysAvailable) {
            // Use only cache relays if toggle is ON
            privateRelayUrls = await getCacheRelayUrls(pubkey!)
          } else {
            // Use all private relays (outbox + cache)
            privateRelayUrls = await getPrivateRelayUrls(pubkey!)
          }
        }

        if (mediaNoteKind !== null && mediaUrl) {
          // Media notes
          if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
            // Voice comment
            draftEvent = await createVoiceCommentDraftEvent(
              cleanedText,
              parentEvent,
              mediaUrl,
              mediaImetaTags,
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
          } else if (mediaNoteKind === ExtendedKind.VOICE) {
            // Voice note
            draftEvent = await createVoiceDraftEvent(
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
            // Picture note
            draftEvent = await createPictureDraftEvent(
              cleanedText,
              mediaImetaTags,
              mentions,
              {
                addClientTag,
                isNsfw,
                addExpirationTag: false, // Picture notes are not chatting kinds
                expirationMonths,
                addQuietTag,
                quietDays
              }
            )
          } else if (mediaNoteKind === ExtendedKind.VIDEO || mediaNoteKind === ExtendedKind.SHORT_VIDEO) {
            // Video note
            draftEvent = await createVideoDraftEvent(
              cleanedText,
              mediaImetaTags,
              mentions,
              mediaNoteKind,
              {
                addClientTag,
                isNsfw,
                addExpirationTag: false, // Video notes are not chatting kinds
                expirationMonths,
                addQuietTag,
                quietDays
              }
            )
          }
        } else if (isLongFormArticle) {
          draftEvent = await createLongFormArticleDraftEvent(cleanedText, mentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isWikiArticle) {
          draftEvent = await createWikiArticleDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Wiki articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isWikiArticleMarkdown) {
          draftEvent = await createWikiArticleMarkdownDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Wiki articles are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isPublicationContent) {
          draftEvent = await createPublicationContentDraftEvent(cleanedText, mentions, {
            dTag: cleanedText.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '-'), // Simple d-tag from content
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Publication content is not a chatting kind
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isCitationInternal) {
          // For now, use a simple format - in a real implementation, this would have a form
          draftEvent = createCitationInternalDraftEvent(cleanedText, {
            cTag: '', // Would need to be filled from a form
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationExternal) {
          draftEvent = createCitationExternalDraftEvent(cleanedText, {
            url: '', // Would need to be filled from a form
            accessedOn: new Date().toISOString(),
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationHardcopy) {
          draftEvent = createCitationHardcopyDraftEvent(cleanedText, {
            accessedOn: new Date().toISOString(),
            title: cleanedText.substring(0, 100)
          })
        } else if (isCitationPrompt) {
          draftEvent = createCitationPromptDraftEvent(cleanedText, {
            llm: '', // Would need to be filled from a form
            accessedOn: new Date().toISOString()
          })
        } else if (isHighlight) {
          // For highlights, pass the original sourceValue which contains the full identifier
          // The createHighlightDraftEvent function will parse it correctly
        draftEvent = await createHighlightDraftEvent(
          cleanedText,
          highlightData.sourceType,
          highlightData.sourceValue,
          highlightData.context,
          undefined, // description parameter (not used)
          {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Highlights are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
        } else if (isPublicMessage) {
          draftEvent = await createPublicMessageDraftEvent(cleanedText, extractedMentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Public messages are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
          draftEvent = await createPublicMessageReplyDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Public messages are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
          draftEvent = await createCommentDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            protectedEvent: shouldUseProtectedEvent,
            isNsfw,
            addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.COMMENT),
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isPoll) {
          draftEvent = await createPollDraftEvent(pubkey!, cleanedText, mentions, pollCreateData, {
            addClientTag,
            isNsfw,
            addExpirationTag: false, // Polls are not chatting kinds
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else {
          // For regular kind 1 note OPs (no parentEvent), never use protectedEvent
          // protectedEvent should only be used when replying to an OP that has it
          draftEvent = await createShortTextNoteDraftEvent(cleanedText, mentions, {
            parentEvent,
            addClientTag,
            protectedEvent: shouldUseProtectedEvent,
            isNsfw,
            addExpirationTag: addExpirationTag && isChattingKind(kinds.ShortTextNote),
            expirationMonths,
            addQuietTag,
            quietDays
          })
        }

        // console.log('Publishing draft event:', draftEvent)
        // For private events, only publish to private relays
        const relayUrls = isPrivateEvent && privateRelayUrls.length > 0 
          ? privateRelayUrls 
          : (additionalRelayUrls.length > 0 ? additionalRelayUrls : undefined)
        
        newEvent = await publish(draftEvent, {
          specifiedRelayUrls: relayUrls,
          additionalRelayUrls: isPoll ? pollCreateData.relays : (isPrivateEvent ? privateRelayUrls : additionalRelayUrls),
          minPow,
          disableFallbacks: additionalRelayUrls.length > 0 || isPrivateEvent // Don't use fallbacks if user explicitly selected relays or for private events
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
        postEditorCache.clearPostCache({ defaultContent, parentEvent })
        deleteDraftEventCache(draftEvent)
        // Remove relayStatuses before storing the event (it's only for UI feedback)
        const cleanEvent = { ...newEvent }
        delete (cleanEvent as any).relayStatuses
        addReplies([cleanEvent])
        close()
      } catch (error) {
        logger.error('Publishing error', { error })
        logger.error('Publishing error details', {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
        
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
          
          // Handle partial success
          if (successCount > 0) {
            // Clean up and close on partial success
            postEditorCache.clearPostCache({ defaultContent, parentEvent })
            if (draftEvent) deleteDraftEventCache(draftEvent)
            if (newEvent) addReplies([newEvent])
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
    }
  }

  const handlePublicMessageToggle = () => {
    if (parentEvent) return

    setIsPublicMessage((prev) => !prev)
    if (!isPublicMessage) {
      // When enabling public message mode, clear other modes
      setIsPoll(false)
      setIsHighlight(false)
    }
  }

  const handleHighlightToggle = () => {
    if (parentEvent) return

    setIsHighlight((prev) => !prev)
    if (!isHighlight) {
      // When enabling highlight mode, clear other modes and set client tag to true
      setIsPoll(false)
      setIsPublicMessage(false)
      setAddClientTag(true)
    }
  }

  const handleUploadStart = (file: File, cancel: () => void) => {
    console.log('🔍 handleUploadStart called', { 
      fileName: file.name, 
      fileType: file.type, 
      parentEvent: !!parentEvent 
    })
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
    // Track file for media upload
    if (file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')) {
      uploadedMediaFileMap.current.set(file.name, file)
      
      // For replies, if it's an audio file, set mediaNoteKind immediately for preview
      if (parentEvent) {
        const fileType = file.type
        const fileName = file.name.toLowerCase()
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // For replies, webm/ogg/mp3/m4a files should be treated as audio since the microphone button only accepts audio/*
        // Even if the MIME type is incorrect, if it came through the audio uploader, it's audio
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        
        // For replies, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        console.log('🔍 handleUploadStart: audio detection', {
          fileType,
          fileName,
          isAudioMime,
          isAudioExt,
          isMp4Audio,
          isWebmFile,
          isOggFile,
          isMp3File,
          isAudio
        })
        
        if (isAudio) {
          console.log('✅ handleUploadStart: setting VOICE_COMMENT for reply', { 
            mediaNoteKind: ExtendedKind.VOICE_COMMENT,
            fileType,
            fileName
          })
          setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
          // Note: URL will be inserted when upload completes in handleMediaUploadSuccess
        } else {
          console.log('❌ handleUploadStart: file is not audio, not setting VOICE_COMMENT')
        }
      } else {
        // For new posts, detect the kind from the file (async)
        getMediaKindFromFile(file, false)
          .then((kind) => {
            console.log('✅ handleUploadStart: detected kind for new post', { kind, fileName: file.name })
            setMediaNoteKind(kind)
          })
          .catch((error) => {
            console.error('❌ Error detecting media kind in handleUploadStart', { error, file: file.name })
            logger.error('Error detecting media kind in handleUploadStart', { error, file: file.name })
          })
      }
    } else {
      console.log('❌ handleUploadStart: file is not media type', { fileType: file.type })
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
        
        // Accumulate multiple imeta tags for picture notes
        setMediaImetaTags(prev => {
          // Check if this URL already exists in the tags
          const urlExists = prev.some(tag => {
            const urlItem = tag.find(item => item.startsWith('url '))
            return urlItem && urlItem.slice(4) === url
          })
          if (urlExists) {
            return prev // Don't add duplicate
          }
          return [...prev, newImetaTag]
        })
        
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
      if (imetaTag) {
        setMediaImetaTags(prev => [...prev, imetaTag])
      } else {
        const basicImetaTag: string[] = ['imeta', `url ${url}`]
        if (uploadingFile.type) {
          basicImetaTag.push(`m ${uploadingFile.type}`)
        }
        setMediaImetaTags(prev => [...prev, basicImetaTag])
      }
      if (!mediaUrl) {
        setMediaUrl(url)
      }
    }
  }

  const handleMediaUploadSuccess = async ({ url, tags }: { url: string; tags: string[][] }) => {
    try {
      // Find the file from the map - try to match by URL or get the most recent
      let uploadingFile: File | undefined
      // Try to find by matching URL pattern or get the first available
      for (const [, file] of uploadedMediaFileMap.current.entries()) {
        uploadingFile = file
        break // Get first available
      }
      
      if (!uploadingFile) {
        // Try to get from uploadProgresses as fallback
        const progressItem = uploadProgresses.find(p => p.file)
        uploadingFile = progressItem?.file
      }
      
      if (!uploadingFile) {
        logger.warn('Media upload succeeded but file not found')
        return
      }

      // Determine media kind from file
      // For replies, only audio comments are supported (kind 1244)
      // For new posts, all media types are supported
      if (parentEvent) {
        // For replies, only allow audio comments
        const fileType = uploadingFile.type
        const fileName = uploadingFile.name.toLowerCase()
        // Check for audio files - including mp4/m4a/webm/ogg/mp3 which can be audio
        // mp4/m4a/webm/ogg/mp3 files can be audio if MIME type is audio/*
        // For replies, webm/ogg/mp3 files should be treated as audio since the microphone button only accepts audio/*
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        
        // For replies, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        console.log('🔍 handleMediaUploadSuccess: audio detection', {
          fileType,
          fileName,
          isAudioMime,
          isAudioExt,
          isMp4Audio,
          isWebmFile,
          isOggFile,
          isMp3File,
          isAudio
        })
        
        if (isAudio) {
          // For replies, always create voice comments (kind 1244), regardless of duration
          console.log('✅ handleMediaUploadSuccess: setting VOICE_COMMENT for reply', { 
            mediaNoteKind: ExtendedKind.VOICE_COMMENT,
            url 
          })
          setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
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
            if (parentEvent) {
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
          // Non-audio media in replies - don't set mediaNoteKind, will be handled as regular comment
          // Clear any existing media note kind
          console.log('❌ handleMediaUploadSuccess: file is not audio, clearing mediaNoteKind', {
            fileType,
            fileName,
            isAudio
          })
          setMediaNoteKind(null)
          setMediaUrl('')
          setMediaImetaTags([])
          // Just add the media URL to the text content
          textareaRef.current?.appendText(url, true)
          return // Don't set media note kind for non-audio in replies
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
    
    // Clear uploaded file from map
    uploadedMediaFileMap.current.clear()
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
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
  }

  const handleCitationToggle = (type: 'internal' | 'external' | 'hardcopy' | 'prompt') => {
    if (parentEvent) return // Can't create citations as replies
    
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
  }

  const handleClear = () => {
    // Clear the post editor cache
    postEditorCache.clearPostCache({ defaultContent, parentEvent })
    
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
    setUploadProgresses([])
  }

  return (
    <div className="space-y-2">
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
          kind={(() => {
            const kind = getDeterminedKind
            console.log('🔍 PostTextarea kind prop:', { kind, mediaNoteKind, parentEvent: !!parentEvent })
            return kind
          })()}
          highlightData={isHighlight ? highlightData : undefined}
          pollCreateData={isPoll ? pollCreateData : undefined}
          getDraftEventJson={getDraftEventJson}
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
                  {/* Citation dropdown - only show if has private relays */}
                  {hasPrivateRelaysAvailable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('Create Citation')}
                          className={
                            isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt
                              ? 'bg-accent'
                              : ''
                          }
                        >
                          <Quote className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          {/* Audio button for replies - placed before image button */}
          {parentEvent && (
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
                title={t('Upload Audio Comment')}
                className={mediaNoteKind === ExtendedKind.VOICE_COMMENT ? 'bg-accent' : ''}
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
          <Button
            variant="ghost"
            size="icon"
            className={showMoreOptions ? 'bg-accent' : ''}
            onClick={() => setShowMoreOptions((pre) => !pre)}
          >
            <Settings />
          </Button>
        </div>
        <div className="flex gap-2 items-center">
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
              {posting && <LoaderCircle className="animate-spin" />}
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
          {posting && <LoaderCircle className="animate-spin" />}
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
    </div>
  )
}
