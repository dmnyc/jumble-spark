import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { useUserTrust } from '@/contexts/user-trust-context'
import { VariantProps } from 'class-variance-authority'
import { Shield, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function HideUntrustedContentButton({
  type,
  size = 'icon'
}: {
  type: 'interactions' | 'notifications'
  size?: VariantProps<typeof buttonVariants>['size']
}) {
  const { t } = useTranslation()
  const {
    hideUntrustedInteractions,
    hideUntrustedNotifications,
    updateHideUntrustedInteractions,
    updateHideUntrustedNotifications
  } = useUserTrust()

  const enabled = type === 'interactions' ? hideUntrustedInteractions : hideUntrustedNotifications

  const updateEnabled =
    type === 'interactions' ? updateHideUntrustedInteractions : updateHideUntrustedNotifications

  const typeText = t(type)

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size={size} className="[&_svg]:size-3.5">
          {enabled ? (
            <ShieldCheck className="text-green-400" />
          ) : (
            <Shield className="text-muted-foreground" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {enabled
              ? t('Show untrusted {type}', { type: typeText })
              : t('Hide untrusted {type}', { type: typeText })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {enabled
              ? t('Currently hiding {type} from untrusted users.', { type: typeText })
              : t('Currently showing all {type}.', { type: typeText })}{' '}
            {t('Trusted users include people you follow and people they follow.')}{' '}
            {enabled
              ? t('Click continue to show all {type}.', { type: typeText })
              : t('Click continue to hide {type} from untrusted users.', { type: typeText })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => updateEnabled(!enabled)}>
            {t('Continue')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
