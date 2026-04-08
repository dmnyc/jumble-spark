/**
 * Shared highlight.js instance with a curated language subset.
 * Replaces the full `highlight.js` import (~969 kB) with a common subset (~350 kB).
 * Lazily imported via dynamic import() in article components.
 */
export { default } from 'highlight.js/lib/common'
