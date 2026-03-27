import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hash, X, Users, Film, Laugh, Image, Zap, Settings, Book, ChevronDown, Check, Smile, Upload } from 'lucide-react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useGroupList } from '@/providers/GroupListProvider'
import { TDraftEvent } from '@/types'
import { NostrEvent } from 'nostr-tools'
import { prefixNostrAddresses } from '@/lib/nostr-address'
import { showPublishingError, showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import dayjs from 'dayjs'
import { extractHashtagsFromContent, normalizeTopic } from '@/lib/discussion-topics'
import { DISCUSSION_TOPICS } from './discussionTopics'
import PostRelaySelector from '@/components/PostEditor/PostRelaySelector'
import PostTextarea, { type TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'
import GifPicker from '@/components/GifPicker'
import MemePicker from '@/components/MemePicker'
import EmojiPickerDialog from '@/components/EmojiPickerDialog'
import Uploader from '@/components/PostEditor/Uploader'
import { NeventPickerProvider } from '@/components/PostEditor/PostTextarea/Mention/NeventNaddrPickerDialog'
import { MentionAndEventToolbarButtons } from '@/components/PostEditor/PostTextarea/Mention/MentionAndEventToolbarButtons'
import logger from '@/lib/logger'
import postEditorCache from '@/services/post-editor-cache.service'
import postEditor from '@/services/post-editor.service'
import { cn } from '@/lib/utils'
import { ExtendedKind } from '@/constants'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'

/** Isolates TipTap post cache from the main note composer (see postEditorCache.generateCacheKey). */
const THREAD_POST_EDITOR_PARENT = { id: '__jumble_thread_post_editor__' } as Event

// Utility functions for thread creation
function extractImagesFromContent(content: string): string[] {
  const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi
  return content.match(imageRegex) || []
}

function generateImetaTags(imageUrls: string[]): string[][] {
  return imageUrls.map(url => ['imeta', 'url', url])
}

function buildNsfwTag(): string[] {
  return ['content-warning', '']
}

type TopicListEntry = { id: string; label: string }

/** Match preset/dynamic list by id or exact label (case-insensitive); otherwise normalize as a new topic slug. */
function resolveTopicFromInput(raw: string, topics: TopicListEntry[]): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  const byId = topics.find((x) => x.id === lower)
  if (byId) return byId.id
  const byLabel = topics.find((x) => x.label.toLowerCase() === lower)
  if (byLabel) return byLabel.id
  return normalizeTopic(trimmed)
}

function displayTopicLabel(topicId: string, topics: TopicListEntry[]): string {
  const row = topics.find((x) => x.id === topicId)
  return row?.label ?? topicId
}

interface DynamicTopic {
  id: string
  label: string
  count: number
  isMainTopic: boolean
  isSubtopic: boolean
  parentTopic?: string
}

interface CreateThreadDialogProps {
  /** Default topic id from the preset list; defaults to `general`. */
  topic?: string
  /** Relay set id or single relay URL to seed selection (same as PostEditor `openFrom`). */
  selectedRelay?: string | null
  dynamicTopics?: {
    mainTopics: DynamicTopic[]
    subtopics: DynamicTopic[]
    allTopics: DynamicTopic[]
  }
  onClose: () => void
  onThreadCreated: (publishedEvent?: NostrEvent) => void
}

export default function CreateThreadDialog({
  topic: initialTopic = 'general',
  selectedRelay: initialRelay = null,
  dynamicTopics,
  onClose,
  onThreadCreated
}: CreateThreadDialogProps) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey, publish } = useNostr()
  const { relaySets } = useFavoriteRelays()
  const { userGroups } = useGroupList()
  const [hydrated, setHydrated] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(initialTopic)
  const [topicInput, setTopicInput] = useState(() => {
    const row = DISCUSSION_TOPICS.find((x) => x.id === initialTopic)
    return row?.label ?? initialTopic
  })
  const [, setIsProtectedEvent] = useState(false)
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{
    title?: string
    content?: string
    topic?: string
    relay?: string
    author?: string
    subject?: string
    group?: string
  }>({})
  const [isNsfw, setIsNsfw] = useState(false)
  const [addClientTag, setAddClientTag] = useState(true)
  const [minPow, setMinPow] = useState(0)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [isTopicSelectorOpen, setIsTopicSelectorOpen] = useState(false)
  const [pickerPortalContainer, setPickerPortalContainer] = useState<HTMLElement | null>(null)

  // Readings options state
  const [isReadingGroup, setIsReadingGroup] = useState(false)
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState('')
  const [showReadingsPanel, setShowReadingsPanel] = useState(false)
  
  // Group options state
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [isGroupSelectorOpen, setIsGroupSelectorOpen] = useState(false)

  const postTextareaRef = useRef<TPostTextareaHandle | null>(null)
  const advancedOptionsRef = useRef<HTMLDivElement | null>(null)

  const insertAtCursor = useCallback((text: string) => {
    postTextareaRef.current?.insertText(text)
  }, [])

  // Create combined topics list (predefined + dynamic) with hierarchy
  const allAvailableTopics = useMemo(() => {
    const combined = [...DISCUSSION_TOPICS]
    
    if (dynamicTopics) {
      // Add dynamic main topics first
      dynamicTopics.mainTopics.forEach(dynamicTopic => {
        const isGroupsTopic = dynamicTopic.id === 'groups'
        combined.push({
          id: dynamicTopic.id,
          label: `${dynamicTopic.label} (${dynamicTopic.count}) ${isGroupsTopic ? '👥' : '🔥'}`,
          icon: Hash // Use Hash icon for dynamic topics
        })
      })
      
      // Add dynamic subtopics grouped under their main topics
      dynamicTopics.subtopics.forEach(dynamicTopic => {
        // Try to find a related main topic
        const predefinedMainTopic = DISCUSSION_TOPICS.find(pt => 
          dynamicTopic.id.toLowerCase().includes(pt.id.toLowerCase()) || 
          pt.id.toLowerCase().includes(dynamicTopic.id.toLowerCase())
        )
        
        const relatedDynamicMainTopic = dynamicTopics.mainTopics.find(dt => 
          dynamicTopic.id.toLowerCase().includes(dt.id.toLowerCase()) || 
          dt.id.toLowerCase().includes(dynamicTopic.id.toLowerCase())
        )
        
        const parentTopic = predefinedMainTopic?.id || relatedDynamicMainTopic?.id
        
        if (parentTopic) {
          // Find the index of the parent topic and insert after it
          const parentIndex = combined.findIndex(topic => topic.id === parentTopic)
          if (parentIndex !== -1) {
            combined.splice(parentIndex + 1, 0, {
              id: dynamicTopic.id,
              label: `  └─ ${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
              icon: Hash // Use Hash icon for dynamic topics
            })
          } else {
            // Fallback: add at the end if parent not found
            combined.push({
              id: dynamicTopic.id,
              label: `${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
              icon: Hash // Use Hash icon for dynamic topics
            })
          }
        } else {
          // No parent found, group under "General"
          const generalIndex = combined.findIndex(topic => topic.id === 'general')
          if (generalIndex !== -1) {
            combined.splice(generalIndex + 1, 0, {
              id: dynamicTopic.id,
              label: `  └─ ${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
              icon: Hash // Use Hash icon for dynamic topics
            })
          } else {
            // Fallback: add at the end if General not found
            combined.push({
              id: dynamicTopic.id,
              label: `${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
              icon: Hash // Use Hash icon for dynamic topics
            })
          }
        }
      })
    }
    
    return combined
  }, [dynamicTopics])

  const effectiveTopic = useMemo(
    () => resolveTopicFromInput(topicInput, allAvailableTopics),
    [topicInput, allAvailableTopics]
  )

  /** Same `openFrom` semantics as PostEditor / PostRelaySelector. */
  const openFrom = useMemo(() => {
    if (!initialRelay) return undefined
    const relaySet = relaySets.find((set) => set.id === initialRelay)
    if (relaySet?.relayUrls?.length) return relaySet.relayUrls
    return [initialRelay]
  }, [initialRelay, relaySets])

  // Load cached thread draft when dialog opens (then mount PostTextarea once)
  useEffect(() => {
    const draft = postEditorCache.getThreadDraft()
    if (draft) {
      setTitle(draft.title)
      setContent(draft.content)
      setSelectedTopic(draft.topic)
      const predefined = DISCUSSION_TOPICS.find((x) => x.id === draft.topic)
      const dyn = dynamicTopics?.allTopics.find((x) => x.id === draft.topic)
      setTopicInput(predefined?.label ?? dyn?.label ?? draft.topic)
    }
    setHydrated(true)
  }, [dynamicTopics])

  // Persist draft when title, content, or topic change (debounced)
  useEffect(() => {
    if (!title && !content.trim()) return
    const t = setTimeout(() => {
      const tr = resolveTopicFromInput(topicInput, allAvailableTopics)
      postEditorCache.setThreadDraft({
        title,
        content,
        topic: tr || selectedTopic
      })
    }, 500)
    return () => clearTimeout(t)
  }, [title, content, topicInput, selectedTopic, allAvailableTopics])

  useEffect(() => {
    if (!showAdvancedOptions) return
    const el = advancedOptionsRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [showAdvancedOptions])

  const handleClearDraft = useCallback(() => {
    setTitle('')
    setContent('')
    setSelectedTopic('general')
    setTopicInput(displayTopicLabel('general', DISCUSSION_TOPICS))
    setErrors({})
    postEditorCache.clearThreadDraft()
    postEditorCache.clearPostCache({ kind: ExtendedKind.DISCUSSION, parentEvent: THREAD_POST_EDITOR_PARENT })
    postTextareaRef.current?.clear()
  }, [])

  const collectThreadTags = useCallback(
    (processedContent: string, topicForTags: string) => {
      const images = extractImagesFromContent(processedContent)
      const hashtags = extractHashtagsFromContent(processedContent)
      const tags: string[][] = [['title', title.trim()], ['-']]

      if (topicForTags === 'groups' && selectedGroup) {
        tags.push(['h', selectedGroup])
      }

      if (topicForTags !== 'all' && topicForTags !== 'general' && topicForTags !== 'groups') {
        const selectedDynamicTopic = dynamicTopics?.allTopics.find((dt) => dt.id === topicForTags)

        if (selectedDynamicTopic?.isSubtopic) {
          const predefinedMainTopic = DISCUSSION_TOPICS.find(
            (pt) =>
              topicForTags.toLowerCase().includes(pt.id.toLowerCase()) ||
              pt.id.toLowerCase().includes(topicForTags.toLowerCase())
          )

          if (predefinedMainTopic) {
            tags.push(['t', normalizeTopic(predefinedMainTopic.id)])
            tags.push(['t', normalizeTopic(topicForTags)])
          } else {
            const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(
              (dt) =>
                topicForTags.toLowerCase().includes(dt.id.toLowerCase()) ||
                dt.id.toLowerCase().includes(topicForTags.toLowerCase())
            )

            if (relatedDynamicMainTopic) {
              tags.push(['t', normalizeTopic(relatedDynamicMainTopic.id)])
              tags.push(['t', normalizeTopic(topicForTags)])
            } else {
              tags.push(['t', normalizeTopic(topicForTags)])
            }
          }
        } else {
          tags.push(['t', normalizeTopic(topicForTags)])
        }
      }

      let uniqueHashtags = hashtags
      if (topicForTags !== 'all' && topicForTags !== 'general') {
        const selectedDynamicTopic = dynamicTopics?.allTopics.find((dt) => dt.id === topicForTags)

        if (selectedDynamicTopic?.isSubtopic) {
          const predefinedMainTopic = DISCUSSION_TOPICS.find(
            (pt) =>
              topicForTags.toLowerCase().includes(pt.id.toLowerCase()) ||
              pt.id.toLowerCase().includes(topicForTags.toLowerCase())
          )
          const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(
            (dt) =>
              topicForTags.toLowerCase().includes(dt.id.toLowerCase()) ||
              dt.id.toLowerCase().includes(topicForTags.toLowerCase())
          )

          const parentTopic = predefinedMainTopic?.id || relatedDynamicMainTopic?.id
          uniqueHashtags = hashtags.filter(
            (hashtag) =>
              hashtag !== normalizeTopic(topicForTags) &&
              (parentTopic ? hashtag !== normalizeTopic(parentTopic) : true)
          )
        } else {
          uniqueHashtags = hashtags.filter((hashtag) => hashtag !== normalizeTopic(topicForTags))
        }
      }
      for (const hashtag of uniqueHashtags) {
        tags.push(['t', hashtag])
      }

      if (isReadingGroup) {
        if (!uniqueHashtags.includes('readings')) {
          tags.push(['t', 'readings'])
        }
        tags.push(['author', author.trim()])
        tags.push(['subject', subject.trim()])
      }

      if (images && images.length > 0) {
        tags.push(...generateImetaTags(images))
      }

      if (isNsfw) {
        tags.push(buildNsfwTag())
      }

      return tags
    },
    [title, selectedGroup, dynamicTopics, isReadingGroup, author, subject, isNsfw]
  )

  const previewExtraTags = useMemo(() => {
    if (!hydrated) return [] as string[][]
    const resolved = resolveTopicFromInput(topicInput, allAvailableTopics)
    if (!resolved) return [] as string[][]
    return collectThreadTags(prefixNostrAddresses(content.trim()), resolved)
  }, [hydrated, content, topicInput, allAvailableTopics, collectThreadTags])

  const handleThreadMediaUploadSuccess = useCallback(({ url }: { url: string }) => {
    setTimeout(() => {
      const ed = postTextareaRef.current
      if (ed && !ed.getText().includes(url)) {
        ed.appendText(url, true)
      }
    }, 100)
  }, [])

  const getDraftEventJson = useCallback(async () => {
    const processed = prefixNostrAddresses(content.trim())
    const topicResolved = resolveTopicFromInput(topicInput, allAvailableTopics) || selectedTopic
    const tags = collectThreadTags(processed, topicResolved)
    return JSON.stringify(
      {
        kind: ExtendedKind.DISCUSSION,
        content: processed,
        tags,
        created_at: dayjs().unix(),
        pubkey: pubkey || '(your pubkey)'
      },
      null,
      2
    )
  }, [content, topicInput, allAvailableTopics, selectedTopic, collectThreadTags, pubkey])

  const validateForm = () => {
    const newErrors: {
      title?: string
      content?: string
      topic?: string
      relay?: string
      author?: string
      subject?: string
      group?: string
    } = {}

    const topicResolved = resolveTopicFromInput(topicInput, allAvailableTopics)

    if (!title.trim()) {
      newErrors.title = t('Title is required')
    } else if (title.length > 100) {
      newErrors.title = t('Title must be 100 characters or less')
    }

    if (!topicResolved) {
      newErrors.topic = t('Topic is required')
    }

    if (!content.trim()) {
      newErrors.content = t('Content is required')
    } else if (content.length > 5000) {
      newErrors.content = t('Content must be 5000 characters or less')
    }

    if (additionalRelayUrls.length === 0) {
      newErrors.relay = t('Please select at least one relay')
    }

    if (isReadingGroup) {
      if (!author.trim()) {
        newErrors.author = t('Author is required for reading groups')
      }
      if (!subject.trim()) {
        newErrors.subject = t('Subject (book title) is required for reading groups')
      }
    }

    if (topicResolved === 'groups') {
      if (!selectedGroup.trim()) {
        newErrors.group = t('Please select a group')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!pubkey) {
      showPublishingError(t('You must be logged in to create a thread'))
      return
    }
    
    if (!validateForm()) {
      return
    }
    
    setIsSubmitting(true)
    
    try {
      const topicResolved = resolveTopicFromInput(topicInput, allAvailableTopics)
      if (!topicResolved) {
        setIsSubmitting(false)
        return
      }
      setSelectedTopic(topicResolved)

      const processedContent = prefixNostrAddresses(content.trim())
      const tags = collectThreadTags(processedContent, topicResolved)

      // Create the thread event (kind 11)
      const threadEvent: TDraftEvent = {
        kind: 11,
        content: processedContent,
        tags,
        created_at: dayjs().unix()
      }
      
      // Debug: Log the event before publishing
      logger.debug('[CreateThreadDialog] About to publish thread event:', {
        kind: threadEvent.kind,
        content: threadEvent.content,
        tags: threadEvent.tags,
        created_at: threadEvent.created_at,
        contentLength: threadEvent.content.length,
        tagsCount: threadEvent.tags.length
      })
      
      
      // Publish to all selected relays
      const publishedEvent = await publish(threadEvent, {
        specifiedRelayUrls: additionalRelayUrls,
        minPow,
        addClientTag,
        disableFallbacks: additionalRelayUrls.length > 0
      })
      
      
      if (publishedEvent) {
        // Show publishing feedback with relay messages
        if ((publishedEvent as any).relayStatuses) {
          showPublishingFeedback({
            success: true,
            relayStatuses: (publishedEvent as any).relayStatuses,
            successCount: (publishedEvent as any).relayStatuses.filter((s: any) => s.success).length,
            totalCount: (publishedEvent as any).relayStatuses.length
          }, {
            message: t('Thread published'),
            duration: 6000
          })
        } else {
          showSimplePublishSuccess(t('Thread published'))
        }
        
        postEditorCache.clearThreadDraft()
        postEditorCache.clearPostCache({ kind: ExtendedKind.DISCUSSION, parentEvent: THREAD_POST_EDITOR_PARENT })
        onThreadCreated(publishedEvent)
        onClose()
      } else {
        throw new Error(t('Failed to publish thread'))
      }
    } catch (error) {
      logger.error('[CreateThreadDialog] Error creating thread:', error)
      logger.error('[CreateThreadDialog] Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      let errorMessage = t('Failed to create thread')
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorMessage = t('Thread creation timed out. Please try again.')
        } else if (error.message.includes('auth-required') || error.message.includes('auth required')) {
          errorMessage = t('Relay requires authentication for write access. Please try a different relay or contact the relay operator.')
        } else if (error.message.includes('blocked')) {
          errorMessage = t('Your account is blocked from posting to this relay.')
        } else if (error.message.includes('rate limit')) {
          errorMessage = t('Rate limited. Please wait before trying again.')
        } else if (error.message.includes('writes disabled')) {
          errorMessage = t('Some relays have temporarily disabled writes.')
        } else if (error.message && error.message.trim()) {
          errorMessage = `${t('Failed to create thread')}: ${error.message}`
        } else {
          errorMessage = t('Failed to create thread. Please try a different relay.')
        }
      } else if (error instanceof AggregateError) {
        errorMessage = t('Failed to publish to some relays. Please try again or use different relays.')
      }
      
      showPublishingError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const triggerSubmit = () => {
    void handleSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
  }

  const escapeDialog = (e: { preventDefault: () => void }) => {
    if (postEditor.isSuggestionPopupOpen) {
      e.preventDefault()
      postEditor.closeSuggestionPopup()
    }
  }

  const formBody = (
    <NeventPickerProvider>
      <div
        ref={setPickerPortalContainer}
        className="pointer-events-none absolute inset-0"
        aria-hidden
      />
      <form
        id="create-thread-form"
        onSubmit={handleSubmit}
        className="relative flex min-w-0 flex-col gap-4"
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="text-lg font-semibold">{t('New Discussion')}</div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="shrink-0 space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="space-y-2">
            <Label htmlFor="topic-input" className="text-sm font-medium">
              {t('Topic')} <span className="text-destructive">*</span>
            </Label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="topic-input"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onBlur={() => {
                  const r = resolveTopicFromInput(topicInput, allAvailableTopics)
                  if (r) {
                    setSelectedTopic(r)
                    setTopicInput(displayTopicLabel(r, allAvailableTopics))
                  }
                }}
                placeholder={t('Type a topic or pick from the list')}
                autoComplete="off"
                className={cn('min-w-0 flex-1 bg-background', errors.topic && 'border-destructive')}
              />
              <Popover open={isTopicSelectorOpen} onOpenChange={setIsTopicSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t('Suggested topics')}
                    aria-expanded={isTopicSelectorOpen}
                  >
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="z-[10000] w-72 p-2" align="end" side="bottom" sideOffset={4}>
                  <p className="text-muted-foreground mb-2 px-1 text-xs font-medium">{t('Suggested topics')}</p>
                  <div className="max-h-60 overflow-y-auto">
                    {allAvailableTopics.map((topic, index) => {
                      const Icon = topic.icon
                      return (
                        <div
                          key={`topic-${index}-${topic.id}`}
                          className="flex cursor-pointer items-center rounded p-2 hover:bg-accent"
                          onClick={() => {
                            setSelectedTopic(topic.id)
                            setTopicInput(topic.label)
                            setIsTopicSelectorOpen(false)
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${effectiveTopic === topic.id ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <Icon className="mr-2 h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate text-sm">{topic.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {errors.topic && <p className="text-sm text-destructive">{errors.topic}</p>}
            <p className="text-xs text-muted-foreground">
              {t(
                'Choose a suggested topic or type your own. It becomes a normalized tag (e.g. my-topic).'
              )}
            </p>
          </div>

          {effectiveTopic === 'groups' && (
            <div className="space-y-2">
              <Label htmlFor="group" className="text-sm font-medium">
                {t('Select Group')}
              </Label>
              <Popover open={isGroupSelectorOpen} onOpenChange={setIsGroupSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isGroupSelectorOpen}
                    className="h-9 w-full justify-between bg-background font-normal"
                  >
                    {selectedGroup ? selectedGroup : t('Select group...')}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[10000] w-[--radix-popover-trigger-width] p-2"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="max-h-60 overflow-y-auto">
                    {userGroups.length === 0 ? (
                      <div className="p-2 text-center text-sm text-muted-foreground">
                        {t('No groups available. Join some groups first.')}
                      </div>
                    ) : (
                      userGroups.map((groupId) => (
                        <div
                          key={groupId}
                          className="flex cursor-pointer items-center rounded p-2 hover:bg-accent"
                          onClick={() => {
                            setSelectedGroup(groupId)
                            setIsGroupSelectorOpen(false)
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${selectedGroup === groupId ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <Users className="mr-2 h-4 w-4" />
                          {groupId}
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {errors.group && <p className="text-sm text-destructive">{errors.group}</p>}
              <p className="text-xs text-muted-foreground">
                {t('Select the group where you want to create this discussion.')}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium">
              {t('Title')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Enter a descriptive title for your thread')}
              maxLength={100}
              className={cn('bg-background', errors.title && 'border-destructive')}
            />
            {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
            <p className="text-xs text-muted-foreground">
              {title.length}/100 {t('characters')}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1 min-h-52">
          {hydrated ? (
            <PostTextarea
              ref={postTextareaRef}
              text={content}
              setText={setContent}
              defaultContent={content}
              parentEvent={THREAD_POST_EDITOR_PARENT}
              onSubmit={triggerSubmit}
              className={cn('min-h-52', errors.content && 'border-destructive')}
              kind={ExtendedKind.DISCUSSION}
              getDraftEventJson={getDraftEventJson}
              extraPreviewTags={previewExtraTags}
              headerActions={
                <>
                  <Uploader onUploadSuccess={handleThreadMediaUploadSuccess} accept="image/*,audio/*,video/*">
                    <Button type="button" variant="ghost" size="icon" title={t('Upload Media')}>
                      <Upload className="h-4 w-4" />
                    </Button>
                  </Uploader>
                  <GifPicker
                    onSelect={(gifUrl) => insertAtCursor(gifUrl + ' ')}
                    portalContainer={pickerPortalContainer ?? undefined}
                  >
                    <Button type="button" variant="ghost" size="icon" title={t('Insert GIF')}>
                      <Film className="h-4 w-4" />
                    </Button>
                  </GifPicker>
                  <MemePicker
                    onSelect={(memeUrl) => insertAtCursor(memeUrl + ' ')}
                    portalContainer={pickerPortalContainer ?? undefined}
                  >
                    <Button type="button" variant="ghost" size="icon" title={t('Insert meme')}>
                      <Laugh className="h-4 w-4" />
                    </Button>
                  </MemePicker>
                  <EmojiPickerDialog
                    portalContainer={pickerPortalContainer ?? undefined}
                    onEmojiClick={(emoji) => {
                      if (emoji == null) return
                      const char =
                        typeof emoji === 'string'
                          ? emoji
                          : (emoji as { native?: string }).native ?? String(emoji)
                      insertAtCursor(char)
                    }}
                  >
                    <Button type="button" variant="ghost" size="icon" title={t('Insert emoji')}>
                      <Smile className="h-4 w-4" />
                    </Button>
                  </EmojiPickerDialog>
                  <MentionAndEventToolbarButtons insertAtCursor={insertAtCursor} variant="ghost" />
                </>
              }
            />
          ) : null}
          {errors.content && <p className="text-sm text-destructive">{errors.content}</p>}
          <p className="text-xs text-muted-foreground">
            {content.length}/5000 {t('characters')}
          </p>
        </div>

        {effectiveTopic === 'literature' && (
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-2">
              <Book className="h-4 w-4" />
              <Label className="text-sm font-medium">{t('Readings Options')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowReadingsPanel(!showReadingsPanel)}
                className="ml-auto"
              >
                {showReadingsPanel ? t('Hide') : t('Configure')}
              </Button>
            </div>

            {showReadingsPanel && (
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Book className="h-4 w-4 text-primary" />
                    <Label htmlFor="reading-group" className="text-sm">
                      {t('Reading group entry')}
                    </Label>
                  </div>
                  <Switch id="reading-group" checked={isReadingGroup} onCheckedChange={setIsReadingGroup} />
                </div>

                {isReadingGroup && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="author">{t('Author')}</Label>
                      <Input
                        id="author"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        placeholder={t('Enter the author name')}
                        className={errors.author ? 'border-destructive' : ''}
                      />
                      {errors.author && <p className="text-sm text-destructive">{errors.author}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subject">{t('Subject (Book Title)')}</Label>
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={t('Enter the book title')}
                        className={errors.subject ? 'border-destructive' : ''}
                      />
                      {errors.subject && <p className="text-sm text-destructive">{errors.subject}</p>}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {t('This will add additional tags for author and subject to help organize reading group discussions.')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className={cn('shrink-0', errors.relay && 'rounded-md ring-1 ring-destructive')}>
          <PostRelaySelector
            setIsProtectedEvent={setIsProtectedEvent}
            setAdditionalRelayUrls={setAdditionalRelayUrls}
            openFrom={openFrom}
            content={content}
          />
          {errors.relay && <p className="mt-1 text-sm text-destructive">{errors.relay}</p>}
        </div>

        <div ref={advancedOptionsRef} className="shrink-0 scroll-mt-4 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            {t('Advanced Options')}
          </Button>

          {showAdvancedOptions && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-foreground" />
                  <Label htmlFor="nsfw" className="text-sm">
                    {t('Mark as NSFW')}
                  </Label>
                </div>
                <Switch id="nsfw" checked={isNsfw} onCheckedChange={setIsNsfw} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-foreground" />
                  <Label htmlFor="client-tag" className="text-sm">
                    {t('Add client identifier')}
                  </Label>
                </div>
                <Switch id="client-tag" checked={addClientTag} onCheckedChange={setAddClientTag} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-foreground" />
                  <Label className="text-sm">
                    {t('Proof of Work')}: {minPow}
                  </Label>
                </div>
                <div className="px-2">
                  <Slider
                    value={[minPow]}
                    onValueChange={(value: number[]) => setMinPow(value[0])}
                    max={20}
                    min={0}
                    step={1}
                    className="w-full"
                  />
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>{t('No PoW')}</span>
                    <span>{t('High PoW')}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('Higher values make your thread harder to mine but more unique.')}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            {t('Cancel')}
          </Button>
          <Button type="button" variant="outline" onClick={handleClearDraft} disabled={isSubmitting}>
            {t('Clear')}
          </Button>
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? t('Creating...') : t('Create Thread')}
          </Button>
        </div>
      </form>
    </NeventPickerProvider>
  )

  if (isSmallScreen) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          className="flex max-h-[min(92dvh,100%)] w-full max-w-full flex-col overflow-hidden border-none p-0"
          side="bottom"
          hideClose
          onEscapeKeyDown={escapeDialog}
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain px-4 [scrollbar-gutter:stable]">
            <div className="min-w-0 space-y-4 px-2 py-6 pr-4">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('New Discussion')}</SheetTitle>
                <SheetDescription>{t('Create a discussion thread')}</SheetDescription>
              </SheetHeader>
              {formBody}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="z-[210] flex max-h-[min(93dvh,52rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0 sm:w-full"
        overlayClassName="z-[205]"
        withoutClose
        onEscapeKeyDown={escapeDialog}
      >
        <div className="max-h-[min(90dvh,50rem)] min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
          <div className="min-w-0 space-y-4 px-2 py-6 pr-4 pl-4">
            <DialogHeader className="sr-only">
              <DialogTitle>{t('New Discussion')}</DialogTitle>
              <DialogDescription>{t('Create a discussion thread')}</DialogDescription>
            </DialogHeader>
            {formBody}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
