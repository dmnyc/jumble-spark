/**
 * Rasterize public/og-image.svg → public/og-image.png with a true Playfair Display wordmark.
 * ImageMagick/Inkscape copy the SVG to /tmp, so @font-face + file URLs often never load;
 * we outline "Imwald" with opentype.js so the PNG is font-independent.
 *
 * Wordmark fill + weight are read from the `#og-imwald` <text> in the SVG so PNG matches
 * the green-tinged off-white you see in the browser (rasterizers often look harsher than live text).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'public/og-image.svg')
const fontPath = join(root, 'public/fonts/PlayfairDisplay-wght.ttf')
const outPng = join(root, 'public/og-image.png')
const tmpSvg = join(root, 'public/.og-image.raster.svg')

function parseOgImwaldFromSvg(svg) {
  const defaults = { fill: '#d4ebe0', weight: 700, letterSpacing: 0.018 }
  const idPos = svg.indexOf('id="og-imwald"')
  if (idPos < 0) return defaults
  const textOpen = svg.lastIndexOf('<text', idPos)
  const textClose = svg.indexOf('</text>', idPos)
  if (textOpen < 0 || textClose < 0) return defaults
  const t = svg.slice(textOpen, textClose + '</text>'.length)
  const fill = t.match(/\bfill="([^"]+)"/)?.[1] ?? defaults.fill
  const weight = parseInt(t.match(/font-weight="(\d+)"/)?.[1] ?? String(defaults.weight), 10)
  return {
    fill,
    weight: Number.isFinite(weight) ? weight : defaults.weight,
    letterSpacing: defaults.letterSpacing
  }
}

let svg = readFileSync(svgPath, 'utf8')
const { fill: imwaldFill, weight: imwaldWght, letterSpacing } = parseOgImwaldFromSvg(svg)

const font = opentype.loadSync(fontPath)
const pathObj = font.getPath('Imwald', 72, 300, 108, {
  variation: { wght: imwaldWght },
  letterSpacing
})
let pathTag = pathObj.toSVG(2)
if (!pathTag.includes('fill=')) {
  pathTag = pathTag.replace('<path ', `<path fill="${imwaldFill}" `)
}

svg = svg.replace(/<text[^>]*id="og-imwald"[^>]*>[\s\S]*?<\/text>/, pathTag)

writeFileSync(tmpSvg, svg, 'utf8')

try {
  execFileSync('convert', ['-background', 'none', '-density', '150', tmpSvg, outPng], {
    stdio: 'inherit',
    cwd: root
  })
} finally {
  try {
    unlinkSync(tmpSvg)
  } catch {
    /* ignore */
  }
}

console.info('[og:image] wrote', outPng)
