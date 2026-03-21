import { useSecondaryPage } from '@/PageManager'
import { useEffect } from 'react'

/** Legacy `/follow-packs` opens Spells → Follow Packs faux feed. */
export default function FollowPacksRedirect() {
  const { navigateToPrimaryPage } = useSecondaryPage()
  useEffect(() => {
    navigateToPrimaryPage('spells', { spell: 'followPacks' })
  }, [navigateToPrimaryPage])
  return null
}
