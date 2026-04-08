import { Button } from '@/components/ui/button'
import { normalizeUrl, isLocalNetworkUrl } from '@/lib/url'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay, TMailboxRelayScope } from '@/types'
import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import MailboxRelay from '../MailboxSetting/MailboxRelay'
import NewMailboxRelayInput from '../MailboxSetting/NewMailboxRelayInput'
import RelayCountWarning from '../MailboxSetting/RelayCountWarning'
import DiscoveredRelays from '../MailboxSetting/DiscoveredRelays'
import { createCacheRelaysDraftEvent } from '@/lib/draft-event'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { CloudUpload } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

export default function CacheRelaysSetting() {
  const { t } = useTranslation()
  const {
    pubkey,
    cacheRelayListEvent,
    checkLogin,
    publish,
    updateCacheRelayListEvent,
  } = useNostr()
  const [relays, setRelays] = useState<TMailboxRelay[]>([])
  const [hasChange, setHasChange] = useState(false)
  const [pushing, setPushing] = useState(false)
  const justSavedRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = relays.findIndex((relay) => relay.url === active.id)
      const newIndex = relays.findIndex((relay) => relay.url === over?.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        setRelays((relays) => arrayMove(relays, oldIndex, newIndex))
        setHasChange(true)
      }
    }
  }

  useEffect(() => {
    if (!cacheRelayListEvent) {
      setRelays([])
      setHasChange(false)
      return
    }

    const cacheRelayList = getRelayListFromEvent(cacheRelayListEvent)
    const newRelays = cacheRelayList.originalRelays

    setRelays((currentRelays) => {
      const areRelaysEqual =
        newRelays.length === currentRelays.length &&
        newRelays.every((relay, index) =>
          relay.url === currentRelays[index]?.url &&
          relay.scope === currentRelays[index]?.scope
        )

      if (!areRelaysEqual) {
        if (justSavedRef.current) {
          justSavedRef.current = false
          setHasChange(false)
        }
        return newRelays
      }

      return currentRelays
    })
  }, [cacheRelayListEvent])

  if (!pubkey) {
    return (
      <div className="flex flex-col w-full items-center">
        <Button size="lg" onClick={() => checkLogin()}>
          {t('Login to set')}
        </Button>
      </div>
    )
  }

  if (cacheRelayListEvent === undefined) {
    return <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
  }

  const changeCacheRelayScope = (url: string, scope: TMailboxRelayScope) => {
    setRelays((prev) => prev.map((r) => (r.url === url ? { ...r, scope } : r)))
    setHasChange(true)
  }

  const removeCacheRelay = (url: string) => {
    setRelays((prev) => prev.filter((r) => r.url !== url))
    setHasChange(true)
  }

  const saveNewCacheRelay = (url: string) => {
    if (url === '') return null
    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) {
      return t('Invalid relay URL')
    }
    if (!isLocalNetworkUrl(normalizedUrl)) {
      return t('Cache relays must be local network URLs only (e.g., ws://localhost:4869 or ws://127.0.0.1:4869)')
    }
    if (relays.some((r) => r.url === normalizedUrl)) {
      return t('Relay already exists')
    }
    setRelays([...relays, { url: normalizedUrl, scope: 'both' }])
    setHasChange(true)
    return null
  }

  const handleAddDiscoveredRelays = (newRelays: TMailboxRelay[]) => {
    const localRelays = newRelays.filter(newRelay => isLocalNetworkUrl(newRelay.url))
    const relaysToAdd = localRelays.filter(
      newRelay => !relays.some(r => r.url === newRelay.url)
    )
    if (relaysToAdd.length > 0) {
      setRelays([...relays, ...relaysToAdd])
      setHasChange(true)
    }
  }

  const save = async () => {
    if (!pubkey) return

    setPushing(true)
    try {
      const event = createCacheRelaysDraftEvent(relays)
      const result = await publish(event)
      justSavedRef.current = true
      await updateCacheRelayListEvent(result)

      if ((result as any).relayStatuses) {
        showPublishingFeedback({
          success: true,
          relayStatuses: (result as any).relayStatuses,
          successCount: (result as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (result as any).relayStatuses.length
        }, {
          message: t('Cache relays saved'),
          duration: 6000
        })
      } else {
        showSimplePublishSuccess(t('Cache relays saved'))
      }
    } catch (error) {
      justSavedRef.current = false
      logger.error('Failed to save cache relays', { error })
      if (error instanceof Error && (error as any).relayStatuses) {
        showPublishingFeedback({
          success: false,
          relayStatuses: (error as any).relayStatuses,
          successCount: (error as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (error as any).relayStatuses.length
        }, {
          message: error.message || t('Failed to save cache relays'),
          duration: 6000
        })
      } else {
        showPublishingError(error instanceof Error ? error : new Error(t('Failed to save cache relays')))
      }
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{t('Cache relays are used to store and retrieve events locally. These relays are merged with your inbox and outbox relays.')}</div>
      </div>
      <DiscoveredRelays onAdd={handleAddDiscoveredRelays} localOnly={true} />
      <RelayCountWarning relays={relays} />
      <Button className="w-full" disabled={!pubkey || pushing || !hasChange} onClick={save}>
        {pushing ? <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden /> : <CloudUpload />}
        {t('Save')}
      </Button>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={relays.map((r) => r.url)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {relays.map((relay) => (
              <MailboxRelay
                key={relay.url}
                mailboxRelay={relay}
                changeMailboxRelayScope={changeCacheRelayScope}
                removeMailboxRelay={removeCacheRelay}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <NewMailboxRelayInput saveNewMailboxRelay={saveNewCacheRelay} />
    </div>
  )
}
