import dayjs from 'dayjs'
import i18n, { Resource } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'

/** Display names only — keeps this module small; locale strings load on demand (except English). */
const LANGUAGE_META = {
  ar: 'العربية',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fa: 'فارسی',
  fr: 'Français',
  hi: 'हिन्दी',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pl: 'Polski',
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  ru: 'Русский',
  th: 'ไทย',
  zh: '简体中文'
} as const

export type TLanguage = keyof typeof LANGUAGE_META

export const LocalizedLanguageNames: { [key in TLanguage]: string } = { ...LANGUAGE_META }

export const supportedLanguages = Object.keys(LANGUAGE_META) as TLanguage[]

const localeModules = import.meta.glob<{ default: Resource }>('./locales/*.ts')

const localePath = (code: TLanguage): string => `./locales/${code}.ts`

function normalizeToSupported(lng: string): TLanguage {
  const exact = supportedLanguages.find((s) => lng === s)
  if (exact) return exact
  return supportedLanguages.find((s) => lng.startsWith(s)) ?? 'en'
}

export async function ensureLocaleLoaded(code: TLanguage): Promise<void> {
  if (code === 'en') return
  if (i18n.hasResourceBundle(code, 'translation')) return
  const load = localeModules[localePath(code)]
  if (!load) {
    console.warn('[i18n] Missing locale module for', code)
    return
  }
  const mod = await load()
  i18n.addResourceBundle(code, 'translation', mod.default.translation, true, true)
}

export async function changeAppLanguage(code: TLanguage): Promise<void> {
  await ensureLocaleLoaded(code)
  await i18n.changeLanguage(code)
}

let initPromise: Promise<void> | null = null

export function initI18n(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    await i18n.use(LanguageDetector).use(initReactI18next).init({
      fallbackLng: 'en',
      supportedLngs: supportedLanguages,
      resources: { en },
      partialBundledLanguages: true,
      interpolation: {
        escapeValue: false
      },
      detection: {
        convertDetectedLanguage: (lng) => normalizeToSupported(lng)
      }
    })

    i18n.services.formatter?.add('date', (timestamp, lng) => {
      switch (lng) {
        case 'zh':
        case 'ja':
          return dayjs(timestamp).format('YYYY年MM月DD日')
        case 'pl':
        case 'de':
        case 'ru':
          return dayjs(timestamp).format('DD.MM.YYYY')
        case 'fa':
          return dayjs(timestamp).format('YYYY/MM/DD')
        case 'it':
        case 'es':
        case 'fr':
        case 'pt-BR':
        case 'pt-PT':
        case 'ar':
        case 'hi':
        case 'th':
          return dayjs(timestamp).format('DD/MM/YYYY')
        case 'ko':
          return dayjs(timestamp).format('YYYY년 MM월 DD일')
        default:
          return dayjs(timestamp).format('MMM D, YYYY')
      }
    })

    const target = normalizeToSupported(i18n.language)
    if (target !== 'en') {
      await ensureLocaleLoaded(target)
      await i18n.changeLanguage(target)
    }
  })()
  return initPromise
}

export default i18n
