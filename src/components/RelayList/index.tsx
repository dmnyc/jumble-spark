import { usePrimaryPage } from '@/contexts/primary-page-context'
import relayInfoService from '@/services/relay-info.service'
import { TRelayInfo } from '@/types'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '../RelaySimpleInfo'
import SearchInput from '../SearchInput'

export default function RelayList() {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const [loading, setLoading] = useState(true)
  const [relays, setRelays] = useState<TRelayInfo[]>([])
  const [showCount, setShowCount] = useState(20)
  const [input, setInput] = useState('')
  const [debouncedInput, setDebouncedInput] = useState(input)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const search = async () => {
      const relayInfos = await relayInfoService.search(debouncedInput)
      setShowCount(20)
      setRelays(relayInfos)
      setLoading(false)
    }
    search()
  }, [debouncedInput])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInput(input)
    }, 1000)

    return () => {
      clearTimeout(handler)
    }
  }, [input])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && showCount < relays.length) {
        setShowCount((prev) => prev + 20)
      }
    }, options)

    const currentBottomRef = bottomRef.current
    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [showCount, relays])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }

  return (
    <div>
      <div className="px-4 py-2">
        <SearchInput placeholder={t('Search relays')} value={input} onChange={handleInputChange} />
      </div>
      {relays.slice(0, showCount).map((relay) => (
        <RelaySimpleInfo
          key={relay.url}
          relayInfo={relay}
          className="clickable p-4 border-b"
          onClick={(e) => {
            e.stopPropagation()
            navigate('relay', { url: relay.url })
          }}
        />
      ))}
      {showCount < relays.length && <div ref={bottomRef} />}
      {loading && <RelaySimpleInfoSkeleton className="p-4" />}
      {!loading && relays.length === 0 && (
        <div className="text-center text-muted-foreground text-sm">{t('no relays found')}</div>
      )}
    </div>
  )
}
