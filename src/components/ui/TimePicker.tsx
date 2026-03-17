import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

/** Value is always 24-hour "HH:mm" */
export interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  /** When true, show 12-hour with AM/PM; when false, show 24-hour. Default from locale (en-US -> 12h). */
  hour12?: boolean
  onHour12Change?: (hour12: boolean) => void
  className?: string
  id?: string
  disabled?: boolean
}

function parseHHmm(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return { hour: 0, minute: 0 }
  const hour = Math.min(23, Math.max(0, parseInt(match[1]!, 10)))
  const minute = Math.min(59, Math.max(0, parseInt(match[2]!, 10)))
  return { hour, minute }
}

function toHHmm(hour: number, minute: number): string {
  const h = Math.min(23, Math.max(0, hour))
  const m = Math.min(59, Math.max(0, minute))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 24h hour (0-23) to 12h display: { displayHour 1-12, pm: boolean } */
function to12h(hour24: number): { displayHour: number; pm: boolean } {
  if (hour24 === 0) return { displayHour: 12, pm: false }
  if (hour24 < 12) return { displayHour: hour24, pm: false }
  if (hour24 === 12) return { displayHour: 12, pm: true }
  return { displayHour: hour24 - 12, pm: true }
}

/** 12h + AM/PM to 24h hour (0-23) */
function to24h(displayHour: number, pm: boolean): number {
  if (pm) return displayHour === 12 ? 12 : displayHour + 12
  return displayHour === 12 ? 0 : displayHour
}

const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i)
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1)

/** Default: use 12h for en-US, 24h otherwise */
function defaultHour12(): boolean {
  try {
    const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
    return lang.startsWith('en-US')
  } catch {
    return false
  }
}

export function TimePicker({
  value,
  onChange,
  hour12: controlledHour12,
  onHour12Change,
  className,
  id,
  disabled
}: TimePickerProps) {
  const { t } = useTranslation()
  const [internalHour12, setInternalHour12] = React.useState(defaultHour12)
  const hour12 = controlledHour12 ?? internalHour12
  const setHour12 = React.useCallback(
    (v: boolean) => {
      if (onHour12Change) onHour12Change(v)
      else setInternalHour12(v)
    },
    [onHour12Change]
  )

  const { hour: hour24, minute } = parseHHmm(value)
  const { displayHour: hour12Val, pm } = to12h(hour24)

  const handleMinuteChange = React.useCallback(
    (m: number) => {
      onChange(toHHmm(hour24, m))
    },
    [hour24, onChange]
  )

  const handleHourChange = React.useCallback(
    (newHour: number) => {
      if (hour12) {
        const new24 = to24h(newHour, pm)
        onChange(toHHmm(new24, minute))
      } else {
        onChange(toHHmm(newHour, minute))
      }
    },
    [hour12, minute, pm, onChange]
  )

  const handleAmPmChange = React.useCallback(
    (newPm: boolean) => {
      const new24 = to24h(hour12Val, newPm)
      onChange(toHHmm(new24, minute))
    },
    [hour12Val, minute, onChange]
  )

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-1">
        <Select
          value={hour12 ? String(hour12Val) : String(hour24)}
          onValueChange={(v) => handleHourChange(parseInt(v, 10))}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(hour12 ? HOURS_12 : HOURS_24).map((h) => (
              <SelectItem key={h} value={String(h)}>
                {hour12 ? h : String(h).padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <Select
          value={String(minute)}
          onValueChange={(v) => handleMinuteChange(parseInt(v, 10))}
          disabled={disabled}
        >
          <SelectTrigger className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MINUTES.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {String(m).padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hour12 && (
        <Select value={pm ? 'pm' : 'am'} onValueChange={(v) => handleAmPmChange(v === 'pm')} disabled={disabled}>
          <SelectTrigger className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="am">{t('AM')}</SelectItem>
            <SelectItem value="pm">{t('PM')}</SelectItem>
          </SelectContent>
        </Select>
      )}
      <button
        type="button"
        onClick={() => setHour12(!hour12)}
        className="text-xs text-muted-foreground hover:text-foreground underline"
        disabled={disabled}
      >
        {hour12 ? t('24-hour') : t('12-hour (AM/PM)')}
      </button>
    </div>
  )
}
