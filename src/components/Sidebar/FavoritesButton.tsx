import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import { Star } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function FavoritesButton() {
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const { pubkey } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell

  if (!pubkey) return null

  return (
    <SidebarItem
      title="Favorites"
      onClick={() => navigate('spells', { spell: 'favorites' })}
      active={
        display &&
        current === 'spells' &&
        primaryViewType === null &&
        spell === 'favorites'
      }
    >
      <Star strokeWidth={3} />
    </SidebarItem>
  )
}
