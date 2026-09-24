import ContentPreviewContent from '@/components/ContentPreview/Content'
import { SimpleUsername } from '@/components/Username'
import { ExtendedKind } from '@/constants'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import dmService from '@/services/dm.service'
import { TDmMessage } from '@/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DmReplyPreview({
  id,
  participantsKey,
  composing = false
}: {
  id: string
  participantsKey: string
  composing?: boolean
}) {
  const { t } = useTranslation()
  const [message, setMessage] = useState<TDmMessage | null>(null)

  useEffect(() => {
    setMessage(null)
    return dmService.watchReplyTo(id, participantsKey, setMessage)
  }, [id, participantsKey])

  // A different reference can render before its effect has reset the old result.
  const reply = message?.id === id && message.participantsKey === participantsKey ? message : null
  const contentClassName = composing ? 'text-muted-foreground block truncate text-xs' : undefined

  if (!reply) {
    return <span className={contentClassName}>{t('Quoted message not loaded yet')}</span>
  }

  const isFile = reply.decryptedRumor?.kind === ExtendedKind.RUMOR_FILE
  const fileLabel = isFile
    ? dmService.getFilePreviewContent(reply.decryptedRumor?.tags).slice(1, -1)
    : undefined

  return (
    <>
      <SimpleUsername
        userId={reply.senderPubkey}
        className={
          composing
            ? 'text-primary text-xs font-medium'
            : "me-1 inline font-bold after:content-[':']"
        }
        withoutSkeleton
      />
      {fileLabel ? (
        <span className={contentClassName}>[{t(fileLabel)}]</span>
      ) : (
        <ContentPreviewContent
          content={reply.content.trim() ? reply.content : '...'}
          className={contentClassName}
          emojiInfos={getEmojiInfosFromEmojiTags(reply.decryptedRumor?.tags)}
        />
      )}
    </>
  )
}
