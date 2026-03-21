import { usePrimaryPage, usePrimaryNoteView } from '@/PageManager'
import { Home } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function HomeButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title="Home"
      onClick={() => navigate('home')}
      active={display && current === 'home' && primaryViewType === null}
    >
      <Home strokeWidth={3} />
    </SidebarItem>
  )
}
