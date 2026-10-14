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
 * «Quién» en la historia contable (`?quien=`), como desplegable: es para cuando
 * hay MÁS de seis personas (un bar con dieciocho socios no entra en una fila de
 * píldoras). Con seis o menos la página dibuja píldoras y esto no se usa. «Qué»
 * (`?tipo=`) ya son siempre píldoras. Cambiar algo vuelve a la primera página y
 * conserva el período.
 */
export function HistoryFilters({
  people,
  person,
}: {
  people: ReadonlyArray<{ userId: string; name: string }>
  person: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const personId = useId()

  function go(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? '')
    params.delete('despues')
    if (value === ALL) params.delete('quien')
    else params.set('quien', value)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return (
    <div aria-busy={pending} className="flex flex-wrap items-center gap-2">
      <Label htmlFor={personId} className="text-xs font-medium text-muted-foreground">
        Quién
      </Label>
      <Select value={person ?? ALL} onValueChange={go} disabled={pending}>
        <SelectTrigger
          id={personId}
          className="w-64 max-w-full rounded-full data-[size=default]:h-11 md:pointer-fine:data-[size=default]:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="min-h-11 md:min-h-9">
            Todas las personas
          </SelectItem>
          {people.map((p) => (
            <SelectItem key={p.userId} value={p.userId} className="min-h-11 md:min-h-9">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
