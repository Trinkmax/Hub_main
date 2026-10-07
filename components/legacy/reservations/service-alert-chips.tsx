import { Info, TriangleAlert } from 'lucide-react'
import {
  type AlertSeverity,
  type ResolvedAlert,
  SERVICE_ALERT_META,
  type ServiceAlert,
} from '@/lib/salon/alerts'
import { cn } from '@/lib/utils'

/**
 * Los avisos de una reserva, como pastillas.
 *
 * El color NUNCA va solo: siempre con la etiqueta escrita. Un encargado
 * daltónico tiene que poder leerlo, y el mozo necesita saber QUÉ aviso es —
 * "hay algo rojo en esa fila" no le sirve para nada cuando está por servir.
 *
 * Rojo (`destructive`) es riesgo médico: celíaco y alergia. Ámbar (`warning`)
 * es logística: vegetariano, vegano, acceso, silla de bebé. Reservar el rojo
 * para lo que puede lastimar a alguien es lo que hace que el rojo signifique
 * algo cuando aparece.
 */

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold uppercase leading-none tracking-wide'

const CHIP_TONE: Record<AlertSeverity, string> = {
  critical: 'border-destructive/50 bg-destructive/10 text-destructive',
  // `--warning` es claro: el texto va en foreground, como en el resto de la app.
  info: 'border-warning/50 bg-warning/10 text-foreground',
}

export function ServiceAlertChip({
  alert,
  className,
}: {
  alert: ServiceAlert
  className?: string
}) {
  const meta = SERVICE_ALERT_META[alert]
  const Icon = meta.severity === 'critical' ? TriangleAlert : Info
  return (
    <span className={cn(CHIP_BASE, CHIP_TONE[meta.severity], className)} title={meta.hint}>
      <Icon className="size-2.5 shrink-0" aria-hidden />
      {meta.short}
    </span>
  )
}

/**
 * La tira de avisos de una reserva. No renderiza nada si no hay ninguno — que
 * es el caso normal, así que la fila tiene que quedar idéntica a como estaba.
 */
export function ServiceAlertChips({
  alerts,
  className,
  size = 'sm',
}: {
  alerts: ResolvedAlert[]
  className?: string
  /** `xs` para la tarjeta del mozo y la agenda; `sm` para fichas y detalle. */
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
        <ServiceAlertChip
          key={alert}
          alert={alert}
          className={size === 'xs' ? 'text-[9px]' : 'text-[10px]'}
        />
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
  if (severity === 'critical') return 'bg-destructive/[0.06] hover:bg-destructive/[0.10]'
  if (severity === 'info') return 'bg-warning/[0.07] hover:bg-warning/[0.12]'
  return ''
}
