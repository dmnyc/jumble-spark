import { Button } from '@/components/ui/button'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import storage from '@/services/local-storage.service'
import { PanelLeft, PanelsLeftRight } from 'lucide-react'
import { useState } from 'react'

export default function PaneModeToggle() {
  const { isSmallScreen } = useScreenSize()
  const [panelMode, setPanelMode] = useState<'single' | 'double'>(() => storage.getPanelMode())

  // Hide on mobile
  if (isSmallScreen) return null

  const toggleMode = () => {
    const newMode = panelMode === 'single' ? 'double' : 'single'
    setPanelMode(newMode)
    storage.setPanelMode(newMode)
  }

  return (
    <Button
      variant="ghost"
      className="flex shadow-none items-center transition-colors duration-500 bg-transparent w-12 h-12 xl:w-full xl:h-auto p-3 m-0 xl:py-2 xl:px-3 rounded-lg xl:justify-start gap-4 text-lg font-semibold [&_svg]:size-full xl:[&_svg]:size-4"
      title={panelMode === 'single' ? 'Switch to double-pane mode' : 'Switch to single-pane mode'}
      onClick={toggleMode}
    >
      {panelMode === 'single' ? (
        <PanelLeft strokeWidth={3} />
      ) : (
        <PanelsLeftRight strokeWidth={3} />
      )}
      <div className="max-xl:hidden">
        {panelMode === 'single' ? 'Single-pane' : 'Double-pane'}
      </div>
    </Button>
  )
}
