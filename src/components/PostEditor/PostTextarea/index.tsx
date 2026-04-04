import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseEditorJsonToText } from '@/lib/tiptap'
import { cn } from '@/lib/utils'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { TEmoji } from '@/types'
import Document from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { Event } from 'nostr-tools'
import { Dispatch, forwardRef, SetStateAction, useImperativeHandle, useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardAndDropHandler } from './ClipboardAndDropHandler'
import Emoji from './Emoji'
import emojiSuggestion from './Emoji/suggestion'
import Mention from './Mention'
import mentionSuggestion from './Mention/suggestion'
import Preview from './Preview'
import { HighlightData } from '../HighlightEditor'
import { getKindDescription } from '@/lib/kind-description'

export type TPostTextareaHandle = {
  appendText: (text: string, addNewline?: boolean) => void
  insertText: (text: string) => void
  insertEmoji: (emoji: string | TEmoji) => void
  clear: () => void
  getText: () => string
}

const PostTextarea = forwardRef<
  TPostTextareaHandle,
  {
    text: string
    setText: Dispatch<SetStateAction<string>>
    defaultContent?: string
    parentEvent?: Event
    onSubmit?: () => void
    className?: string
    onUploadStart?: (file: File, cancel: () => void) => void
    onUploadProgress?: (file: File, progress: number) => void
    onUploadEnd?: (file: File) => void
    kind?: number
    highlightData?: HighlightData
    pollCreateData?: import('@/types').TPollCreateData
    headerActions?: React.ReactNode
    getDraftEventJson?: () => Promise<string>
    mediaImetaTags?: string[][]
    mediaUrl?: string
    articleMetadata?: {
      title?: string
      summary?: string
      image?: string
      dTag?: string
      topics?: string[]
    }
    extraPreviewTags?: string[][]
    addClientTag?: boolean
  }
>(
  (
    {
      text = '',
      setText,
      defaultContent,
      parentEvent,
      onSubmit,
      className,
      onUploadStart,
      onUploadProgress,
      onUploadEnd,
      kind = 1,
      highlightData,
      pollCreateData,
      headerActions,
      getDraftEventJson,
      mediaImetaTags,
      mediaUrl,
      articleMetadata,
      extraPreviewTags,
      addClientTag = true
    },
    ref
  ) => {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState('preview')
    const [draftEventJson, setDraftEventJson] = useState<string>('')
    const [isLoadingJson, setIsLoadingJson] = useState(false)
    
    const kindDescription = useMemo(() => getKindDescription(kind), [kind])
    
    useEffect(() => {
      if (activeTab === 'preview') {
        setDraftEventJson('')
        setIsLoadingJson(false)
        return
      }

      if (activeTab !== 'json' || !getDraftEventJson) {
        return
      }

      let cancelled = false
      setIsLoadingJson(true)

      void Promise.resolve(getDraftEventJson())
        .then((json) => {
          if (cancelled) return
          setDraftEventJson(json)
          setIsLoadingJson(false)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          const msg = error instanceof Error ? error.message : String(error)
          setDraftEventJson(`Error generating JSON: ${msg}`)
          setIsLoadingJson(false)
        })

      return () => {
        cancelled = true
      }
      // `text` is included so JSON refreshes when the parent memoizes `getDraftEventJson` too narrowly;
      // `kind` catches compose-mode switches even if callback identity were ever stable across them.
    }, [activeTab, getDraftEventJson, kind, text])
    const editor = useEditor({
      // TipTap + Radix Dialog/Tabs: defer init so React 18 does not warn about flushSync in a lifecycle.
      immediatelyRender: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        History,
        HardBreak,
        Placeholder.configure({
          placeholder:
            t('Write something...') + ' (' + t('Paste or drop media files to upload') + ')'
        }),
        Emoji.configure({
          suggestion: emojiSuggestion
        }),
        Mention.configure({
          suggestion: mentionSuggestion
        }),
        ClipboardAndDropHandler.configure({
          onUploadStart: (file, cancel) => {
            onUploadStart?.(file, cancel)
          },
          onUploadEnd: (file) => onUploadEnd?.(file),
          onUploadProgress: (file, p) => onUploadProgress?.(file, p)
        })
      ],
      editorProps: {
        attributes: {
          class: cn(
            'border rounded-lg p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )
        },
        handleKeyDown: (_view, event) => {
          // Handle Ctrl+Enter or Cmd+Enter for submit
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmit?.()
            return true
          }
          return false
        },
        clipboardTextSerializer(content) {
          return parseEditorJsonToText(content.toJSON())
        }
      },
      content: postEditorCache.getPostContentCache({ kind, defaultContent, parentEvent }),
      onUpdate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
        postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, props.editor.getJSON())
      },
      onCreate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
      }
    })

    useImperativeHandle(ref, () => ({
      appendText: (text: string, addNewline = false) => {
        if (editor) {
          let chain = editor
            .chain()
            .focus()
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                const endPos = tr.doc.content.size
                const selection = TextSelection.create(tr.doc, endPos)
                tr.setSelection(selection)
                dispatch(tr)
              }
              return true
            })
            .insertContent(text)
          if (addNewline) {
            chain = chain.setHardBreak()
          }
          chain.run()
        }
      },
      insertText: (text: string) => {
        if (editor) {
          editor.chain().focus().insertContent(text).run()
        }
      },
      insertEmoji: (emoji: string | TEmoji) => {
        if (editor) {
          if (typeof emoji === 'string') {
            editor.chain().insertContent(emoji).run()
          } else {
            const emojiNode = editor.schema.nodes.emoji.create({
              name: customEmojiService.getEmojiId(emoji)
            })
            editor.chain().insertContent(emojiNode).insertContent(' ').run()
          }
        }
      },
      clear: () => {
        if (editor) {
          // Clear the editor content and reset to empty document
          editor.chain().clearContent().run()
          // Also clear the cache
          postEditorCache.setPostContentCache({ kind, defaultContent, parentEvent }, editor.getJSON())
          setText('')
        }
      },
      getText: () => {
        if (editor) {
          return editor.getText()
        }
        return ''
      }
    }))

    if (!editor) {
      return null
    }

    return (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <TabsList className="w-auto justify-start">
            <TabsTrigger value="preview" title={t('Preview')}>
              {t('Preview')}
            </TabsTrigger>
            <TabsTrigger value="json" title={t('Json')}>
              {t('Json')}
            </TabsTrigger>
          </TabsList>
          {headerActions && (
            <div className="flex gap-1 items-center flex-wrap">
              {headerActions}
            </div>
          )}
        </div>
        {/* Editor always visible (no Edit tab). Keep mounted; only Preview/Json swap panels below. */}
        <EditorContent className="tiptap" editor={editor} />
        <TabsContent value="preview">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              kind {kindDescription.number}: {kindDescription.description}
            </div>
            <Preview
              content={text}
              className={className}
              kind={kind}
              highlightData={highlightData}
              pollCreateData={pollCreateData}
              mediaImetaTags={mediaImetaTags}
              mediaUrl={mediaUrl}
              articleMetadata={articleMetadata}
              extraPreviewTags={extraPreviewTags}
              addClientTag={addClientTag}
            />
          </div>
        </TabsContent>
        <TabsContent value="json">
          <div className="border rounded-lg p-3 bg-muted/40 max-h-96 overflow-auto select-text">
            {isLoadingJson ? (
              <div className="text-muted-foreground text-sm">{t('Loading...')}</div>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-words font-mono select-text">
                {draftEventJson || t('No JSON available')}
              </pre>
            )}
          </div>
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
