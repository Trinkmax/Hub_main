'use client'

import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { WalletData } from '@/lib/wallet/queries'
import { formatDate } from './wallet-format'

// Línea de tiempo de visitas. Colapsa a las últimas ~10 con "ver más".
// Client island por el toggle de expandir.
//
// Sin montos a propósito: cruzando "$X" acá con los puntos de esa misma visita en
// el historial se despeja la tasa de acumulación, que el socio no tiene que
// conocer (ver wallet-format.ts). La visita se cuenta, no se factura.

type Visit = WalletData['visits'][number]

const INITIAL = 10

export function VisitsTimeline({ visits }: { visits: Visit[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasMore = visits.length > INITIAL
  const shown = expanded ? visits : visits.slice(0, INITIAL)

  return (
    <section aria-labelledby="visits-heading" className="space-y-3">
      <h2 id="visits-heading" className="font-display text-lg font-semibold tracking-tight">
        Tus visitas
      </h2>

      {visits.length === 0 ? (
        <div className="card-hairline flex flex-col items-center gap-2 rounded-2xl border bg-card px-4 py-8 text-center">
          <Receipt className="size-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Todavía no registramos visitas.</p>
        </div>
      ) : (
        <div className="card-hairline overflow-hidden rounded-2xl border bg-card">
          <ul className="divide-y divide-border/60">
            {shown.map((visit) => (
              <li key={visit.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-(--brand-accent)/60"
                />
                <time dateTime={visit.visitedAt} className="text-sm font-medium tabular-nums">
                  {formatDate(visit.visitedAt)}
                </time>
              </li>
            ))}
          </ul>

          {hasMore ? (
            <div className="border-t border-border/60 p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Ver menos' : `Ver ${visits.length - INITIAL} más`}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
