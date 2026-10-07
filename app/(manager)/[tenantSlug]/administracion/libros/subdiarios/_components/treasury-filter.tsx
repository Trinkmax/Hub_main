'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useTransition } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'todas'

/**
 * Qué caja o cuenta mira el subdiario de cajas y bancos (`?caja=`). Cambiarla
 * vuelve a la primera página y conserva el período.
 */
export function TreasuryFilter({
  treasuries,
  value,
}: {
  treasuries: ReadonlyArray<{ id: string; name: string }>
  value: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const id = useId()

  function go(next: string) {
    const params = new URLSearchParams(sp?.toString() ?? '')
    params.delete('despues')
    if (next === ALL) params.delete('caja')
    else params.set('caja', next)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return (
    <div className="grid gap-1.5 sm:max-w-xs" aria-busy={pending}>
      <Label htmlFor={id}>Caja o cuenta</Label>
      <Select value={value ?? ALL} onValueChange={go} disabled={pending}>
        <SelectTrigger
          id={id}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="min-h-11 md:min-h-9">
            Todas las cajas y cuentas
          </SelectItem>
          {treasuries.map((t) => (
            <SelectItem key={t.id} value={t.id} className="min-h-11 md:min-h-9">
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
