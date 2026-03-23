import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/PageManager'
import { Search } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function SearchButton() {
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()

  return (
    <SidebarItem
      title="Search"
      onClick={() => navigate('search')}
      active={current === 'search' && display && primaryViewType === null}
    >
      <Search strokeWidth={3} />
    </SidebarItem>
  )
}
