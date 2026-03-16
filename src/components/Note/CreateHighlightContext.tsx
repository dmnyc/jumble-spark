import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import { createContext, useContext } from 'react'

export type OpenHighlightFn = (highlightData: HighlightData, eventContent?: string) => void

export const CreateHighlightContext = createContext<OpenHighlightFn | null>(null)

export function useCreateHighlight(): OpenHighlightFn | null {
  return useContext(CreateHighlightContext)
}
