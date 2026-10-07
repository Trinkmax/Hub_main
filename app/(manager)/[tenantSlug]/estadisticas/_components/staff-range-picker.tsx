'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type DateRangePreset, labelForPreset, PRESETS } from '@/lib/staff-performance/date-range'

/**
 * El período de «Mozos»: solo los atajos que entiende el server (`?preset=`).
 *
 * Todavía no es el `PeriodPicker` del kit a propósito: el cajón de cada mozo le
 * pide sus mesas a `/api/staff/sessions` con el `preset` solo, y un rango a
 * mano (`preset=custom&from&to`) haría que la tabla y el cajón miraran períodos
 * distintos. El server ya lee bien un rango a mano (`yyyy-MM-dd` como días de
 * Córdoba, ver `cordobaDayFromParam` en `lib/staff-performance`): cuando el
 * cajón mande también `from` y `to`, este selector pasa al `PeriodPicker`.
 */
export function StaffRangePicker({ currentPreset }: { currentPreset: DateRangePreset }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', 'mozos')
    params.set('preset', next)
    // Custom requiere from/to — para MVP no exponemos calendarios, solo presets.
    params.delete('from')
    params.delete('to')
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  return (
    <Select value={currentPreset} onValueChange={onChange} disabled={pending}>
      <SelectTrigger
        size="sm"
        aria-label="Período"
        aria-busy={pending || undefined}
        className="w-44"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRESETS.filter((p) => p !== 'custom').map((p) => (
          <SelectItem key={p} value={p}>
            {labelForPreset(p)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
