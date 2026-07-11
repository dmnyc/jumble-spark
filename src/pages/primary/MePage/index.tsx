import MeDrawerContent from '@/components/MeDrawer/MeDrawerContent'
import { SparkWalletBalance } from '@/components/SparkWalletBalance'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { forwardRef } from 'react'

function MePageTitlebar() {
  return (
    <div className="flex w-full items-center justify-end gap-1">
      <SparkWalletBalance />
    </div>
  )
}

const MePage = forwardRef<TPageRef>((_, ref) => {
  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="home"
      titlebar={<MePageTitlebar />}
      hideTitlebarBottomBorder
    >
      <MeDrawerContent />
    </PrimaryPageLayout>
  )
})
MePage.displayName = 'MePage'
export default MePage
