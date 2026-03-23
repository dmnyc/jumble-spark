import { useKeyboardShortcutsHelp } from '@/contexts/keyboard-shortcuts-help-context'
import { CircleHelp } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function KeyboardShortcutsHelpSidebarButton() {
  const { openHelp } = useKeyboardShortcutsHelp()

  return (
    <SidebarItem title="help.title" onClick={openHelp}>
      <CircleHelp strokeWidth={2.5} />
    </SidebarItem>
  )
}
