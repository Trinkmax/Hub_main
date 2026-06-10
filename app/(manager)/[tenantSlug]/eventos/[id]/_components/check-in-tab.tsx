'use client'

import { CheckCircle2, Search } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReservationRow } from '@/lib/events/queries'
import { checkInReservation } from '@/lib/events/reservations'
import { formatPhoneForDisplay } from '@/lib/phone'

export function CheckInTab({
  tenantSlug,
  reservations,
}: {
  tenantSlug: string
  reservations: ReservationRow[]
}) {
  const [query, setQuery] = useState('')
  const [, start] = useTransition()

  const visible = reservations.filter((r) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return r.display_name.toLowerCase().includes(q) || r.customer.phone.includes(q)
  })

  const onCheckin = (id: string) => {
    start(async () => {
      const r = await checkInReservation(tenantSlug, id)
      if (!r.ok) toast.error(r.message)
      else toast.success('Check-in registrado')
    })
  }

  return (
    <div className="space-y-4">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <input
          placeholder="Buscar nombre o teléfono…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: flujo de check-in operativo, foco inmediato esperado por el staff
          autoFocus
          className="h-10 w-full rounded-lg border border-border/60 bg-background/40 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
        />
      </label>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-background/30">
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            Sin coincidencias.
          </li>
        ) : (
          visible.map((r) => {
            const initials = r.display_name
              .split(' ')
              .map((w) => w[0] ?? '')
              .slice(0, 2)
              .join('')
              .toUpperCase()
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-secondary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.display_name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatPhoneForDisplay(r.customer.phone)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  ×{r.guests_count}
                </span>
                {r.status === 'checked_in' ? (
                  <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
                    <CheckCircle2 className="size-3" />
                    OK
                  </Badge>
                ) : (
                  <Button size="sm" onClick={() => onCheckin(r.id)}>
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
