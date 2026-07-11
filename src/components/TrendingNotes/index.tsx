import { ALLOWED_FILTER_KINDS, TRENDING_NOTES_RELAY_URLS } from '@/constants'
import NoteList from '../NoteList'
import RecommendedFollows from '../RecommendedFollows'

export default function TrendingNotes() {
  return (
    <>
      <RecommendedFollows />
      <NoteList
        showKinds={ALLOWED_FILTER_KINDS}
        subRequests={[{ urls: TRENDING_NOTES_RELAY_URLS, filter: {} }]}
        showRelayCloseReason
      />
    </>
  )
}
