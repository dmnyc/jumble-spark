import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/PageManager'
import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function HomeButton() {
  const { t } = useTranslation()
  const { navigate, current, display } = usePrimaryPage()
  const { primaryViewType } = usePrimaryNoteView()
  const active = display && current === 'feed' && primaryViewType === null

  return (
    <SidebarItem
      title={t('Favorites Feed')}
      onClick={() => navigate('feed')}
      active={active}
      className={cn(
        '[&_svg]:!h-[1.45rem] [&_svg]:!w-[1.45rem] xl:[&_svg]:!h-7 xl:[&_svg]:!w-7',
        'text-green-600 opacity-90 hover:opacity-100 dark:text-green-500',
        active && 'bg-green-500/15 opacity-100 hover:bg-green-500/15 dark:bg-green-500/20'
      )}
    >
      <Star
        strokeWidth={active ? 2.75 : 2.35}
        className={cn(active && 'fill-green-500/30 dark:fill-green-400/35')}
      />
    </SidebarItem>
  )
}
