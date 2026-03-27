import { Button } from '@/components/ui/button'
import { isHttpRelayUrl, normalizeHttpRelayUrl } from '@/lib/url'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay, TMailboxRelayScope } from '@/types'
import { useEffect, useState } from 'react'
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
import SaveButton from './SaveButton'
import DiscoveredRelays from '../MailboxSetting/DiscoveredRelays'

export default function HttpRelaysSetting() {
  const { t } = useTranslation()
  const { pubkey, httpRelayListEvent, checkLogin } = useNostr()
  const [relays, setRelays] = useState<TMailboxRelay[]>([])
  const [hasChange, setHasChange] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 }
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
    if (!httpRelayListEvent) {
      setRelays([])
      setHasChange(false)
      return
    }
    const fromTags: TMailboxRelay[] = []
    httpRelayListEvent.tags.forEach((tag) => {
      if (tag[0] !== 'r' || !tag[1]) return
      const url = tag[1].trim()
      if (!isHttpRelayUrl(url)) return
      const n = normalizeHttpRelayUrl(url)
      if (!n) return
      const type = tag[2]
      const scope: TMailboxRelayScope =
        type === 'read' ? 'read' : type === 'write' ? 'write' : 'both'
      fromTags.push({ url: n, scope })
    })
    setRelays(fromTags)
    setHasChange(false)
  }, [httpRelayListEvent])

  if (!pubkey) {
    return (
      <div className="flex flex-col w-full items-center">
        <Button size="lg" onClick={() => checkLogin()}>
          {t('Login to set')}
        </Button>
      </div>
    )
  }

  if (httpRelayListEvent === undefined) {
    return <div className="text-center text-sm text-muted-foreground">{t('loading...')}</div>
  }

  const changeScope = (url: string, scope: TMailboxRelayScope) => {
    setRelays((prev) => prev.map((r) => (r.url === url ? { ...r, scope } : r)))
    setHasChange(true)
  }

  const removeRelay = (url: string) => {
    setRelays((prev) => prev.filter((r) => r.url !== url))
    setHasChange(true)
  }

  const saveNewRelay = (url: string) => {
    if (url === '') return null
    const normalizedUrl = normalizeHttpRelayUrl(url)
    if (!normalizedUrl) {
      return t('Invalid relay URL')
    }
    if (!isHttpRelayUrl(normalizedUrl)) {
      return t('HTTP relays must start with https:// or http://')
    }
    if (relays.some((r) => r.url === normalizedUrl)) {
      return t('Relay already exists')
    }
    setRelays([...relays, { url: normalizedUrl, scope: 'both' }])
    setHasChange(true)
    return null
  }

  const handleAddDiscovered = (newRelays: TMailboxRelay[]) => {
    const httpOnly = newRelays.filter((r) => isHttpRelayUrl(r.url))
    const toAdd = httpOnly.filter((nr) => !relays.some((r) => r.url === nr.url))
    if (toAdd.length > 0) {
      setRelays([...relays, ...toAdd])
      setHasChange(true)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{t('httpRelaysDescription')}</div>
        <div>{t('read relays description')}</div>
        <div>{t('write relays description')}</div>
        <div>{t('read & write relays notice')}</div>
      </div>
      <DiscoveredRelays onAdd={handleAddDiscovered} />
      <RelayCountWarning relays={relays} />
      <SaveButton mailboxRelays={relays} hasChange={hasChange} setHasChange={setHasChange} />
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
                changeMailboxRelayScope={changeScope}
                removeMailboxRelay={removeRelay}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <NewMailboxRelayInput saveNewMailboxRelay={saveNewRelay} />
    </div>
  )
}
