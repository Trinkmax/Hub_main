// Helpers de formato compartidos por la wallet del cliente (es-AR, ARS, fechas).
// Puros, sin I/O — usables tanto en server como en client islands.

import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/** Centavos → pesos formateados ($ 12.500). */
export function formatArs(cents: number): string {
  return ARS.format(Math.round(cents) / 100)
}

/** Entero con separadores de miles (1.250). */
export function formatPoints(value: number): string {
  return value.toLocaleString('es-AR')
}

/** dd/MM/yyyy en zona local del navegador (visitas, canjes). */
export function formatDate(iso: string): string {
  return format(new Date(iso), 'dd/MM/yyyy', { locale: es })
}

/** Día + hora corta para eventos (Vie 4 de jul · 21:00). */
export function formatEventDate(iso: string): string {
  return format(new Date(iso), "EEE d 'de' MMM · HH:mm", { locale: es })
}

/** dd/MM con hora corta para movimientos del historial. */
export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'dd/MM/yy · HH:mm', { locale: es })
}

/** Mapa de `reason` técnico del ledger → etiqueta amigable para el cliente. */
const LEDGER_LABELS: Record<string, string> = {
  rule_engine: 'Compra',
  qr_award: 'Compra',
  welcome_bonus: 'Bienvenida',
  event_attendance: 'Evento',
  reward_redeem: 'Canje',
  session_payment_discount: 'Descuento',
  lunch_visit: 'Almuerzo',
}

export function ledgerLabel(reason: string): string {
  return LEDGER_LABELS[reason] ?? 'Movimiento'
}

/** Etiqueta + variante de badge para el estado de un canje. */
export function redemptionStatusMeta(status: string): {
  label: string
  variant: 'success' | 'warning' | 'muted'
} {
  switch (status) {
    case 'delivered':
      return { label: 'Entregado', variant: 'success' }
    case 'pending':
      return { label: 'Por retirar', variant: 'warning' }
    case 'cancelled':
      return { label: 'Cancelado', variant: 'muted' }
    default:
      return { label: status, variant: 'muted' }
  }
}
