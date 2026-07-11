import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function SearchHistory({
  history,
  onSelect,
  onRemove,
  onClear
}: {
  history: string[]
  onSelect: (text: string) => void
  onRemove: (index: number) => void
  onClear: () => void
}) {
  const { t } = useTranslation()

  if (history.length === 0) return null

  return (
    <div className="border-b px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">{t('Recent Searches')}</div>
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          {t('Clear all')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {history.map((text, index) => (
          <div
            key={index}
            role="button"
            className="group flex max-w-48 cursor-pointer items-center gap-1 rounded-full bg-muted py-1 ps-3 pe-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => onSelect(text)}
          >
            <span className="min-w-0 truncate" dir="auto">
              {text}
            </span>
            <button
              className="shrink-0 rounded-full p-0.5 hover:bg-background/60"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(index)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
