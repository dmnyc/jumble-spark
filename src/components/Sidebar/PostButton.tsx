import PostEditor from '@/components/PostEditor'
import { useNostr } from '@/providers/NostrProvider'
import postEditorService from '@/services/post-editor.service'
import { PencilLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import SidebarItem from './SidebarItem'

export default function PostButton() {
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
    <div className="pt-4">
      <SidebarItem
        title="New post"
        description="Post"
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        variant="default"
        className="bg-primary-active hover:bg-primary-hover active:bg-primary-active xl:justify-center gap-2"
      >
        <PencilLine strokeWidth={3} />
      </SidebarItem>
      <PostEditor open={open} setOpen={setOpen} />
    </div>
  )
}
