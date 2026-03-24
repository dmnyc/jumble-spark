import { createContext, useContext } from 'react'

export type SuppressEmbeddedNoteValue = {
  hexId: string
  coordinate?: string
}

/** When set, EmbeddedNote should not render notes whose id/coordinate matches (avoids redundancy when viewing "quotes of this note"). */
export const SuppressEmbeddedNoteContext = createContext<SuppressEmbeddedNoteValue | undefined>(undefined)

export function useSuppressEmbeddedNoteId(): SuppressEmbeddedNoteValue | undefined {
  return useContext(SuppressEmbeddedNoteContext)
}
