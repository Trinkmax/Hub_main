'use client'

import { Receipt, Users } from 'lucide-react'
import type { LiveTable } from '@/lib/floor-plan/queries'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import { cn } from '@/lib/utils'

export type LiveTableCardProps = { table: LiveTable; onOpen: () => void }

// Estilos por estado de la sesión (libre = sin sesión viva).
// merged/abandoned no son sesiones vivas: la mesa se muestra libre.
type LiveStatus = 'free' | 'open' | 'paid'

function liveStatusOf(table: LiveTable): LiveStatus {
  const s = table.session
  if (!s) return 'free'
  if (s.status === 'open') return 'open'
  if (s.status === 'paid') return 'paid'
  return 'free'
}

const STATUS_SURFACE: Record<LiveStatus, string> = {
  // verde tenue
  free: 'border-success/35 bg-success/8 text-foreground',
  // ámbar
  open: 'border-warning/45 bg-warning/12 text-foreground',
  // azul/slate
  paid: 'border-info/45 bg-info/12 text-foreground',
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  free: 'Libre',
  open: 'Ocupada',
  paid: 'Pagada',
}

export function LiveTableCard({ table, onOpen }: LiveTableCardProps) {
  const status = liveStatusOf(table)
  const s = table.session
  const isCircle = table.shape === 'circle'
  const title = s?.alias ?? table.label

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${title} — ${STATUS_LABEL[status]}${s ? ` · ${ARSFormat(s.total_cents)}` : ''}`}
      className={cn(
        'group absolute flex flex-col items-stretch justify-between overflow-hidden border p-2 text-left shadow-sm outline-none transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50',
        isCircle ? 'rounded-full' : 'rounded-lg',
        STATUS_SURFACE[status],
      )}
      style={{
        left: table.x,
        top: table.y,
        width: table.width,
        height: table.height,
        zIndex: table.z_index,
      }}
    >
      {/* Fila superior: nombre + indicadores rápidos (cocina / cuenta). */}
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 truncate font-serif text-sm font-semibold leading-tight tracking-tight">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {s?.kitchen === 'preparing' ? (
            <span
              className="size-2 rounded-full bg-warning"
              role="img"
              aria-label="Cocina: preparando"
              title="Preparando"
            />
          ) : null}
          {s?.kitchen === 'ready' ? (
            <span
              className="size-2 rounded-full bg-success"
              role="img"
              aria-label="Cocina: lista"
              title="Lista"
            />
          ) : null}
          {s?.bill_requested ? (
            <Receipt className="size-3.5 text-destructive" role="img" aria-label="Cuenta pedida" />
          ) : null}
        </span>
      </div>

      {/* Fila inferior: estado o métricas de la sesión. */}
      {s ? (
        <div className="flex items-end justify-between gap-1">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            {s.party_size !== null ? (
              <span className="flex items-center gap-0.5">
                <Users className="size-3" aria-hidden />
                {s.party_size}
              </span>
            ) : null}
            <span>{elapsedLabel(s.opened_at)}</span>
          </span>
          <span className="font-serif text-xs font-semibold tabular-nums">
            {ARSFormat(s.total_cents)}
          </span>
        </div>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">{STATUS_LABEL.free}</span>
      )}
    </button>
  )
}
