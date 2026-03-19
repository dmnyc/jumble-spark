import PostEditor from '@/components/PostEditor'
import { useNostr } from '@/providers/NostrProvider'
import postEditorService from '@/services/post-editor.service'
import { PencilLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function WriteButton() {
  const { checkLogin } = useNostr()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onRequest = () => {
      checkLogin(() => setOpen(true))
    }
    postEditorService.addEventListener('requestOpenNewPost', onRequest)
    return () => postEditorService.removeEventListener('requestOpenNewPost', onRequest)
  }, [checkLogin])

  return (
    <>
      <BottomNavigationBarItem
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
      >
        <PencilLine />
      </BottomNavigationBarItem>
      <PostEditor open={open} setOpen={setOpen} />
    </>
  )
}
