import { createContext, useContext } from 'react'

export interface GroupListContextType {
  userGroups: string[]
  isUserInGroup: (groupId: string) => boolean
  refreshGroupList: () => Promise<void>
  isLoading: boolean
}

export const GroupListContext = createContext<GroupListContextType | undefined>(undefined)

export const useGroupList = (): GroupListContextType => {
  const context = useContext(GroupListContext)
  if (context === undefined) {
    throw new Error('useGroupList must be used within a GroupListProvider')
  }
  return context
}
