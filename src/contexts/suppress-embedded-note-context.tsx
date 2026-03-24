import { createContext, useContext } from 'react'

/** When set, EmbeddedNote should not render notes whose id matches this (avoids redundancy when viewing "quotes of this note"). */
export const SuppressEmbeddedNoteContext = createContext<string | undefined>(undefined)

export function useSuppressEmbeddedNoteId(): string | undefined {
  return useContext(SuppressEmbeddedNoteContext)
}
