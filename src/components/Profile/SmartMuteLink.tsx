import { toMuteList } from '@/lib/link'
import { useSmartMuteListNavigation } from '@/PageManager'
import { useMuteList } from '@/contexts/mute-list-context'
import { useTranslation } from 'react-i18next'

export default function SmartMuteLink() {
  const { t } = useTranslation()
  const { mutePubkeySet } = useMuteList()
  const { navigateToMuteList } = useSmartMuteListNavigation()

  const handleClick = () => {
    navigateToMuteList(toMuteList())
  }

  return (
    <span
      className="flex gap-1 hover:underline w-fit cursor-pointer"
      onClick={handleClick}
    >
      {mutePubkeySet.size}
      <div className="text-muted-foreground">{t('Muted')}</div>
    </span>
  )
}
