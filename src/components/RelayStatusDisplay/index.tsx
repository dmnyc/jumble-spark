import React from 'react'
import { Check, X } from 'lucide-react'
import { simplifyUrl } from '@/lib/url'

/**
 * Format relay error messages to be more user-friendly
 */
function formatRelayError(error: string): string {
  const lowerError = error.toLowerCase()
  
  // Handle confusing relay error messages
  if (lowerError.includes('blocked') && lowerError.includes('event marked as protected')) {
    return 'Relay rejected this content (may be due to content policy)'
  }
  
  if (lowerError.includes('blocked')) {
    return 'Relay blocked this content'
  }
  
  if (lowerError.includes('rate limit') || lowerError.includes('rate-limit')) {
    return 'Rate limited - please wait before trying again'
  }
  
  if (lowerError.includes('auth') && lowerError.includes('required')) {
    return 'Authentication required'
  }
  
  if (lowerError.includes('writes disabled') || lowerError.includes('write disabled')) {
    return 'Relay has temporarily disabled writes'
  }
  
  if (lowerError.includes('invalid key')) {
    return 'Authentication failed - invalid key'
  }
  
  if (lowerError.includes('timeout')) {
    return 'Request timed out'
  }
  
  if (lowerError.includes('connection') && lowerError.includes('refused')) {
    return 'Connection refused by relay'
  }
  
  // Return original error if no specific formatting applies
  return error
}

/**
 * Render text with URLs as clickable hyperlinks
 */
function renderTextWithLinks(text: string): React.ReactNode {
  // URL regex pattern - matches http://, https://, ws://, wss:// URLs
  const urlRegex = /(https?:\/\/[^\s]+|wss?:\/\/[^\s]+)/gi
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    
    // Add the URL as a link
    const url = match[0]
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 hover:underline break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    )
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  
  return parts.length > 0 ? <>{parts}</> : text
}

interface RelayStatus {
  url: string
  success: boolean
  error?: string
  message?: string
  authAttempted?: boolean
}

interface RelayStatusDisplayProps {
  relayStatuses: RelayStatus[]
  successCount: number
  totalCount: number
  className?: string
  /**
   * When `false`, hides the aggregate line. When a node, renders it instead of the default
   * “Published to …” copy (e.g. timeline REQ outcomes).
   */
  aggregateSummary?: React.ReactNode | false
}

export default function RelayStatusDisplay({
  relayStatuses,
  successCount,
  totalCount,
  className = '',
  aggregateSummary
}: RelayStatusDisplayProps) {
  if (relayStatuses.length === 0) {
    return null
  }

  const defaultSummary = (
    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
      Published to {successCount} of {totalCount} relays
    </div>
  )

  return (
    <div className={`space-y-2 ${className}`}>
      {aggregateSummary === false
        ? null
        : aggregateSummary !== undefined
          ? aggregateSummary
          : defaultSummary}

      <div className="space-y-1 max-w-full">
        {relayStatuses.map((status, index) => (
          <div
            key={index}
            className="flex items-start gap-2 text-sm min-w-0"
          >
            <div className="flex-shrink-0 mt-0.5">
              {status.success ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <X className="h-4 w-4 text-red-500" />
              )}
            </div>
            
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs break-all">
                    {simplifyUrl(status.url)}
                  </span>
                  {status.authAttempted && !status.success && (
                    <span className="text-xs text-red-600 dark:text-red-400 flex-shrink-0">
                      (auth failed)
                    </span>
                  )}
                </div>
                
                {!status.success && status.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 break-words">
                    {renderTextWithLinks(formatRelayError(status.error))}
                  </div>
                )}
                {status.success && status.message && (
                  <div className="text-xs text-green-600 dark:text-green-400 break-words">
                    {renderTextWithLinks(status.message)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
