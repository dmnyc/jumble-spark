import 'yet-another-react-lightbox/styles.css'
import './index.css'

import PublishSuccessSubtleIndicator from '@/components/PublishSuccessSubtleIndicator'
import ReadAloudPlayerModal from '@/components/ReadAloudPlayerModal'
import { Toaster } from '@/components/ui/sonner'
import { BookmarksProvider } from '@/providers/BookmarksProvider'
import { ContentPolicyProvider } from '@/providers/ContentPolicyProvider'
import { DeletedEventProvider } from '@/providers/DeletedEventProvider'
import { FavoriteRelaysActivityProvider } from '@/providers/FavoriteRelaysActivityProvider'
import { FavoriteRelaysProvider } from '@/providers/FavoriteRelaysProvider'
import { FeedProvider } from '@/providers/FeedProvider'
import { FontSizeProvider } from '@/providers/FontSizeProvider'
import { FollowListProvider } from '@/providers/FollowListProvider'
import { GroupListProvider } from '@/providers/GroupListProvider'
import { InterestListProvider } from '@/providers/InterestListProvider'
import { KindFilterProvider } from '@/providers/KindFilterProvider'
import { MediaUploadServiceProvider } from '@/providers/MediaUploadServiceProvider'
import { MuteListProvider } from '@/providers/MuteListProvider'
import { NostrProvider } from '@/providers/NostrProvider'
import { ReplyProvider } from '@/providers/ReplyProvider'
import { ScreenSizeProvider } from '@/providers/ScreenSizeProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { UserPreferencesProvider } from '@/providers/UserPreferencesProvider'
import { UserTrustProvider } from '@/providers/UserTrustProvider'
import { ZapProvider } from '@/providers/ZapProvider'
import StartupSessionBanner from '@/components/StartupSessionBanner'
import { PageManager } from './PageManager'

export default function App(): JSX.Element {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <ContentPolicyProvider>
          <ScreenSizeProvider>
          <DeletedEventProvider>
            <NostrProvider>
              <div className="flex min-h-[100dvh] flex-col">
                <StartupSessionBanner />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <ZapProvider>
                    <FavoriteRelaysProvider>
                      <FollowListProvider>
                        <MuteListProvider>
                          <FavoriteRelaysActivityProvider>
                            <InterestListProvider>
                              <GroupListProvider>
                                <UserTrustProvider>
                                  <BookmarksProvider>
                                    <FeedProvider>
                                      <ReplyProvider>
                                        <MediaUploadServiceProvider>
                                          <KindFilterProvider>
                                            <UserPreferencesProvider>
                                              <PageManager />
                                              <ReadAloudPlayerModal />
                                              <PublishSuccessSubtleIndicator />
                                              <Toaster />
                                            </UserPreferencesProvider>
                                          </KindFilterProvider>
                                        </MediaUploadServiceProvider>
                                      </ReplyProvider>
                                    </FeedProvider>
                                  </BookmarksProvider>
                                </UserTrustProvider>
                              </GroupListProvider>
                            </InterestListProvider>
                          </FavoriteRelaysActivityProvider>
                        </MuteListProvider>
                      </FollowListProvider>
                    </FavoriteRelaysProvider>
                  </ZapProvider>
                </div>
              </div>
            </NostrProvider>
          </DeletedEventProvider>
        </ScreenSizeProvider>
      </ContentPolicyProvider>
      </FontSizeProvider>
    </ThemeProvider>
  )
}
