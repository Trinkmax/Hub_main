import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { formatNumber, formatNumberKind, type NumberFormatKind } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'
import { Card } from './card'
import { KPIBase, type KPITone } from './kpi'

type Tone = 'default' | 'positive' | 'negative' | 'muted'

/** `positive` y `negative` pasan igual; `default` y `muted` son neutros (§3.5). */
const TONE_MAP: Readonly<Record<Tone, KPITone>> = {
  default: 'neutral',
  muted: 'neutral',
  positive: 'positive',
  negative: 'negative',
}

const TONE_TEXT: Readonly<Record<KPITone, string>> = {
  positive: 'text-success-text',
  negative: 'text-destructive-text',
  neutral: 'text-muted-foreground',
}

type StatCardProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  label: string
  /** Valor ya formateado (string/ReactNode). Excluyente con `numberValue`. */
  value?: React.ReactNode
  /** Número crudo: se formatea quieto (antes contaba de 0 a n). */
  numberValue?: number
  /** Decimales cuando no hay `numberFormatKind`. */
  numberDecimals?: number
  /** Formato serializable (sirve desde un Server Component). */
  numberFormatKind?: NumberFormatKind
  hint?: React.ReactNode
  delta?: React.ReactNode
  deltaTone?: Tone
  icon?: LucideIcon
  /** @deprecated se ignora: en el kit los íconos de KPI van apagados, el color es para el estado. */
  iconClassName?: string
  sparkline?: React.ReactNode
}

let warnedIconClassName = false

/**
 * @deprecated Usá `KPI` adentro de un `KPIGroup` (una sola tarjeta con
 * divisores). Queda para las páginas que todavía no migraron: dibuja un `KPI`
 * en su propia `Card`, quieto (sin conteo ni «float»).
 *
 * | Prop vieja | Qué hace ahora |
 * |---|---|
 * | `numberValue` + `numberFormatKind`/`numberDecimals` | se formatea estático con `formatNumberKind()` |
 * | `delta` + `deltaTone` | va debajo del valor; `default` y `muted` pasan a neutro; sin flecha propia |
 * | `iconClassName` | se ignora (aviso en desarrollo) |
 * | `sparkline` | debajo del valor |
 */
export function StatCard({
  label,
  value,
  numberValue,
  numberDecimals = 0,
  numberFormatKind,
  hint,
  delta,
  deltaTone = 'muted',
  icon,
  iconClassName,
  sparkline,
  className,
  ...props
}: StatCardProps) {
  if (iconClassName && process.env.NODE_ENV !== 'production' && !warnedIconClassName) {
    warnedIconClassName = true
    console.warn(
      '[StatCard] `iconClassName` se ignora en el kit nuevo (§3.5): el ícono va apagado. Sacalo al migrar a KPI.',
    )
  }

  const shownValue =
    typeof numberValue === 'number'
      ? numberFormatKind
        ? formatNumberKind(numberValue, numberFormatKind)
        : formatNumber(numberValue, numberDecimals)
      : value

  const tone = TONE_MAP[deltaTone]
  const deltaNode = delta ? (
    <div
      data-slot="kpi-delta"
      className={cn('flex flex-wrap items-center gap-x-1 type-caption', TONE_TEXT[tone])}
    >
      <span className="inline-flex items-center gap-1 font-medium tabular-nums">{delta}</span>
    </div>
  ) : null

  return (
    <Card data-slot="stat-card" className={cn('gap-0', className)} {...props}>
      <KPIBase
        label={label}
        value={shownValue}
        icon={icon}
        hint={hint}
        deltaNode={deltaNode}
        sparkline={sparkline}
      />
    </Card>
  )
}
