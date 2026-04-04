import Profile from '@/components/Profile'
import { RefreshButton } from '@/components/RefreshButton'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import {
  applyDefaultSiteSocialMeta,
  avatarProxyUrl,
  defaultOgImageAbsoluteUrl,
  removeMetaByProperty,
  SITE_NAME,
  updateMetaTag
} from '@/lib/document-meta'
import { forwardRef, useCallback, useEffect, useRef } from 'react'

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

  useEffect(() => {
    if (!profile) {
      applyDefaultSiteSocialMeta()
      updateMetaTag('og:type', 'profile')
      return
    }

    const username = profile.username || ''
    const ogTitle = username ? `@${username} · ${SITE_NAME}` : `Profile · ${SITE_NAME}`

    const fullUrl = window.location.href
    const truncatedUrl = fullUrl.length > 150 ? fullUrl.substring(0, 147) + '...' : fullUrl

    let ogDescription = username ? `@${username}` : 'Profile'
    if (profile.nip05) {
      ogDescription += ` • ${profile.nip05}`
    }
    if (profile.about) {
      const aboutPreview = profile.about.length > 200 ? profile.about.substring(0, 197) + '...' : profile.about
      ogDescription += ` | ${aboutPreview}`
    }
    ogDescription += ` | ${truncatedUrl}`

    const image = profile.avatar ? avatarProxyUrl(profile.pubkey) : defaultOgImageAbsoluteUrl()

    updateMetaTag('og:title', ogTitle)
    updateMetaTag('og:description', ogDescription)
    updateMetaTag('og:image', image)
    updateMetaTag('og:image:width', '1200')
    updateMetaTag('og:image:height', '630')
    updateMetaTag('og:image:alt', `${username ? `@${username}` : 'Profile'} on ${SITE_NAME}`)
    updateMetaTag('og:type', 'profile')
    updateMetaTag('og:url', window.location.href)
    updateMetaTag('og:site_name', SITE_NAME)

    if (profile.username) {
      updateMetaTag('profile:username', profile.username)
    }
    if (profile.nip05) {
      updateMetaTag('profile:username', profile.nip05)
    }

    updateMetaTag('twitter:card', 'summary_large_image')
    updateMetaTag('twitter:title', ogTitle)
    updateMetaTag('twitter:description', ogDescription.length > 200 ? ogDescription.substring(0, 197) + '...' : ogDescription)
    updateMetaTag('twitter:image', image)
    updateMetaTag('twitter:image:alt', `${username ? `@${username}` : 'Profile'} on ${SITE_NAME}`)

    document.title = ogTitle

    return () => {
      applyDefaultSiteSocialMeta()
      updateMetaTag('og:type', 'website')
      removeMetaByProperty('profile:username')
      document.title = SITE_NAME
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
