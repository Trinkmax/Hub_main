import { Cake, PartyPopper } from 'lucide-react'
import type { ServiceBucket, ServiceRow, ZoneCovers } from '@/lib/salon/services'
import { serviceTimeRange } from '@/lib/salon/services'
import { ZONE_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * El encabezado de un SERVICIO: cuántos cubiertos hay y dónde se sientan.
 *
 * "Desayuno: X en salón, X en terraza" fue el pedido literal del dueño. Lo que
 * resuelve no es un reporte: es la decisión de armar el salón. Por eso el corte
 * por zona va en una barra apilada y no en tres números sueltos — la proporción
 * (¿la cena está toda arriba?) se lee antes que los números.
 *
 * Sin estado: sirve igual en un RSC que dentro del diálogo del calendario.
 */

/** Cada zona con su color de gráfico, estable en claro y en oscuro. */
const ZONE_STYLE: Record<keyof ZoneCovers, { label: string; bar: string; dot: string }> = {
  planta_alta: {
    label: ZONE_LABELS.planta_alta,
    bar: 'bg-chart-1',
    dot: 'bg-chart-1',
  },
  planta_baja: {
    label: ZONE_LABELS.planta_baja,
    bar: 'bg-chart-4',
    dot: 'bg-chart-4',
  },
  event_floating: {
    label: 'En evento',
    bar: 'bg-chart-3',
    dot: 'bg-chart-3',
  },
}

const ZONE_SEQUENCE: Array<keyof ZoneCovers> = ['planta_alta', 'planta_baja', 'event_floating']

export function ServiceSummary({
  bucket,
  className,
  compact = false,
}: {
  bucket: ServiceBucket<ServiceRow>
  className?: string
  /** Versión de una línea, para el subheader de una tabla apretada. */
  compact?: boolean
}) {
  const range = serviceTimeRange(bucket)
  const zones = ZONE_SEQUENCE.map((z) => ({
    zone: z,
    covers: bucket.byZone[z],
    tables: bucket.tablesByZone[z],
  })).filter((z) => z.covers > 0)

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-serif text-base font-semibold tracking-tight text-foreground">
          {bucket.label}
        </span>
        {range ? (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{range}</span>
        ) : null}

        <span className="ml-auto flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="font-mono text-lg font-semibold leading-none tabular-nums">
            {bucket.covers}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {bucket.covers === 1 ? 'cubierto' : 'cubiertos'}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            · {bucket.activeCount} {bucket.activeCount === 1 ? 'reserva' : 'reservas'}
          </span>
        </span>
      </div>

      {bucket.covers > 0 ? (
        <>
          {/* La barra apilada: la proporción entre zonas se lee sin contar. */}
          <div
            className={cn(
              'mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-secondary',
              compact && 'mt-1.5 h-1',
            )}
            aria-hidden
          >
            {zones.map(({ zone, covers }) => (
              <div
                key={zone}
                className={ZONE_STYLE[zone].bar}
                style={{ width: `${(covers / bucket.covers) * 100}%` }}
              />
            ))}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {zones.map(({ zone, covers, tables }) => (
              <span key={zone} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn('size-1.5 shrink-0 rounded-full', ZONE_STYLE[zone].dot)}
                />
                {ZONE_STYLE[zone].label}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {covers}
                </span>
                {/* Cubiertos y mesas no son lo mismo: 38 personas pueden ser 9
                    mesas o 19, y para armar el salón hacen falta las dos. */}
                <span className="tabular-nums text-muted-foreground/70">
                  ({tables} {tables === 1 ? 'mesa' : 'mesas'})
                </span>
              </span>
            ))}

            {/* Lo que hay que preparar aparte, no lo que hay que sentar. */}
            {bucket.birthdays > 0 ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <PartyPopper className="size-3" aria-hidden />
                {bucket.birthdays} {bucket.birthdays === 1 ? 'cumple' : 'cumples'}
              </span>
            ) : null}
            {bucket.cakes > 0 ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <Cake className="size-3" aria-hidden />
                {bucket.cakes} {bucket.cakes === 1 ? 'torta' : 'tortas'}
              </span>
            ) : null}
            {bucket.inactiveCount > 0 ? (
              <span className="text-muted-foreground/70">{bucket.inactiveCount} sin efecto</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {bucket.inactiveCount} {bucket.inactiveCount === 1 ? 'reserva' : 'reservas'} sin efecto
          (canceladas o que no vinieron).
        </p>
      )}
    </div>
  )
}
