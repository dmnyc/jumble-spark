import ProfileSearchBar from '@/components/ui/ProfileSearchBar'
import { PROFILE_PUBLICATIONS_TAB_KINDS } from '@/constants'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ProfileTimeline from './ProfileTimeline'

const ProfilePublicationsFeed = forwardRef<{ refresh: () => void }, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const kindsList = useMemo(() => [...PROFILE_PUBLICATIONS_TAB_KINDS], [])
  const cacheKey = useMemo(() => `${pubkey}-profile-publications`, [pubkey])

  const getKindLabel = (_kindValue: string) => t('articles and publications')

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-2">
        <ProfileSearchBar
          onSearch={setSearchQuery}
          placeholder={t('Search articles...')}
          className="w-64 max-w-full"
        />
      </div>
      <ProfileTimeline
        ref={ref}
        pubkey={pubkey}
        topSpace={0}
        searchQuery={searchQuery}
        kindFilter="all"
        kinds={kindsList}
        cacheKey={cacheKey}
        getKindLabel={getKindLabel}
        refreshLabel={t('Refreshing articles...')}
        emptyLabel={t('No articles or publications found')}
        emptySearchLabel={t('No articles or publications match your search')}
      />
    </div>
  )
})

ProfilePublicationsFeed.displayName = 'ProfilePublicationsFeed'

export default ProfilePublicationsFeed
