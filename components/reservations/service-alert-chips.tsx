import { Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  type AlertSeverity,
  type ResolvedAlert,
  SERVICE_ALERT_META,
  type ServiceAlert,
} from '@/lib/salon/alerts'
import { cn } from '@/lib/utils'

/**
 * Los avisos de una reserva, como etiquetas.
 *
 * El color NUNCA va solo: siempre con la etiqueta escrita. Un encargado
 * daltónico tiene que poder leerlo, y el mozo necesita saber QUÉ aviso es —
 * "hay algo rojo en esa fila" no le sirve para nada cuando está por servir.
 *
 * Rojo (`danger`) es riesgo médico: celíaco y alergia. Ámbar (`warning`) es
 * logística: vegetariano, vegano, acceso, silla de bebé. Reservar el rojo para
 * lo que puede lastimar a alguien es lo que hace que el rojo signifique algo
 * cuando aparece. Además del color cambia el ícono (triángulo contra «i»).
 */
export function ServiceAlertChip({
  alert,
  className,
}: {
  alert: ServiceAlert
  className?: string
}) {
  const meta = SERVICE_ALERT_META[alert]
  const critical = meta.severity === 'critical'
  return (
    <Badge
      tone={critical ? 'danger' : 'warning'}
      icon={critical ? TriangleAlert : Info}
      title={meta.hint}
      className={cn(critical && 'font-semibold', className)}
    >
      {meta.short}
    </Badge>
  )
}

/**
 * La tira de avisos de una reserva. No renderiza nada si no hay ninguno — que
 * es el caso normal, así que la fila tiene que quedar idéntica a como estaba.
 */
export function ServiceAlertChips({
  alerts,
  className,
  size: _size = 'sm',
}: {
  alerts: ResolvedAlert[]
  className?: string
  /**
   * @deprecated Las dos medidas son la misma desde el kit HUB (12 px, el
   * mínimo): se acepta para no romper a quien la pasa.
   */
  size?: 'xs' | 'sm'
}) {
  if (alerts.length === 0) return null
  return (
    // <span> pelado y no una lista con roles: estos chips se renderizan dentro
    // de celdas de tabla y hasta adentro de un <button> (la tarjeta del mozo),
    // donde un <ul> sería HTML inválido. El texto del chip ("SIN TACC") ya es
    // la etiqueta accesible.
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {alerts.map(({ alert }) => (
        <ServiceAlertChip key={alert} alert={alert} />
      ))}
    </span>
  )
}

/**
 * Tinte de la fila/tarjeta según el peor aviso. Deliberadamente suave: el chip
 * es el que grita, el fondo solo hace que la fila salte al pasar el ojo por una
 * lista de cuarenta. Un fondo fuerte convertiría la agenda en un semáforo.
 */
export function alertRowTint(severity: AlertSeverity | null): string {
  if (severity === 'critical') return 'bg-destructive-soft/60'
  if (severity === 'info') return 'bg-warning-soft/60'
  return ''
}
