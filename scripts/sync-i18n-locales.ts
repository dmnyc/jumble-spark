/**
 * Merge t() keys from src into en, then regenerate all locale files with the same key set.
 * Missing non-English strings fall back to English.
 *
 * Run: npx tsx scripts/sync-i18n-locales.ts && npx prettier --write "src/i18n/locales/*.ts"
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ar from '../src/i18n/locales/ar'
import de from '../src/i18n/locales/de'
import en from '../src/i18n/locales/en'
import es from '../src/i18n/locales/es'
import fa from '../src/i18n/locales/fa'
import fr from '../src/i18n/locales/fr'
import hi from '../src/i18n/locales/hi'
import it from '../src/i18n/locales/it'
import ja from '../src/i18n/locales/ja'
import ko from '../src/i18n/locales/ko'
import pl from '../src/i18n/locales/pl'
import pt_BR from '../src/i18n/locales/pt-BR'
import pt_PT from '../src/i18n/locales/pt-PT'
import ru from '../src/i18n/locales/ru'
import th from '../src/i18n/locales/th'
import zh from '../src/i18n/locales/zh'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')
const localesDir = path.join(__dirname, '..', 'src/i18n/locales')
const overridesDir = path.join(__dirname, 'i18n-overrides')

function loadOverrides(localeFile: string): Record<string, string> {
  if (localeFile === 'en.ts') return {}
  const p = path.join(overridesDir, localeFile.replace(/\.ts$/, '.json'))
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

const PACKAGES: { file: string; translation: Record<string, string>; header?: string }[] = [
  { file: 'ar.ts', translation: ar.translation },
  { file: 'de.ts', translation: de.translation, header: '// NOTE: Untranslated strings fall back to English.\n' },
  { file: 'en.ts', translation: en.translation },
  { file: 'es.ts', translation: es.translation },
  { file: 'fa.ts', translation: fa.translation },
  { file: 'fr.ts', translation: fr.translation },
  { file: 'hi.ts', translation: hi.translation },
  { file: 'it.ts', translation: it.translation },
  { file: 'ja.ts', translation: ja.translation },
  { file: 'ko.ts', translation: ko.translation },
  { file: 'pl.ts', translation: pl.translation },
  { file: 'pt-BR.ts', translation: pt_BR.translation },
  { file: 'pt-PT.ts', translation: pt_PT.translation },
  { file: 'ru.ts', translation: ru.translation },
  { file: 'th.ts', translation: th.translation },
  { file: 'zh.ts', translation: zh.translation }
]

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(p, acc)
    } else if (/\.(tsx|ts)$/.test(name)) acc.push(p)
  }
  return acc
}

function unquoteSingle(s: string) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}
function unquoteDouble(s: string) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function extractTKeys(content: string): Set<string> {
  const keys = new Set<string>()
  const re1 = /\bt\(\s*'((?:\\.|[^'\\])*)'/g
  let m
  while ((m = re1.exec(content)) !== null) {
    const raw = unquoteSingle(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  const re2 = /\bt\(\s*"((?:\\.|[^"\\])*)"/g
  while ((m = re2.exec(content)) !== null) {
    const raw = unquoteDouble(m[1])
    if (raw.length > 0 && raw.length < 500) keys.add(raw)
  }
  return keys
}

function formatKey(k: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(k)) return k
  return JSON.stringify(k)
}

function formatValue(v: string): string {
  return JSON.stringify(v)
}

function emitLocaleFile(translation: Record<string, string>, keyOrder: string[], headerComment?: string): string {
  const lines: string[] = ['export default {', '  translation: {']
  if (headerComment) lines.push(`    ${headerComment}`)
  for (const k of keyOrder) {
    const v = translation[k]
    if (v === undefined) continue
    lines.push(`    ${formatKey(k)}: ${formatValue(v)},`)
  }
  lines.push('  }', '}', '')
  return lines.join('\n')
}

const used = new Set<string>()
for (const f of walk(srcDir)) {
  const c = fs.readFileSync(f, 'utf8')
  for (const k of extractTKeys(c)) used.add(k)
}

const prevEn = { ...en.translation } as Record<string, string>
const prevKeys = Object.keys(prevEn)
const newOnly = [...used].filter((k) => !(k in prevEn)).sort()
const keyOrder = [...prevKeys, ...newOnly]

const mergedEn: Record<string, string> = {}
for (const k of keyOrder) {
  mergedEn[k] = k in prevEn ? prevEn[k] : k
}

for (const pkg of PACKAGES) {
  const prev = pkg.translation as Record<string, string>
  const patch = loadOverrides(pkg.file)
  const out: Record<string, string> = {}
  for (const k of keyOrder) {
    const base = prev[k] !== undefined ? prev[k] : mergedEn[k]
    out[k] = patch[k] !== undefined ? patch[k] : base
  }
  const body = emitLocaleFile(out, keyOrder, pkg.header)
  fs.writeFileSync(path.join(localesDir, pkg.file), body, 'utf8')
}

console.log('Keys:', keyOrder.length, '| New from scan:', newOnly.length)
