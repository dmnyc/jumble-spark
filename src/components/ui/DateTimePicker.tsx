import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TimePicker } from '@/components/ui/TimePicker'
import { cn } from '@/lib/utils'

/** Value is "YYYY-MM-DDTHH:mm" (same as datetime-local). */
export interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  id?: string
  label?: React.ReactNode
  /** Start * or (optional) etc. */
  labelSuffix?: React.ReactNode
  required?: boolean
  className?: string
  disabled?: boolean
}

function datePart(dt: string): string {
  if (!dt || dt.length < 10) return ''
  return dt.slice(0, 10)
}

function timePart(dt: string): string {
  if (!dt || dt.length < 16) return '09:00'
  return dt.slice(11, 16)
}

export function DateTimePicker({
  value,
  onChange,
  id,
  label,
  labelSuffix,
  required,
  className,
  disabled
}: DateTimePickerProps) {
  const date = datePart(value)
  const time = timePart(value)

  const handleDateChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const d = e.target.value
      onChange(d ? `${d}T${time}` : '')
    },
    [time, onChange]
  )

  const handleTimeChange = React.useCallback(
    (t: string) => {
      if (!date) {
        const today = new Date().toISOString().slice(0, 10)
        onChange(`${today}T${t}`)
      } else {
        onChange(`${date}T${t}`)
      }
    },
    [date, onChange]
  )

  return (
    <div className={cn('space-y-2', className)}>
      {label != null && (
        <Label htmlFor={id}>
          {label} {labelSuffix}
        </Label>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <Input
            id={id}
            type="date"
            value={date}
            onChange={handleDateChange}
            required={required}
            disabled={disabled}
            className="h-9"
          />
        </div>
        <TimePicker
          value={time}
          onChange={handleTimeChange}
          disabled={disabled}
          id={id ? `${id}-time` : undefined}
        />
      </div>
    </div>
  )
}
