/**
 * OPML (Outline Processor Markup Language) utilities for RSS feed import/export
 */

export interface OpmlFeed {
  title?: string
  xmlUrl: string
  htmlUrl?: string
  text?: string
}

/**
 * Parse an OPML file and extract RSS feed URLs
 */
export function parseOpml(opmlText: string): OpmlFeed[] {
  const feeds: OpmlFeed[] = []
  
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(opmlText, 'text/xml')
    
    // Check for parsing errors
    const parserError = doc.querySelector('parsererror')
    if (parserError) {
      throw new Error('Invalid OPML file format')
    }
    
    // Find all outline elements with xmlUrl (RSS feeds)
    const outlines = doc.querySelectorAll('outline[xmlUrl]')
    
    outlines.forEach((outline) => {
      const xmlUrl = outline.getAttribute('xmlUrl')
      const htmlUrl = outline.getAttribute('htmlUrl')
      const title = outline.getAttribute('title')
      const text = outline.getAttribute('text')
      
      if (xmlUrl) {
        feeds.push({
          xmlUrl,
          htmlUrl: htmlUrl || undefined,
          title: title || undefined,
          text: text || undefined
        })
      }
    })
    
    // Also check for nested outlines (some OPML files nest feeds)
    const allOutlines = doc.querySelectorAll('outline')
    allOutlines.forEach((outline) => {
      const xmlUrl = outline.getAttribute('xmlUrl')
      if (xmlUrl && !feeds.some(f => f.xmlUrl === xmlUrl)) {
        const htmlUrl = outline.getAttribute('htmlUrl')
        const title = outline.getAttribute('title')
        const text = outline.getAttribute('text')
        
        feeds.push({
          xmlUrl,
          htmlUrl: htmlUrl || undefined,
          title: title || undefined,
          text: text || undefined
        })
      }
    })
    
    return feeds
  } catch (error) {
    throw new Error(`Failed to parse OPML file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Generate an OPML file from a list of feed URLs
 */
export function generateOpml(feedUrls: string[], title: string = 'RSS Feeds'): string {
  const now = new Date()
  const dateString = now.toUTCString()
  
  let opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${dateString}</dateCreated>
    <dateModified>${dateString}</dateModified>
  </head>
  <body>
`
  
  feedUrls.forEach((url) => {
    try {
      const urlObj = new URL(url)
      const feedTitle = urlObj.hostname.replace(/^www\./, '')
      opml += `    <outline type="rss" text="${escapeXml(feedTitle)}" title="${escapeXml(feedTitle)}" xmlUrl="${escapeXml(url)}" htmlUrl="${escapeXml(url)}"/>\n`
    } catch {
      // Invalid URL, skip it
    }
  })
  
  opml += `  </body>
</opml>`
  
  return opml
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Download a file with the given content and filename
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'application/xml') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

