import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow
} from '@/components/ui/settings'
import { LocalizedLanguageNames } from '@/i18n'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useTranslationService } from '@/providers/TranslationServiceProvider'
import { TLanguage } from '@/types'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import JumbleTranslate from './JumbleTranslate'
import LibreTranslate from './LibreTranslate'

const TranslationPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t, i18n } = useTranslation()
  const { config, updateConfig } = useTranslationService()
  const [language, setLanguage] = useState<TLanguage>(i18n.language as TLanguage)

  const handleLanguageChange = (value: TLanguage) => {
    i18n.changeLanguage(value)
    setLanguage(value)
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Translation')}>
      <SettingsPageContainer>
        <SettingsGroup title={t('Translation')}>
          <SettingsRow
            htmlFor="languages"
            title={t('Languages')}
            control={
              <Select defaultValue="en" value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger id="languages" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LocalizedLanguageNames).map(([key, value]) => (
                    <SelectItem key={key} value={key}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            htmlFor="translation-service-select"
            title={t('Service')}
            control={
              <Select
                defaultValue={config.service}
                value={config.service}
                onValueChange={(newService) => {
                  updateConfig({ service: newService as 'jumble' | 'libre_translate' })
                }}
              >
                <SelectTrigger id="translation-service-select" className="w-44">
                  <SelectValue placeholder={t('Select Translation Service')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jumble">Jumble</SelectItem>
                  <SelectItem value="libre_translate">LibreTranslate</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </SettingsGroup>

        {config.service === 'jumble' ? <JumbleTranslate /> : <LibreTranslate />}
      </SettingsPageContainer>
    </SecondaryPageLayout>
  )
})
TranslationPage.displayName = 'TranslationPage'
export default TranslationPage
