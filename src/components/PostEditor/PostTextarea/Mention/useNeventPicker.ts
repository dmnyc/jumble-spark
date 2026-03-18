import * as React from 'react'
import { NeventPickerContext } from './NeventNaddrPickerDialog'

export function useNeventPicker() {
  return React.useContext(NeventPickerContext)
}
