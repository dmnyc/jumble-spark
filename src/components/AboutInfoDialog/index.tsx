import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from '@/components/ui/drawer'
import { CODY_PUBKEY, SILBERENGEL_PUBKEY } from '@/constants'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useState, useEffect } from 'react'
import Username from '../Username'
import { replaceableEventService } from '@/services/client.service'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { kinds } from 'nostr-tools'

export default function AboutInfoDialog({ children }: { children: React.ReactNode }) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)
  const [codyLightning, setCodyLightning] = useState<string | null>(null)
  const [silberengelLightning, setSilberengelLightning] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfiles = async () => {
      const [codyProfileEvent, silberengelProfileEvent] = await Promise.all([
        replaceableEventService.fetchReplaceableEvent(CODY_PUBKEY, kinds.Metadata),
        replaceableEventService.fetchReplaceableEvent(SILBERENGEL_PUBKEY, kinds.Metadata)
      ])
      const codyProfile = codyProfileEvent ? getProfileFromEvent(codyProfileEvent) : undefined
      const silberengelProfile = silberengelProfileEvent ? getProfileFromEvent(silberengelProfileEvent) : undefined
      
      if (codyProfile?.lightningAddress) {
        setCodyLightning(codyProfile.lightningAddress)
      }
      
      if (silberengelProfile?.lightningAddress) {
        setSilberengelLightning(silberengelProfile.lightningAddress)
      }
    }
    fetchProfiles()
  }, [])

  const content = (
    <>
      <div className="text-xl font-semibold">Jumble 🌲</div>
      <div className="text-muted-foreground">
        A user-friendly Nostr client focused on relay feed browsing and relay discovery
      </div>
      <div className="space-y-2">
        <div>
          <div className="font-medium">Main developer:</div>
          <div className="ml-2">
            <Username userId={CODY_PUBKEY} className="inline-block text-primary" showAt />
            {codyLightning && (
              <div className="text-sm text-muted-foreground">⚡ {codyLightning}</div>
            )}
          </div>
        </div>
        <div>
          <div className="font-medium">Imwald branch:</div>
          <div className="ml-2">
            <Username userId={SILBERENGEL_PUBKEY} className="inline-block text-primary" showAt />
            {silberengelLightning && (
              <div className="text-sm text-muted-foreground">⚡ {silberengelLightning}</div>
            )}
          </div>
        </div>
      </div>
      <div>
        Source code:{' '}
        <a
          href="https://github.com/CodyTseng/jumble"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Main repo
        </a>
        {' · '}
        <a
          href="https://github.com/Silberengel/jumble"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Imwald fork
        </a>
        <div className="text-sm text-muted-foreground mt-1">
          If you like Jumble, please consider giving it a star ⭐
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
