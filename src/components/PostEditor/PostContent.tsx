import Note from '@/components/Note'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  createCommentDraftEvent,
  createPollDraftEvent,
  createPublicMessageDraftEvent,
  createPublicMessageReplyDraftEvent,
  createShortTextNoteDraftEvent,
  createHighlightDraftEvent,
  deleteDraftEventCache
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
import { ImageUp, ListTodo, LoaderCircle, MessageCircle, Settings, Smile, X, Highlighter } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import EmojiPickerDialog from '../EmojiPickerDialog'
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
  const isFirstRender = useRef(true)
  const canPost = useMemo(() => {
    const result = (
      !!pubkey &&
      !!text &&
      !posting &&
      !uploadProgresses.length &&
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
        const addExpirationTag = storage.getDefaultExpirationEnabled()
        const expirationMonths = storage.getDefaultExpirationMonths()
        const addQuietTag = storage.getDefaultQuietEnabled()
        const quietDays = storage.getDefaultQuietDays()

        if (isHighlight) {
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
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          }
        )
        } else if (isPublicMessage) {
          draftEvent = await createPublicMessageDraftEvent(cleanedText, extractedMentions, {
            addClientTag,
            isNsfw,
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
          draftEvent = await createPublicMessageReplyDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            isNsfw,
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (parentEvent && parentEvent.kind !== kinds.ShortTextNote) {
          draftEvent = await createCommentDraftEvent(cleanedText, parentEvent, mentions, {
            addClientTag,
            protectedEvent: isProtectedEvent,
            isNsfw,
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else if (isPoll) {
          draftEvent = await createPollDraftEvent(pubkey!, cleanedText, mentions, pollCreateData, {
            addClientTag,
            isNsfw,
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          })
        } else {
          // For regular kind 1 note OPs (no parentEvent), never use protectedEvent
          // protectedEvent should only be used for public messages and discussions
          const shouldUseProtectedEvent = parentEvent ? isProtectedEvent : false
          draftEvent = await createShortTextNoteDraftEvent(cleanedText, mentions, {
            parentEvent,
            addClientTag,
            protectedEvent: shouldUseProtectedEvent,
            isNsfw,
            addExpirationTag,
            expirationMonths,
            addQuietTag,
            quietDays
          })
        }

        // console.log('Publishing draft event:', draftEvent)
        newEvent = await publish(draftEvent, {
          specifiedRelayUrls: additionalRelayUrls.length > 0 ? additionalRelayUrls : undefined,
          additionalRelayUrls: isPoll ? pollCreateData.relays : additionalRelayUrls,
          minPow,
          disableFallbacks: additionalRelayUrls.length > 0 // Don't use fallbacks if user explicitly selected relays
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
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) => (item.file === file ? { ...item, progress } : item))
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
  }

  return (
    <div className="space-y-2">
      {/* Dynamic Title based on mode */}
      <div className="text-lg font-semibold">
        {parentEvent ? (
          <div className="flex gap-2 items-center w-full">
            <div className="shrink-0">
              {parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE 
                ? t('Reply to Public Message')
                : t('Reply to')
              }
            </div>
          </div>
        ) : isPoll ? (
          t('New Poll')
        ) : isPublicMessage ? (
          t('New Public Message')
        ) : isHighlight ? (
          t('New Highlight')
        ) : (
          t('New Note')
        )}
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
        kind={isHighlight ? kinds.Highlights : isPublicMessage ? ExtendedKind.PUBLIC_MESSAGE : isPoll ? ExtendedKind.POLL : kinds.ShortTextNote}
        highlightData={isHighlight ? highlightData : undefined}
        pollCreateData={isPoll ? pollCreateData : undefined}
      />
      {isPoll && (
        <PollEditor
          pollCreateData={pollCreateData}
          setPollCreateData={setPollCreateData}
          setIsPoll={setIsPoll}
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
          <Uploader
            onUploadSuccess={({ url }) => {
              textareaRef.current?.appendText(url, true)
            }}
            onUploadStart={handleUploadStart}
            onUploadEnd={handleUploadEnd}
            onProgress={handleUploadProgress}
            accept="image/*,video/*,audio/*"
          >
            <Button variant="ghost" size="icon">
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
          {!parentEvent && (
            <Button
              variant="ghost"
              size="icon"
              title={t('Create Poll')}
              className={isPoll ? 'bg-accent' : ''}
              onClick={handlePollToggle}
            >
              <ListTodo />
            </Button>
          )}
          {!parentEvent && (
            <Button
              variant="ghost"
              size="icon"
              title={t('Send Public Message')}
              className={isPublicMessage ? 'bg-accent' : ''}
              onClick={handlePublicMessageToggle}
            >
              <MessageCircle />
            </Button>
          )}
          {!parentEvent && (
            <Button
              variant="ghost"
              size="icon"
              title={t('Create Highlight')}
              className={isHighlight ? 'bg-accent' : ''}
              onClick={handleHighlightToggle}
            >
              <Highlighter />
            </Button>
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
    </div>
  )
}
