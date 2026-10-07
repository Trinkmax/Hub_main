import type { StatusMap } from '@/components/ui/status-badge'
import { daysBetween, isoDayInCordoba } from '@/lib/dates'

/*
 * Etiquetas y mapas de estado de la ficha y la lista de clientes (kit HUB
 * §3.4: un estado se dibuja con `StatusBadge` y su mapa). Viven acá y no en
 * `lib/customers` porque ese módulo es de otro lote durante el rediseño; el
 * lugar final es `lib/customers/status-meta.ts` (y `lib/redemptions/…` para
 * los canjes). Puro y server-safe.
 */

/** De dónde salió el cliente (`customers.source`). */
const CUSTOMER_SOURCE_LABEL: Readonly<Record<string, string>> = {
  qr: 'Se sumó por QR',
  manual: 'Carga manual',
  import: 'Importado',
}

/** Un origen que la app todavía no conoce se ve tal cual, antes que dejar un hueco. */
export function customerSourceLabel(source: string): string {
  return CUSTOMER_SOURCE_LABEL[source] ?? source
}

/** Cómo se cargó la visita (`visits.source`). */
const VISIT_SOURCE_LABEL: Readonly<Record<string, string>> = {
  cashier: 'Caja',
  import: 'Importada',
}

export function visitSourceLabel(source: string): string {
  return VISIT_SOURCE_LABEL[source] ?? source
}

export type RedemptionStatus = 'pending' | 'delivered' | 'cancelled'

/** Estado de un canje del club (`reward_redemptions.status`). */
export const REDEMPTION_STATUS: StatusMap<RedemptionStatus> = {
  pending: {
    label: 'Por entregar',
    tone: 'warning',
    description: 'El canje está hecho y falta darle la recompensa.',
  },
  delivered: { label: 'Entregado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
}

/** «JP» para el avatar; «?» si no hay nombre. */
export function customerInitials(firstName: string | null, lastName: string | null): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?'
}

/**
 * «Hoy», «Ayer», «Hace 12 días», «Hace 3 meses», «Hace 1 año», contados en días
 * del calendario de Córdoba (no en horas ni en el día UTC del server).
 * `null` si no hay fecha.
 */
export function relativeDayLabel(value: string | null | undefined, today: string): string | null {
  const day = isoDayInCordoba(value)
  if (!day) return null
  const days = daysBetween(day, today)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 30) return `Hace ${days} días`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return months === 1 ? 'Hace 1 mes' : `Hace ${months} meses`
  }
  const years = Math.floor(days / 365)
  return years === 1 ? 'Hace 1 año' : `Hace ${years} años`
}
