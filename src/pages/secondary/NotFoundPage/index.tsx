import NotFound from '@/components/NotFound'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef, useCallback, useState } from 'react'

const NotFoundPage = forwardRef(({ index }: { index?: number }, ref) => {
  const [contentKey, setContentKey] = useState(0)
  const bump = useCallback(() => setContentKey((k) => k + 1), [])
  return (
    <SecondaryPageLayout ref={ref} index={index} hideBackButton controls={<RefreshButton onClick={bump} />}>
      <div key={contentKey}>
        <NotFound />
      </div>
    </SecondaryPageLayout>
  )
})
NotFoundPage.displayName = 'NotFoundPage'
export default NotFoundPage
