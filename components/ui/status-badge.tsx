import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { Badge, type BadgeSize, type BadgeTone } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format/number-kind'

/**
 * Etiqueta de un estado de dominio a partir de su mapa (kit HUB §3.4).
 *
 * El mapa vive en la lógica, no en la pantalla: `lib/<dominio>/status-meta.ts`
 * exporta un `StatusMap` y todas las pantallas que muestran ese estado usan el
 * mismo. Así «Enviada con fallas» dice lo mismo y tiene el mismo tono en la
 * lista, en la ficha y en el ⌘K, y agregar un estado es tocar un solo lugar
 * (TypeScript avisa si al mapa le falta uno).
 *
 * ```ts
 * // lib/broadcasts/status-meta.ts
 * import type { StatusMap } from '@/components/ui/status-badge'
 * export const BROADCAST_STATUS: StatusMap<BroadcastStatus> = {
 *   draft: { label: 'Borrador', tone: 'neutral', icon: PencilLine },
 *   sent: { label: 'Enviada', tone: 'success' },
 *   failed: { label: 'Fallida', tone: 'danger', description: 'Meta rechazó el envío' },
 *   // …
 * }
 *
 * // en la pantalla (Server Component o cliente)
 * <StatusBadge status={broadcast.status} map={BROADCAST_STATUS} />
 * ```
 *
 * **Con una cuenta o un texto propio** el tono, el punto (o el ícono) y la
 * descripción siguen saliendo del mapa; cambia solo lo que dice:
 *
 * ```tsx
 * <StatusBadge status="pending" map={RESERVATION_STATUS} count={3}>pendientes</StatusBadge>
 * // «3 pendientes», en el tono de «Pendiente»
 * <StatusBadge status="pending" map={RESERVATION_STATUS} count={3} />
 * // «Pendiente · 3»: sin texto propio, la etiqueta del mapa y la cuenta
 * ```
 */

export type StatusMeta = {
  label: string
  tone: BadgeTone
  /** Reemplaza al punto: un estado lleva punto o ícono, no los dos. */
  icon?: LucideIcon
  /** Qué significa el estado. Se muestra como `title` (al pasar el mouse). */
  description?: string
}

export type StatusMap<S extends string> = Record<S, StatusMeta>

export type StatusBadgeProps<S extends string> = Omit<React.ComponentProps<'span'>, 'children'> & {
  status: S
  map: StatusMap<S>
  /** Default `true`. Si el estado trae ícono, va el ícono en lugar del punto. */
  dot?: boolean
  size?: BadgeSize
  /**
   * Texto propio en lugar de la etiqueta del mapa («pendientes», «3 sin
   * confirmar»), en el tono del estado. Con `count`, va después de la cuenta.
   */
  children?: React.ReactNode
  /**
   * Una cuenta, con el formato de la casa y cifras tabulares: adelante del
   * texto propio («3 pendientes») o, sin texto propio, después de la etiqueta
   * del mapa («Pendiente · 3»).
   */
  count?: number
}

/** Lo que dice la etiqueta de un estado: la del mapa, un texto propio y la cuenta. */
function StatusText({
  label,
  count,
  children,
}: {
  label: string
  count?: number
  children?: React.ReactNode
}) {
  const hasOwnText = children !== undefined && children !== null && children !== false
  if (count === undefined) return hasOwnText ? children : label
  const amount = (
    <span data-slot="status-badge-count" className="tabular-nums">
      {formatNumber(count)}
    </span>
  )
  // Un solo span en línea (no ítems del flex de la etiqueta): los espacios se
  // ven y el lector oye «3 pendientes» o «Pendiente 3», no «Pendiente3».
  return (
    <span data-slot="status-badge-text">
      {hasOwnText ? (
        <>
          {amount} {children}
        </>
      ) : (
        <>
          {label} <span aria-hidden="true">·</span> {amount}
        </>
      )}
    </span>
  )
}

function StatusBadge<S extends string>({
  status,
  map,
  dot = true,
  size,
  count,
  children,
  ...props
}: StatusBadgeProps<S>) {
  // Un estado que la base conoce y el mapa todavía no (columna nueva, dato
  // viejo) no rompe la pantalla: se ve tal cual, en neutro.
  const meta: StatusMeta = (map as Partial<Record<string, StatusMeta>>)[status] ?? {
    label: status,
    tone: 'neutral',
  }

  return (
    <Badge
      data-status={status}
      tone={meta.tone}
      icon={meta.icon}
      dot={dot && !meta.icon}
      size={size}
      title={meta.description}
      {...props}
    >
      <StatusText label={meta.label} count={count}>
        {children}
      </StatusText>
    </Badge>
  )
}

export { StatusBadge }
