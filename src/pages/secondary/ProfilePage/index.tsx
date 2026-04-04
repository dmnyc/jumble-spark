import Profile from '@/components/Profile'
import { RefreshButton } from '@/components/RefreshButton'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { forwardRef, useCallback, useEffect, useRef } from 'react'

// Helper function to update or create meta tags
function updateMetaTag(property: string, content: string) {
  const prop = property.startsWith('og:') || property.startsWith('article:') ? property : property.replace(/^property="|"$/, '')
  
  // Handle Twitter card tags (they use name attribute, not property)
  const isTwitterTag = prop.startsWith('twitter:')
  const selector = isTwitterTag ? `meta[name="${prop}"]` : `meta[property="${prop}"]`
  
  let meta = document.querySelector(selector)
  if (!meta) {
    meta = document.createElement('meta')
    if (isTwitterTag) {
      meta.setAttribute('name', prop)
    } else {
      meta.setAttribute('property', prop)
    }
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', content)
}

const ProfilePage = forwardRef(({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const feedRef = useRef<{ refresh: () => void }>(null)
  const bumpFeed = useCallback(() => feedRef.current?.refresh(), [])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpFeed)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpFeed])

  const { profile } = useFetchProfile(id)
  
  // Update OpenGraph metadata to match fallback card format for profiles
  useEffect(() => {
    if (!profile) {
      // Reset to default meta tags
      const defaultUrl = window.location.href
      const truncatedDefaultUrl = defaultUrl.length > 150 ? defaultUrl.substring(0, 147) + '...' : defaultUrl
      updateMetaTag('og:title', 'Imwald ')
      updateMetaTag('og:description', `${truncatedDefaultUrl} - A user-friendly Nostr client focused on relay feed browsing and relay discovery. The Imwald edition focuses on publications and articles.`)
      updateMetaTag('og:image', 'https://jumble.imwald.eu/og-image.png')
      updateMetaTag('og:type', 'profile')
      updateMetaTag('og:url', window.location.href)
      updateMetaTag('og:site_name', 'Imwald ')
      
      // Twitter card meta tags
      updateMetaTag('twitter:card', 'summary')
      updateMetaTag('twitter:title', 'Imwald ')
      updateMetaTag('twitter:description', `${truncatedDefaultUrl} - Profile`)
      updateMetaTag('twitter:image', 'https://jumble.imwald.eu/og-image.png')
      
      return
    }
    
    // Build description matching fallback card: username, hostname, URL
    const username = profile.username || ''
    const ogTitle = username ? `@${username} - Imwald ` : 'Profile - Imwald '
    
    // Truncate URL to 150 chars
    const fullUrl = window.location.href
    const truncatedUrl = fullUrl.length > 150 ? fullUrl.substring(0, 147) + '...' : fullUrl
    
    // Build rich description with profile info
    let ogDescription = username ? `@${username}` : 'Profile'
    if (profile.nip05) {
      ogDescription += ` • ${profile.nip05}`
    }
    if (profile.about) {
      const aboutPreview = profile.about.length > 200 ? profile.about.substring(0, 197) + '...' : profile.about
      ogDescription += ` | ${aboutPreview}`
    }
    ogDescription += ` | ${truncatedUrl}`
    
    // Use profile avatar or default image with green theme
    const image = profile.avatar 
      ? `https://jumble.imwald.eu/api/avatar/${profile.pubkey}` 
      : 'https://jumble.imwald.eu/og-image.png'
    
    updateMetaTag('og:title', ogTitle)
    updateMetaTag('og:description', ogDescription)
    updateMetaTag('og:image', image)
    updateMetaTag('og:image:width', '1200')
    updateMetaTag('og:image:height', '630')
    updateMetaTag('og:image:alt', `${username ? `@${username}` : 'Profile'} on Imwald`)
    updateMetaTag('og:type', 'profile')
    updateMetaTag('og:url', window.location.href)
    updateMetaTag('og:site_name', 'Imwald ')
    
    // Add profile-specific meta tags
    if (profile.username) {
      updateMetaTag('profile:username', profile.username)
    }
    if (profile.nip05) {
      updateMetaTag('profile:username', profile.nip05)
    }
    
    // Twitter card meta tags
    updateMetaTag('twitter:card', 'summary_large_image')
    updateMetaTag('twitter:title', ogTitle)
    updateMetaTag('twitter:description', ogDescription.length > 200 ? ogDescription.substring(0, 197) + '...' : ogDescription)
    updateMetaTag('twitter:image', image)
    updateMetaTag('twitter:image:alt', `${username ? `@${username}` : 'Profile'} on Imwald`)
    
    // Update document title
    document.title = `${ogTitle} - Imwald`
    
    // Cleanup function
    return () => {
      // Reset to default on unmount
      const cleanupUrl = window.location.href
      const truncatedCleanupUrl = cleanupUrl.length > 150 ? cleanupUrl.substring(0, 147) + '...' : cleanupUrl
      updateMetaTag('og:title', 'Imwald ')
      updateMetaTag('og:description', `${truncatedCleanupUrl} - A user-friendly Nostr client focused on relay feed browsing and relay discovery. The Imwald edition focuses on publications and articles.`)
      updateMetaTag('og:image', 'https://jumble.imwald.eu/og-image.png')
      updateMetaTag('og:type', 'website')
      updateMetaTag('og:url', window.location.href)
      updateMetaTag('og:site_name', 'Imwald ')
      document.title = 'Imwald '
    }
  }, [profile])

  return (
    <SecondaryPageLayout
      index={index}
      title={hideTitlebar ? undefined : profile?.username}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bumpFeed} />}
      displayScrollToTopButton
      ref={ref}
    >
      <Profile id={id} feedRef={feedRef} />
    </SecondaryPageLayout>
  )
})
ProfilePage.displayName = 'ProfilePage'
export default ProfilePage
