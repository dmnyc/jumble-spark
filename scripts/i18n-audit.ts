/**
 * Audit: t('...') keys in src vs en translation.
 * Run: npx tsx scripts/i18n-audit.ts
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import en from '../src/i18n/locales/en'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    if (raw.length > 0 && raw.length < 400) keys.add(raw)
  }
  const re2 = /\bt\(\s*"((?:\\.|[^"\\])*)"/g
  while ((m = re2.exec(content)) !== null) {
    const raw = unquoteDouble(m[1])
    if (raw.length > 0 && raw.length < 400) keys.add(raw)
  }
  return keys
}

const root = path.join(__dirname, '..')
const srcDir = path.join(root, 'src')
const files = walk(srcDir)
const used = new Set<string>()
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8')
  for (const k of extractTKeys(c)) used.add(k)
}

const enKeys = new Set(Object.keys(en.translation))
const missingInEn = [...used].filter((k) => !enKeys.has(k)).sort()
const orphanInEn = [...enKeys].filter((k) => !used.has(k)).sort()

console.log('Used t() keys:', used.size)
console.log('en keys:', enKeys.size)
console.log('Used but missing in en:', missingInEn.length)
if (missingInEn.length) console.log(missingInEn.join('\n'))
console.log('In en but not in t()-scan (may be dynamic / false orphan):', orphanInEn.length)
if (orphanInEn.length) console.log(orphanInEn.slice(0, 100).join('\n'))
