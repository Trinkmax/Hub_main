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

const ALL = 'todos'

export type HistoryKindOption = { value: string; label: string }

/**
 * Quién y qué en la historia contable (`?quien=` y `?tipo=`). Cambiar algo
 * vuelve a la primera página y conserva el período.
 */
export function HistoryFilters({
  people,
  kinds,
  person,
  kind,
}: {
  people: ReadonlyArray<{ userId: string; name: string }>
  kinds: readonly HistoryKindOption[]
  person: string | null
  kind: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const personId = useId()
  const kindId = useId()

  function go(key: 'quien' | 'tipo', value: string) {
    const params = new URLSearchParams(sp?.toString() ?? '')
    params.delete('despues')
    if (value === ALL) params.delete(key)
    else params.set(key, value)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  const trigger = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'
  const item = 'min-h-11 md:min-h-9'

  return (
    <div
      aria-busy={pending}
      className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-3 sm:grid-cols-2"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={personId}>Quién</Label>
        <Select value={person ?? ALL} onValueChange={(v) => go('quien', v)} disabled={pending}>
          <SelectTrigger id={personId} className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className={item}>
              Todas las personas
            </SelectItem>
            {people.map((p) => (
              <SelectItem key={p.userId} value={p.userId} className={item}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={kindId}>Qué</Label>
        <Select value={kind ?? ALL} onValueChange={(v) => go('tipo', v)} disabled={pending}>
          <SelectTrigger id={kindId} className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className={item}>
              Todo
            </SelectItem>
            {kinds.map((k) => (
              <SelectItem key={k.value} value={k.value} className={item}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
