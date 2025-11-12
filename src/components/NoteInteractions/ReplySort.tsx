import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, Clock, TrendingUp, ArrowUpDown, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ReplySortOption = 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped'

export default function ReplySort({ selectedSort, onSortChange }: { selectedSort: ReplySortOption; onSortChange: (sort: ReplySortOption) => void }) {
  const { t } = useTranslation()

  const sortOptions = [
    { id: 'newest' as ReplySortOption, label: t('Newest'), icon: Clock },
    { id: 'oldest' as ReplySortOption, label: t('Oldest'), icon: Clock },
    { id: 'top' as ReplySortOption, label: t('Top'), icon: TrendingUp },
    { id: 'controversial' as ReplySortOption, label: t('Controversial'), icon: ArrowUpDown },
    { id: 'most-zapped' as ReplySortOption, label: t('Most Zapped'), icon: Zap },
  ]

  const selectedOption = sortOptions.find(option => option.id === selectedSort) || sortOptions[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 h-8 px-2 text-xs [&_svg]:size-2">
          <selectedOption.icon className="size-2" />
          <span className="text-xs">{selectedOption.label}</span>
          <ChevronDown className="size-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32 p-0.5">
        {sortOptions.map(option => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => onSortChange(option.id)}
            className="flex items-center gap-1.5 text-xs py-0.5 px-1.5 [&_svg]:size-2.5"
          >
            <option.icon className="size-2.5" />
            <span className="text-xs">{option.label}</span>
            {option.id === selectedSort && (
              <span className="ml-auto text-primary text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
