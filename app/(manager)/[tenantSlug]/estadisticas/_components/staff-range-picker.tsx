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

export function StaffRangePicker({ currentPreset }: { currentPreset: DateRangePreset }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', 'mozos')
    params.set('preset', next)
    // Custom requiere from/to — para MVP no exponemos calendarios, solo presets.
    // Si el usuario elige 'custom' por algún flujo futuro, lo manejamos ahí.
    params.delete('from')
    params.delete('to')
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  return (
    <Select value={currentPreset} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-[180px]">
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
