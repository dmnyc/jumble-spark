import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import TextareaWithMentionAutocomplete from '@/components/TextareaWithMentionAutocomplete'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hash, X, Users, Film, Image, Zap, Settings, Book, Eye, Edit3, ChevronDown, Check, ImageUp, Smile } from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useGroupList } from '@/providers/GroupListProvider'
import { TDraftEvent, TRelaySet } from '@/types'
import { NostrEvent } from 'nostr-tools'
import { prefixNostrAddresses } from '@/lib/nostr-address'
import { showPublishingError, showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { simplifyUrl } from '@/lib/url'
import relaySelectionService, { type RelaySourceType } from '@/services/relay-selection.service'
import dayjs from 'dayjs'
import { extractHashtagsFromContent, normalizeTopic } from '@/lib/discussion-topics'
import { DISCUSSION_TOPICS } from './discussionTopics'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import RelayIcon from '@/components/RelayIcon'
import GifPicker from '@/components/GifPicker'
import EmojiPickerDialog from '@/components/EmojiPickerDialog'
import Uploader from '@/components/PostEditor/Uploader'
import logger from '@/lib/logger'

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

interface DynamicTopic {
  id: string
  label: string
  count: number
  isMainTopic: boolean
  isSubtopic: boolean
  parentTopic?: string
}

interface CreateThreadDialogProps {
  topic: string
  availableRelays: string[]
  relaySets: TRelaySet[]
  selectedRelay?: string | null  // null = "All relays", relay set ID, or single relay URL
  dynamicTopics?: {
    mainTopics: DynamicTopic[]
    subtopics: DynamicTopic[]
    allTopics: DynamicTopic[]
  }
  onClose: () => void
  onThreadCreated: (publishedEvent?: NostrEvent) => void
}

export default function CreateThreadDialog({ 
  topic: initialTopic, 
  availableRelays, 
  relaySets,
  selectedRelay: initialRelay,
  dynamicTopics,
  onClose, 
  onThreadCreated 
}: CreateThreadDialogProps) {
  const { t } = useTranslation()
  const { pubkey, publish, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { userGroups } = useGroupList()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(initialTopic)
  const [selectedRelayUrls, setSelectedRelayUrls] = useState<string[]>([])
  const [selectableRelays, setSelectableRelays] = useState<string[]>([])
  const [relayTypes, setRelayTypes] = useState<Record<string, RelaySourceType>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; content?: string; relay?: string; author?: string; subject?: string; group?: string }>({})
  const [isNsfw, setIsNsfw] = useState(false)
  const [addClientTag, setAddClientTag] = useState(true)
  const [minPow, setMinPow] = useState(0)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [isLoadingRelays, setIsLoadingRelays] = useState(true)
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

  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const insertAtCursor = (text: string) => {
    const ta = contentTextareaRef.current
    if (ta) {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = content.slice(0, start)
      const after = content.slice(end)
      setContent(before + text + after)
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(start + text.length, start + text.length)
      }, 0)
    } else {
      setContent((prev) => prev + text)
    }
  }

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

  // Initialize selected relays using the centralized relay selection service
  useEffect(() => {
    const initializeRelays = async () => {
      setIsLoadingRelays(true)
      try {
        // Determine openFrom based on initialRelay
        let openFrom: string[] | undefined = undefined
        if (initialRelay) {
          const relaySet = relaySets.find(set => set.id === initialRelay)
          if (relaySet) {
            openFrom = relaySet.relayUrls
          } else {
            openFrom = [initialRelay]
          }
        }

        const result = await relaySelectionService.selectRelays({
          userWriteRelays: relayList?.write || [],
          userReadRelays: relayList?.read || [],
          favoriteRelays,
          blockedRelays,
          relaySets,
          openFrom,
          userPubkey: pubkey || undefined
        })

        setSelectableRelays(result.selectableRelays)
        setSelectedRelayUrls(result.selectedRelays)
        setRelayTypes(result.relayTypes ?? {})
      } catch (error) {
        logger.error('[CreateThreadDialog] Failed to initialize relays:', error)
        // Fallback to availableRelays
        setSelectableRelays(availableRelays)
        setSelectedRelayUrls(availableRelays)
        setRelayTypes({})
      } finally {
        setIsLoadingRelays(false)
      }
    }

    initializeRelays()
  }, [initialRelay, availableRelays, relaySets, favoriteRelays, blockedRelays, relayList, pubkey])

  const handleRelayCheckedChange = (checked: boolean, url: string) => {
    if (checked) {
      setSelectedRelayUrls(prev => [...prev, url])
    } else {
      setSelectedRelayUrls(prev => prev.filter(u => u !== url))
    }
  }

  const handleSelectAll = () => {
    setSelectedRelayUrls([...selectableRelays])
  }

  const handleClearAll = () => {
    setSelectedRelayUrls([])
  }

  const validateForm = () => {
    const newErrors: { title?: string; content?: string; relay?: string; author?: string; subject?: string; group?: string } = {}
    
    if (!title.trim()) {
      newErrors.title = t('Title is required')
    } else if (title.length > 100) {
      newErrors.title = t('Title must be 100 characters or less')
    }
    
    if (!content.trim()) {
      newErrors.content = t('Content is required')
    } else if (content.length > 5000) {
      newErrors.content = t('Content must be 5000 characters or less')
    }
    
    if (selectedRelayUrls.length === 0) {
      newErrors.relay = t('Please select at least one relay')
    }
    
    // Validate readings fields if reading group is enabled
    if (isReadingGroup) {
      if (!author.trim()) {
        newErrors.author = t('Author is required for reading groups')
      }
      if (!subject.trim()) {
        newErrors.subject = t('Subject (book title) is required for reading groups')
      }
    }
    
    // Validate group selection if groups topic is selected
    if (selectedTopic === 'groups') {
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
      // Process content to prefix nostr addresses
      const processedContent = prefixNostrAddresses(content.trim())
      
      // Extract images from processed content
      const images = extractImagesFromContent(processedContent)
      
      // Extract hashtags from content
      const hashtags = extractHashtagsFromContent(processedContent)
      
      // Build tags array
      const tags = [
        ['title', title.trim()],
        ['-'] // Required tag for relay privacy
      ]
      
      // Add h tag for group discussions
      if (selectedTopic === 'groups' && selectedGroup) {
        tags.push(['h', selectedGroup])
      }
      
      // Only add topic tag if it's a specific topic (not 'all' or 'general' or 'groups')
      if (selectedTopic !== 'all' && selectedTopic !== 'general' && selectedTopic !== 'groups') {
        // Check if this is a dynamic subtopic
        const selectedDynamicTopic = dynamicTopics?.allTopics.find(dt => dt.id === selectedTopic)
        
        if (selectedDynamicTopic?.isSubtopic) {
          // For subtopics, we need to find the parent main topic
          // First, try to find a predefined main topic that might be related
          const predefinedMainTopic = DISCUSSION_TOPICS.find(pt => 
            selectedTopic.toLowerCase().includes(pt.id.toLowerCase()) || 
            pt.id.toLowerCase().includes(selectedTopic.toLowerCase())
          )
          
          if (predefinedMainTopic) {
            // Add the predefined main topic first, then the subtopic
            tags.push(['t', normalizeTopic(predefinedMainTopic.id)])
            tags.push(['t', normalizeTopic(selectedTopic)])
          } else {
            // If no predefined main topic found, try to find a dynamic main topic
            const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(dt => 
              selectedTopic.toLowerCase().includes(dt.id.toLowerCase()) || 
              dt.id.toLowerCase().includes(selectedTopic.toLowerCase())
            )
            
            if (relatedDynamicMainTopic) {
              // Add the dynamic main topic first, then the subtopic
              tags.push(['t', normalizeTopic(relatedDynamicMainTopic.id)])
              tags.push(['t', normalizeTopic(selectedTopic)])
            } else {
              // Fallback: just add the subtopic and let the system categorize it under 'general'
              // Don't add 'general' as a t-tag since it's the default fallback
              tags.push(['t', normalizeTopic(selectedTopic)])
            }
          }
        } else {
          // Regular topic (predefined or dynamic main topic)
          tags.push(['t', normalizeTopic(selectedTopic)])
        }
      }
      
      // Add hashtags as t-tags (deduplicate with selectedTopic and any parent topics)
      let uniqueHashtags = hashtags
      if (selectedTopic !== 'all' && selectedTopic !== 'general') {
        const selectedDynamicTopic = dynamicTopics?.allTopics.find(dt => dt.id === selectedTopic)
        
        if (selectedDynamicTopic?.isSubtopic) {
          // For subtopics, deduplicate against both the subtopic and its potential parent
          const predefinedMainTopic = DISCUSSION_TOPICS.find(pt => 
            selectedTopic.toLowerCase().includes(pt.id.toLowerCase()) || 
            pt.id.toLowerCase().includes(selectedTopic.toLowerCase())
          )
          const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(dt => 
            selectedTopic.toLowerCase().includes(dt.id.toLowerCase()) || 
            dt.id.toLowerCase().includes(selectedTopic.toLowerCase())
          )
          
          const parentTopic = predefinedMainTopic?.id || relatedDynamicMainTopic?.id
          uniqueHashtags = hashtags.filter(hashtag => 
            hashtag !== normalizeTopic(selectedTopic) && 
            (parentTopic ? hashtag !== normalizeTopic(parentTopic) : true)
          )
        } else {
          // Regular topic
          uniqueHashtags = hashtags.filter(hashtag => hashtag !== normalizeTopic(selectedTopic))
        }
      }
      for (const hashtag of uniqueHashtags) {
        tags.push(['t', hashtag])
      }
      
      // Add readings tags if this is a reading group
      if (isReadingGroup) {
        // Only add if not already added from hashtags
        if (!uniqueHashtags.includes('readings')) {
          tags.push(['t', 'readings'])
        }
        tags.push(['author', author.trim()])
        tags.push(['subject', subject.trim()])
      }
      
      // Add image metadata tags if images are found
      if (images && images.length > 0) {
        tags.push(...generateImetaTags(images))
      }
      
      // Add NSFW tag if enabled
      if (isNsfw) {
        tags.push(buildNsfwTag())
      }
      
      // Client tag is added in publish() based on user preference
      
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
        specifiedRelayUrls: selectedRelayUrls,
        minPow,
        addClientTag
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

  const selectedTopicInfo = allAvailableTopics.find(t => t.id === selectedTopic) || allAvailableTopics[0]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      {/* Portal target for GIF/emoji pickers so they render as children of this modal */}
      <div
        ref={setPickerPortalContainer}
        className="absolute inset-0 pointer-events-none"
        aria-hidden
      />
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto relative bg-background">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-xl font-semibold">{t('Create New Thread')}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Topic Selection */}
            <div className="space-y-2">
              <Label htmlFor="topic">{t('Topic')}</Label>
              <Popover open={isTopicSelectorOpen} onOpenChange={setIsTopicSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isTopicSelectorOpen}
                    className="w-full justify-between"
                  >
                    {selectedTopicInfo?.label || t('Select topic...')}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-[--radix-popover-trigger-width] p-2 z-[10000]" 
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="max-h-60 overflow-y-auto">
                    {allAvailableTopics.map((topic, index) => {
                      const Icon = topic.icon
                      return (
                        <div
                          key={`topic-${index}-${topic.id}`}
                          className="flex items-center p-2 hover:bg-accent cursor-pointer rounded"
                          onClick={() => {
                            setSelectedTopic(topic.id)
                            setIsTopicSelectorOpen(false)
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              selectedTopic === topic.id ? 'opacity-100' : 'opacity-0'
                            }`}
                          />
                          <Icon className="mr-2 h-4 w-4" />
                          {topic.label}
                        </div>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-sm text-muted-foreground">
                {t('Threads are organized by topics. Choose a topic that best fits your discussion.')}
              </p>
            </div>

            {/* Group Selection - Only show when Groups topic is selected */}
            {selectedTopic === 'groups' && (
              <div className="space-y-2">
                <Label htmlFor="group">{t('Select Group')}</Label>
                <Popover open={isGroupSelectorOpen} onOpenChange={setIsGroupSelectorOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isGroupSelectorOpen}
                      className="w-full justify-between"
                    >
                      {selectedGroup ? selectedGroup : t('Select group...')}
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-[--radix-popover-trigger-width] p-2 z-[10000]" 
                    align="start"
                    side="bottom"
                    sideOffset={4}
                  >
                    <div className="max-h-60 overflow-y-auto">
                      {userGroups.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          {t('No groups available. Join some groups first.')}
                        </div>
                      ) : (
                        userGroups.map((groupId) => (
                          <div
                            key={groupId}
                            className="flex items-center p-2 hover:bg-accent cursor-pointer rounded"
                            onClick={() => {
                              setSelectedGroup(groupId)
                              setIsGroupSelectorOpen(false)
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                selectedGroup === groupId ? 'opacity-100' : 'opacity-0'
                              }`}
                            />
                            <Users className="mr-2 h-4 w-4" />
                            {groupId}
                          </div>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {errors.group && (
                  <p className="text-sm text-destructive">{errors.group}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {t('Select the group where you want to create this discussion.')}
                </p>
              </div>
            )}

            {/* Title Input */}
            <div className="space-y-2">
              <Label htmlFor="title">{t('Thread Title')}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('Enter a descriptive title for your thread')}
                maxLength={100}
                className={errors.title ? 'border-destructive' : ''}
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {title.length}/100 {t('characters')}
              </p>
            </div>

            {/* Content Input with Preview */}
            <div className="space-y-2">
              <Label htmlFor="content">{t('Thread Content')}</Label>
              <Tabs defaultValue="edit" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="edit" className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4" />
                    {t('Edit')}
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    {t('Preview')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="space-y-2">
                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                    <Uploader
                      onUploadSuccess={({ url }) => insertAtCursor(url)}
                      accept="image/*"
                    >
                      <Button type="button" variant="outline" size="sm">
                        <ImageUp className="h-4 w-4 mr-1" />
                        {t('Upload Image')}
                      </Button>
                    </Uploader>
                    <GifPicker onSelect={(gifUrl) => insertAtCursor(gifUrl)} portalContainer={pickerPortalContainer}>
                      <Button type="button" variant="outline" size="sm">
                        <Film className="h-4 w-4 mr-1" />
                        {t('Insert GIF')}
                      </Button>
                    </GifPicker>
                    <EmojiPickerDialog
                      portalContainer={pickerPortalContainer}
                      onEmojiClick={(emoji) => {
                        if (emoji == null) return
                        const char = typeof emoji === 'string' ? emoji : (emoji as { native?: string }).native ?? String(emoji)
                        insertAtCursor(char)
                      }}
                    >
                      <Button type="button" variant="outline" size="sm">
                        <Smile className="h-4 w-4 mr-1" />
                        {t('Insert emoji')}
                      </Button>
                    </EmojiPickerDialog>
                  </div>
                  <TextareaWithMentionAutocomplete
                    ref={contentTextareaRef}
                    id="content"
                    value={content}
                    onChange={setContent}
                    placeholder={t('Share your thoughts, ask questions, or start a discussion...')}
                    rows={8}
                    maxLength={5000}
                    className={errors.content ? 'border-destructive' : ''}
                  />
                  {errors.content && (
                    <p className="text-sm text-destructive">{errors.content}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {content.length}/5000 {t('characters')}
                  </p>
                </TabsContent>
                <TabsContent value="preview" className="space-y-2">
                  <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px]">
                    {content.trim() ? (
                      <div className="space-y-4">
                        {/* Preview of the thread */}
                        <div className="border-b pb-2">
                          <h3 className="text-lg font-semibold">{title || t('Untitled')}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <selectedTopicInfo.icon className="w-4 h-4" />
                            <Badge variant="secondary" className="text-xs">
                              {selectedTopicInfo.label}
                            </Badge>
                            {isReadingGroup && (
                              <>
                                <Badge variant="outline" className="text-xs">
                                  <Hash className="w-3 h-3 mr-1" />
                                  Readings
                                </Badge>
                                {author && (
                                  <span className="text-xs text-muted-foreground">
                                    {t('Author')}: {author}
                                  </span>
                                )}
                                {subject && (
                                  <span className="text-xs text-muted-foreground">
                                    {t('Book')}: {subject}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {/* Preview of the content */}
                        <MarkdownArticle 
                          event={{
                            id: 'preview',
                            pubkey: pubkey || '',
                            created_at: Math.floor(Date.now() / 1000),
                            kind: 11,
                            tags: [
                              ['title', title],
                              ['t', selectedTopic],
                              ...(isReadingGroup ? [['t', 'readings']] : []),
                              ...(author ? [['author', author]] : []),
                              ...(subject ? [['subject', subject]] : [])
                            ],
                            content: content,
                            sig: ''
                          }}
                          hideMetadata={true}
                        />
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        <Edit3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>{t('Start typing to see a preview...')}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {content.length}/5000 {t('characters')}
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            {/* Readings Options - Only show for literature topic */}
            {selectedTopic === 'literature' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Book className="w-4 h-4" />
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
                  <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Book className="w-4 h-4 text-primary" />
                        <Label htmlFor="reading-group" className="text-sm">
                          {t('Reading group entry')}
                        </Label>
                      </div>
                      <Switch
                        id="reading-group"
                        checked={isReadingGroup}
                        onCheckedChange={setIsReadingGroup}
                      />
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
                          {errors.author && (
                            <p className="text-sm text-destructive">{errors.author}</p>
                          )}
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
                          {errors.subject && (
                            <p className="text-sm text-destructive">{errors.subject}</p>
                          )}
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

            {/* Relay Selection */}
            <div className="space-y-2">
              <Label>{t('Publish to Relays')}</Label>
              <div
                className={`max-h-64 min-h-0 overflow-y-scroll overflow-x-hidden rounded-md border p-4 ${errors.relay ? 'border-destructive' : ''}`}
              >
                {isLoadingRelays ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {t('Loading relays...')}
                  </div>
                ) : selectableRelays.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {t('No relays available. Please configure relays in settings.')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectableRelays.map(relay => {
                      const isChecked = selectedRelayUrls.includes(relay)
                      const sourceType = relayTypes[relay]
                      const typeLabel = sourceType ? t(`relayType_${sourceType}`) : ''
                      return (
                        <div key={relay} className="flex items-center space-x-3">
                          <Checkbox
                            id={`relay-${relay}`}
                            checked={isChecked}
                            onCheckedChange={(checked: boolean | 'indeterminate') => handleRelayCheckedChange(!!checked, relay)}
                            disabled={isLoadingRelays}
                          />
                          <label
                            htmlFor={`relay-${relay}`}
                            className="flex items-center gap-2 text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 min-w-0"
                          >
                            <RelayIcon url={relay} className="w-4 h-4 shrink-0" />
                            <span className="truncate">{simplifyUrl(relay)}</span>
                            {typeLabel && (
                              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                {typeLabel}
                              </span>
                            )}
                          </label>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {errors.relay && (
                <p className="text-sm text-destructive">{errors.relay}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedRelayUrls.length === 0
                    ? t('No relays selected')
                    : t('{{count}} relay(s) selected', { count: selectedRelayUrls.length })}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={isLoadingRelays}
                  >
                    {t('Select All')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAll}
                    disabled={isLoadingRelays}
                  >
                    {t('Clear All')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Advanced Options Toggle */}
            <div className="border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Settings className="w-4 h-4" />
                {t('Advanced Options')}
              </Button>
              
              {showAdvancedOptions && (
                <div className="space-y-4 mt-4">
                  {/* NSFW Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-foreground" />
                      <Label htmlFor="nsfw" className="text-sm">
                        {t('Mark as NSFW')}
                      </Label>
                    </div>
                    <Switch
                      id="nsfw"
                      checked={isNsfw}
                      onCheckedChange={setIsNsfw}
                    />
                  </div>

                  {/* Client Tag Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image className="w-4 h-4 text-foreground" />
                      <Label htmlFor="client-tag" className="text-sm">
                        {t('Add client identifier')}
                      </Label>
                    </div>
                    <Switch
                      id="client-tag"
                      checked={addClientTag}
                      onCheckedChange={setAddClientTag}
                    />
                  </div>

                  {/* PoW Setting */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-foreground" />
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
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
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

            {/* Form Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                {t('Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? t('Creating...') : t('Create Thread')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
