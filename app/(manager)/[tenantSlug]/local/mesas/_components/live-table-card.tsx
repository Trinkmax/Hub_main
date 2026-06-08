'use client'

import { Receipt, Users } from 'lucide-react'
import { type CSSProperties, memo } from 'react'
import { bodyRadius, ChairsSvg } from '@/components/floor-plan/table-glyph'
import type { LiveTable } from '@/lib/floor-plan/queries'
import { ARSFormat } from '@/lib/salon/format'
import { cn } from '@/lib/utils'

export type LiveTableCardProps = { table: LiveTable; onOpen: (table: LiveTable) => void }

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

// Cuerpo: tinte suave + borde superior de 3px del color de estado (glanceable
// a media luz) + sombra. El estado también pinta las sillas (--fp-seat).
const STATUS_SURFACE: Record<LiveStatus, string> = {
  free: 'border-success/35 border-t-[3px] border-t-success/70 bg-success/8 text-foreground',
  open: 'border-warning/45 border-t-[3px] border-t-warning bg-warning/14 text-foreground',
  paid: 'border-info/45 border-t-[3px] border-t-info bg-info/12 text-foreground',
}

// Color de las sillas por estado (libre = neutro por default del token --seat).
const SEAT_VARS: Record<LiveStatus, CSSProperties> = {
  free: {},
  open: {
    '--fp-seat': 'color-mix(in oklch, var(--warning) 82%, var(--card))',
    '--fp-seat-border': 'var(--warning)',
  } as CSSProperties,
  paid: {
    '--fp-seat': 'color-mix(in oklch, var(--info) 82%, var(--card))',
    '--fp-seat-border': 'var(--info)',
  } as CSSProperties,
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  free: 'Libre',
  open: 'Ocupada',
  paid: 'Pagada',
}

const STATUS_DOT: Record<LiveStatus, string> = {
  free: 'bg-success',
  open: 'bg-warning',
  paid: 'bg-info',
}

function LiveTableCardImpl({ table, onOpen }: LiveTableCardProps) {
  const status = liveStatusOf(table)
  const s = table.session
  const rotation = table.rotation ?? 0
  const title = s?.alias ?? table.label
  const radius = bodyRadius(table.shape, table.corner_radius || 8)
  const hasIndicator = (s?.kitchen && s.kitchen !== 'none') || s?.bill_requested

  return (
    <button
      type="button"
      onClick={() => onOpen(table)}
      aria-label={`${title} — ${STATUS_LABEL[status]}${s ? ` · ${ARSFormat(s.total_cents)}` : ''}`}
      className="group absolute outline-none transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{
        left: table.x,
        top: table.y,
        width: table.width,
        height: table.height,
        zIndex: table.z_index,
        ...SEAT_VARS[status],
      }}
    >
      {/* Capa que rota: SOLO sillas + cuerpo (el texto va derecho, sin rotar). */}
      <div
        className="absolute inset-0"
        style={{
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        <ChairsSvg
          shape={table.shape}
          kind="table"
          width={table.width}
          height={table.height}
          capacity={table.capacity}
        />
        <div
          className={cn('absolute inset-0 border shadow-sm', STATUS_SURFACE[status])}
          style={{ borderRadius: radius }}
        />
      </div>

      {/* Indicadores (cocina / cuenta): esquina fija, siempre derechos. */}
      {hasIndicator ? (
        <span className="absolute right-1 top-1 z-10 flex items-center gap-1">
          {s?.kitchen === 'preparing' ? (
            <span
              className="size-2.5 rounded-full bg-warning ring-2 ring-warning/25"
              role="img"
              aria-label="Cocina: preparando"
              title="Preparando"
            />
          ) : null}
          {s?.kitchen === 'ready' ? (
            <span
              className="size-2.5 animate-pulse rounded-full bg-success ring-2 ring-success/30"
              role="img"
              aria-label="Cocina: lista"
              title="Lista"
            />
          ) : null}
          {s?.bill_requested ? (
            <Receipt className="size-3.5 text-destructive" role="img" aria-label="Cuenta pedida" />
          ) : null}
        </span>
      ) : null}

      {/* Texto: número centrado + estado/gasto. SIEMPRE derecho (no rota) y
          centrado → legible en mobile y en mesas rotadas. */}
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1 text-center leading-none">
        <span className="font-serif text-sm font-semibold tabular-nums">{table.label}</span>
        {s ? (
          <span className="flex items-center gap-1 font-serif text-[11px] font-semibold tabular-nums">
            {s.party_size !== null ? (
              <span className="flex items-center gap-0.5 font-sans font-normal text-muted-foreground">
                <Users className="size-2.5" aria-hidden />
                {s.party_size}
              </span>
            ) : null}
            {ARSFormat(s.total_cents)}
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-[10px] text-muted-foreground">
            <span className={cn('size-1.5 rounded-full', STATUS_DOT.free)} aria-hidden />
            {STATUS_LABEL.free}
          </span>
        )}
      </span>

      {/* Nombre del grupo debajo de la mesa ocupada (estilo SevenRooms). */}
      {s?.alias ? (
        <span className="pointer-events-none absolute top-full left-1/2 mt-1 max-w-[140%] -translate-x-1/2 truncate rounded bg-card/80 px-1 text-center font-medium text-[11px] text-foreground/80 backdrop-blur-sm">
          {s.alias}
        </span>
      ) : null}
    </button>
  )
}

// El live floor reemplaza TODO `data` en cada refresh (refs nuevas), así que un
// memo por referencia no sirve: comparamos por los campos que se renderizan.
// `onOpen` es estable (mismo handler para todas las cards).
export const LiveTableCard = memo(LiveTableCardImpl, (a, b) => {
  const ta = a.table
  const tb = b.table
  return (
    a.onOpen === b.onOpen &&
    ta.element_id === tb.element_id &&
    ta.x === tb.x &&
    ta.y === tb.y &&
    ta.width === tb.width &&
    ta.height === tb.height &&
    ta.rotation === tb.rotation &&
    ta.corner_radius === tb.corner_radius &&
    ta.shape === tb.shape &&
    ta.z_index === tb.z_index &&
    ta.label === tb.label &&
    ta.capacity === tb.capacity &&
    (ta.session?.status ?? null) === (tb.session?.status ?? null) &&
    (ta.session?.total_cents ?? null) === (tb.session?.total_cents ?? null) &&
    (ta.session?.party_size ?? null) === (tb.session?.party_size ?? null) &&
    (ta.session?.alias ?? null) === (tb.session?.alias ?? null) &&
    (ta.session?.opened_at ?? null) === (tb.session?.opened_at ?? null) &&
    (ta.session?.kitchen ?? null) === (tb.session?.kitchen ?? null) &&
    (ta.session?.bill_requested ?? null) === (tb.session?.bill_requested ?? null)
  )
})
