'use client'

import { Bell, CircleDot, Receipt, Users } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { SalonTableRow } from '@/lib/sessions-waiter/queries'
import { cn } from '@/lib/utils'

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

function elapsedLabel(openedAt: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(openedAt).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

export function SalonTablesGrid({
  tenantSlug,
  tables,
  onTapFreeTable,
}: {
  tenantSlug: string
  tables: SalonTableRow[]
  onTapFreeTable: (tableId: string, label: string) => void
}) {
  if (tables.length === 0) {
    return (
      <EmptyState
        title="No hay mesas configuradas"
        description="Agregá mesas en Ajustes para empezar a operar."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tables.map((t) => {
        const isActive = t.session !== null

        if (!isActive) {
          return (
            <button
              key={t.physical_table_id}
              type="button"
              onClick={() => onTapFreeTable(t.physical_table_id, t.label)}
              className="card-hairline group flex min-h-[7rem] flex-col items-start justify-between rounded-xl border border-dashed border-border/70 bg-muted/30 p-4 text-left transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div>
                  <h3 className="font-serif text-lg font-semibold tracking-tight">{t.label}</h3>
                  <p className="text-xs text-muted-foreground">Libre</p>
                </div>
                <CircleDot className="size-5 text-muted-foreground/50" aria-hidden />
              </div>
              <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Tocá para activar
              </span>
            </button>
          )
        }

        const s = t.session
        if (!s) return null
        return (
          <Link
            key={t.physical_table_id}
            href={`/${tenantSlug}/salon/mesas/${s.id}`}
            className={cn(
              'card-hairline group block rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md',
              s.bill_requested && 'border-destructive/40',
              s.pending_tickets > 0 && 'border-warning/40',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-serif text-lg font-semibold tracking-tight">
                  {s.alias ?? t.label}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {s.alias ? <span className="mr-1">{t.label} · </span> : null}
                  {elapsedLabel(s.opened_at)} ·{' '}
                  {new Date(s.opened_at).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <p className="font-serif text-xl font-semibold tabular-nums">
                {ARSFormat(s.total_cents)}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.party_size !== null ? (
                <Badge variant="secondary" className="gap-1">
                  <Users className="size-3" aria-hidden />
                  {s.party_size} {s.party_size === 1 ? 'comensal' : 'comensales'}
                </Badge>
              ) : null}
              {s.guest_count > 0 ? (
                <Badge variant="outline" className="gap-1">
                  📱 {s.guest_count}
                </Badge>
              ) : null}
              {s.pending_tickets > 0 ? (
                <Badge variant="warning" className="gap-1">
                  <Bell className="size-3" aria-hidden />
                  {s.pending_tickets} pendientes
                </Badge>
              ) : null}
              {s.bill_requested ? (
                <Badge variant="destructive" className="gap-1">
                  <Receipt className="size-3" aria-hidden />
                  Cuenta
                </Badge>
              ) : null}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
