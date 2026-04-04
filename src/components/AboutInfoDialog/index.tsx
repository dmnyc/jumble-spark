import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { SILBERENGEL_PUBKEY } from '@/constants'
import { useSmartProfileNavigationOptional } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useState, useEffect } from 'react'
import { replaceableEventService } from '@/services/client.service'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { kinds } from 'nostr-tools'
import { toProfile } from '@/lib/link'

export default function AboutInfoDialog({ children }: { children: React.ReactNode }) {
  const { isSmallScreen } = useScreenSize()
  const { navigateToProfile } = useSmartProfileNavigationOptional()
  const [open, setOpen] = useState(false)
  const [silberengelLightning, setSilberengelLightning] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfiles = async () => {
      const silberengelProfileEvent = await replaceableEventService.fetchReplaceableEvent(
        SILBERENGEL_PUBKEY,
        kinds.Metadata
      )
      const silberengelProfile = silberengelProfileEvent ? getProfileFromEvent(silberengelProfileEvent) : undefined

      if (silberengelProfile?.lightningAddress) {
        setSilberengelLightning(silberengelProfile.lightningAddress)
      }
    }
    fetchProfiles()
  }, [])

  const openSilberengelProfile = () => {
    setOpen(false)
    navigateToProfile(toProfile(SILBERENGEL_PUBKEY))
  }

  const openGithubFork = () => {
    setOpen(false)
    window.open('https://github.com/Silberengel/jumble', '_blank', 'noopener,noreferrer')
  }

  const content = (
    <>
      <div className="text-xl font-semibold">Imwald</div>
      <div className="text-muted-foreground">
        A user-friendly Nostr client focused on relay feed browsing, publications, and relay discovery
      </div>
      <div className="text-sm text-muted-foreground">
        Version: v{import.meta.env.APP_VERSION}
      </div>
      <div className="space-y-2">
        <div>
          <div className="font-medium">Imwald branch:</div>
          <div className="ml-2">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-primary"
              onClick={openSilberengelProfile}
            >
              @silberengel
            </Button>
            {silberengelLightning && (
              <div className="text-sm text-muted-foreground">⚡ {silberengelLightning}</div>
            )}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1">Source code:</div>
        <Button type="button" variant="link" className="h-auto p-0 text-primary" onClick={openGithubFork}>
          Imwald fork
        </Button>
        <div className="text-sm text-muted-foreground mt-1">
          If you like Imwald, please consider giving it a star ⭐
        </div>
      </div>
    </>
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>About</DrawerTitle>
            <DrawerDescription>Information about the application</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 space-y-4">{content}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader className="sr-only">
          <DialogTitle>About</DialogTitle>
          <DialogDescription>Information about the application</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}
