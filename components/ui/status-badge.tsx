import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { Badge, type BadgeSize, type BadgeTone } from '@/components/ui/badge'

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
}

function StatusBadge<S extends string>({
  status,
  map,
  dot = true,
  size,
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
      {meta.label}
    </Badge>
  )
}

export { StatusBadge }
