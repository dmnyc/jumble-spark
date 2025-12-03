import { Skeleton } from '@/components/ui/skeleton'
import { verifyNip05 } from '@/lib/nip05'
import { toNoteList } from '@/lib/link'
import { SecondaryPageLink } from '@/PageManager'
import { BadgeAlert, BadgeCheck } from 'lucide-react'
import { Favicon } from '../Favicon'
import { useEffect, useState } from 'react'

interface Nip05Verification {
  nip05: string
  isVerified: boolean
  nip05Name: string
  nip05Domain: string
  isFetching: boolean
}

export default function Nip05List({ nip05List, pubkey }: { nip05List: string[]; pubkey: string }) {
  const [verifications, setVerifications] = useState<Map<string, Nip05Verification>>(new Map())

  useEffect(() => {
    if (!nip05List || nip05List.length === 0 || !pubkey) return

    const verifyAll = async () => {
      const newVerifications = new Map<string, Nip05Verification>()
      
      // Initialize all as fetching
      nip05List.forEach(nip05 => {
        const [nip05Name, nip05Domain] = nip05.split('@')
        newVerifications.set(nip05, {
          nip05,
          isVerified: false,
          nip05Name: nip05Name || '',
          nip05Domain: nip05Domain || '',
          isFetching: true
        })
      })
      setVerifications(newVerifications)

      // Verify each NIP-05 address
      await Promise.all(
        nip05List.map(async (nip05) => {
          try {
            const result = await verifyNip05(nip05, pubkey)
            setVerifications(prev => {
              const updated = new Map(prev)
              updated.set(nip05, {
                nip05,
                isVerified: result.isVerified,
                nip05Name: result.nip05Name || nip05.split('@')[0] || '',
                nip05Domain: result.nip05Domain || nip05.split('@')[1] || '',
                isFetching: false
              })
              return updated
            })
          } catch (error) {
            setVerifications(prev => {
              const updated = new Map(prev)
              const existing = updated.get(nip05) || {
                nip05,
                isVerified: false,
                nip05Name: nip05.split('@')[0] || '',
                nip05Domain: nip05.split('@')[1] || '',
                isFetching: false
              }
              updated.set(nip05, { ...existing, isFetching: false })
              return updated
            })
          }
        })
      )
    }

    verifyAll()
  }, [nip05List, pubkey])

  if (nip05List.length === 0) return null

  return (
    <div className="text-sm text-muted-foreground flex flex-col gap-1 mt-1">
      {nip05List.map((nip05, idx) => {
        const verification = verifications.get(nip05)
        const isFetching = verification?.isFetching ?? true
        const isVerified = verification?.isVerified ?? false
        const nip05Name = verification?.nip05Name || nip05.split('@')[0] || ''
        const nip05Domain = verification?.nip05Domain || nip05.split('@')[1] || ''

        if (isFetching) {
          return (
            <div key={idx} className="flex items-center gap-1">
              <Skeleton className="h-3 w-32" />
            </div>
          )
        }

        return (
          <div
            key={idx}
            className="flex items-center gap-1 truncate [&_svg]:!size-3.5 [&_svg]:shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {nip05Name !== '_' ? (
              <span className="text-sm text-muted-foreground truncate">@{nip05Name}</span>
            ) : null}
            {isVerified ? (
              <Favicon
                domain={nip05Domain}
                className="w-3.5 h-3.5 rounded-full"
                fallback={<BadgeCheck className="text-primary" />}
              />
            ) : (
              <BadgeAlert className="text-muted-foreground" />
            )}
            <SecondaryPageLink
              to={toNoteList({ domain: nip05Domain })}
              className={`hover:underline truncate text-sm ${isVerified ? 'text-primary' : 'text-muted-foreground'}`}
            >
              {nip05Domain}
            </SecondaryPageLink>
          </div>
        )
      })}
    </div>
  )
}

