import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import lightning from '@/services/lightning.service'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DonationDialog, { DONATION_PRESETS } from './DonationDialog'
import PlatinumSponsors from './PlatinumSponsors'
import RecentSupporters from './RecentSupporters'

export default function Donation({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [donationAmount, setDonationAmount] = useState<number | undefined>(undefined)
  const [supportersRefreshKey, setSupportersRefreshKey] = useState(0)
  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pendingRefreshRef.current) clearTimeout(pendingRefreshRef.current)
    }
  }, [])

  const handleDonated = () => {
    if (pendingRefreshRef.current) clearTimeout(pendingRefreshRef.current)
    pendingRefreshRef.current = setTimeout(() => {
      lightning.invalidateRecentSupportersCache()
      setSupportersRefreshKey((k) => k + 1)
    }, 6000)
  }

  return (
    <div className={cn('space-y-8', className)}>
      <section className="space-y-4">
        <div className="space-y-1.5 text-center">
          <div className="text-lg font-semibold">{t('Enjoying Jumble?')}</div>
          <div className="text-muted-foreground text-sm">
            {t('Your donation helps me maintain Jumble and make it better! 😊')}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DONATION_PRESETS.map(({ amount, emoji, display }) => (
            <Button
              variant="secondary"
              key={amount}
              onClick={() => {
                setDonationAmount(amount)
                setOpen(true)
              }}
            >
              <span>{emoji}</span>
              <span className="tabular-nums">{display}</span>
            </Button>
          ))}
        </div>
      </section>

      <PlatinumSponsors />
      <RecentSupporters refreshKey={supportersRefreshKey} />

      <DonationDialog
        open={open}
        setOpen={setOpen}
        defaultAmount={donationAmount}
        onDonated={handleDonated}
      />
    </div>
  )
}
