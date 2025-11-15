import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TPollCreateData } from '@/types'
import dayjs from 'dayjs'
import { Eraser, X } from 'lucide-react'
import { Dispatch, SetStateAction, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostRelaySelector from './PostRelaySelector'

export default function PollEditor({
  pollCreateData,
  setPollCreateData,
  setIsPoll: _setIsPoll,
  content = ''
}: {
  pollCreateData: TPollCreateData
  setPollCreateData: Dispatch<SetStateAction<TPollCreateData>>
  setIsPoll: Dispatch<SetStateAction<boolean>>
  content?: string
}) {
  const { t } = useTranslation()
  const [isMultipleChoice, setIsMultipleChoice] = useState(pollCreateData.isMultipleChoice)
  const [options, setOptions] = useState(pollCreateData.options)
  const [endsAt, setEndsAt] = useState(
    pollCreateData.endsAt ? dayjs(pollCreateData.endsAt * 1000).format('YYYY-MM-DDTHH:mm') : ''
  )
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>(pollCreateData.relays)
  const [_isProtectedEvent, setIsProtectedEvent] = useState(false)

  useEffect(() => {
    setPollCreateData({
      isMultipleChoice,
      options,
      endsAt: endsAt ? dayjs(endsAt).startOf('minute').unix() : undefined,
      relays: additionalRelayUrls
    })
  }, [isMultipleChoice, options, endsAt, additionalRelayUrls, setPollCreateData])

  const handleAddOption = () => {
    setOptions([...options, ''])
  }

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  return (
    <div className="space-y-4 border rounded-lg p-3">
      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={option}
              onChange={(e) => handleOptionChange(index, e.target.value)}
              placeholder={t('Option {{number}}', { number: index + 1 })}
            />
            <Button
              type="button"
              variant="ghost-destructive"
              size="icon"
              onClick={() => handleRemoveOption(index)}
              disabled={options.length <= 2}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={handleAddOption}>
          {t('Add Option')}
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <Label htmlFor="multiple-choice">{t('Allow multiple choices')}</Label>
        <Switch
          id="multiple-choice"
          checked={isMultipleChoice}
          onCheckedChange={setIsMultipleChoice}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ends-at">{t('End Date (optional)')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost-destructive"
            size="icon"
            onClick={() => setEndsAt('')}
            disabled={!endsAt}
            title={t('Clear end date')}
          >
            <Eraser />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <PostRelaySelector
          setAdditionalRelayUrls={setAdditionalRelayUrls}
          setIsProtectedEvent={setIsProtectedEvent}
          content={content}
        />
      </div>
    </div>
  )
}
