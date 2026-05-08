'use client'

import { CheckCircle2, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { ReservationRow } from '@/lib/events/queries'
import { checkInReservation } from '@/lib/events/reservations'
import { formatPhoneForDisplay } from '@/lib/phone'

export function CheckInBoard({
  tenantSlug,
  reservations,
}: {
  tenantSlug: string
  reservations: ReservationRow[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [, start] = useTransition()
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(new Set())

  const visible = reservations.filter((r) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      r.customer.first_name.toLowerCase().includes(q) ||
      r.customer.last_name.toLowerCase().includes(q) ||
      r.customer.phone.includes(q)
    )
  })

  const onCheckin = (id: string) => {
    setOptimisticIds(new Set([...optimisticIds, id]))
    start(async () => {
      const r = await checkInReservation(tenantSlug, id)
      if (!r.ok) {
        toast.error(r.message)
        const next = new Set(optimisticIds)
        next.delete(id)
        setOptimisticIds(next)
      } else {
        toast.success('OK')
        router.refresh()
      }
    })
  }

  const initials = (first: string, last: string) =>
    `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()

  return (
    <div className="space-y-4">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-4 size-5 text-muted-foreground" />
        <input
          placeholder="Buscar nombre o teléfono…"
          className="h-14 w-full rounded-2xl border border-border/60 bg-card/80 pl-12 pr-4 text-base shadow-sm backdrop-blur-xl outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: modo check-in dedicado, foco inmediato esperado
          autoFocus
        />
      </label>

      <ul className="space-y-2">
        {visible.length === 0 ? (
          <li className="rounded-xl border border-dashed bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
            Sin coincidencias.
          </li>
        ) : (
          visible.map((r) => {
            const checked = r.status === 'checked_in' || optimisticIds.has(r.id)
            return (
              <li
                key={r.id}
                className={`card-hairline flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-all ${checked ? 'opacity-70' : ''}`}
              >
                <Avatar className="size-12">
                  <AvatarFallback className="bg-secondary font-display text-base font-semibold">
                    {initials(r.customer.first_name, r.customer.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base font-semibold leading-tight">
                    {r.customer.first_name} {r.customer.last_name}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {formatPhoneForDisplay(r.customer.phone)} ·{' '}
                    <span className="font-sans">×{r.guests_count}</span>
                  </div>
                </div>
                {checked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-sm font-semibold text-success">
                    <CheckCircle2 className="size-4" />
                    Ingresó
                  </span>
                ) : (
                  <Button size="lg" onClick={() => onCheckin(r.id)}>
                    Check-in
                  </Button>
                )}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
