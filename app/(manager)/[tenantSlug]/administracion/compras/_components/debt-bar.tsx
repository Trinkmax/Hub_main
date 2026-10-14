import { DUE_SWATCHES } from '@/components/administracion/charts/palette'
import { pct } from '@/components/administracion/charts/scale'
import { cn } from '@/lib/utils'

/**
 * La deuda de un proveedor dibujada en su renglón de la libreta: una barrita
 * tan larga como su deuda contra la más grande de la lista, partida por
 * urgencia (vencido · vence esta semana · más adelante).
 *
 * Es un adorno (`aria-hidden`): el importe, lo vencido y el «desde cuándo» ya
 * están escritos al lado, así que acá no hay marcas enfocables ni globitos. Una
 * `SplitBar` por renglón pondría tres paradas de Tab en cada uno de 79.
 *
 * Los colores son los de estado de toda la sección (`DUE_SWATCHES`), los mismos
 * de la barra del héroe: el renglón repite, en chico, lo que el héroe suma.
 *
 * Server-safe. Sin deuda no dibuja nada.
 */
export function DebtBar({
  overdueCents,
  soonCents,
  laterCents,
  maxCents,
  height = 6,
  className,
}: {
  overdueCents: number
  soonCents: number
  laterCents: number
  /** La deuda más grande de la lista: el largo entero del riel. */
  maxCents: number
  height?: number
  className?: string
}) {
  const parts = [
    { key: 'overdue', cents: Math.max(0, overdueCents), swatch: DUE_SWATCHES.overdue },
    { key: 'week', cents: Math.max(0, soonCents), swatch: DUE_SWATCHES.week },
    { key: 'later', cents: Math.max(0, laterCents), swatch: DUE_SWATCHES.later },
  ].filter((part) => part.cents > 0)
  const total = parts.reduce((sum, part) => sum + part.cents, 0)
  if (total <= 0) return null
  // Una deuda chica al lado de una enorme igual se tiene que ver: 6 % de mínimo.
  const width = Math.min(100, Math.max(6, pct(total, Math.max(maxCents, total))))

  return (
    <div
      aria-hidden="true"
      className={cn('w-full max-w-64 overflow-hidden rounded-full bg-adm-track', className)}
      style={{ height }}
    >
      <div className="rail-grow flex h-full gap-0.5" style={{ width: `${width}%` }}>
        {parts.map((part) => (
          <span
            key={part.key}
            className={cn('h-full min-w-1 rounded-full', part.swatch)}
            style={{ flexGrow: part.cents, flexBasis: 0 }}
          />
        ))}
      </div>
    </div>
  )
}
