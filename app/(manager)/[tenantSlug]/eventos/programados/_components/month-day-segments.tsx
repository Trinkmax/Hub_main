import {
  SEGMENT_TONE_CLASSES,
  SegmentBar,
  SegmentChip,
  ZoneBar,
  ZoneChip,
} from '@/components/reservations/segment-meter'
import {
  type DaySegments,
  SEGMENT_KEYS,
  type SegmentKey,
  type ZoneCaps,
  zoneLoad,
} from '@/lib/salon/segments'
import {
  agendaDetailLines,
  segmentAlertMark,
  segmentAriaLabel,
  segmentCellBreakdown,
  segmentHeadline,
  segmentTone,
  zoneAgendaDetailLines,
  zoneAriaLabel,
  zoneCellBreakdown,
  zoneHeadline,
  zoneTone,
} from '@/lib/salon/segments-copy'
import type { SalonZone } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Los servicios de un día en el mes: almuerzo, merienda y cena, cada uno con
 * PERSONAS contra SU cupo. Reemplaza al número único del día ("171/130"), que
 * mezclaba los tres servicios contra el salón entero.
 *
 * Solo aparecen los servicios con actividad (gente o eventos), siempre en
 * orden A/M/C. Nunca se muestra un total del día.
 *
 * - `cell`: la celda de la grilla (sm+). Entre 640 y 1023 px la celda tiene
 *   ~55-72 px útiles: entra "C 119/120" en mono 10px y la barra. Desde lg
 *   suma el desglose compacto en hasta dos renglones ("46/50 normales · 3
 *   cumples · 1 torta"): el dueño lo pidió visible sin abrir el día. Desde xl
 *   (~107 px) el título pasa a "Cena 119/120".
 * - `agenda`: la fila del celu (< sm), a todo el ancho: chips "Cena 119/120"
 *   y hasta dos líneas de detalle.
 *
 * Cada servicio es un botón que abre la vista del día anclada en él. El color
 * nunca es la única señal: el número va siempre y la causa completa está en el
 * aria-label y el title (no se usa Tooltip porque no hay TooltipProvider
 * global). Sin directiva: lo importa el mes, que es cliente.
 *
 * Con `zone` (el filtro de planta) cada servicio muestra solo la gente de esa
 * planta contra el cupo de la planta ("C 46/60"): ver `ZoneDaySegments`.
 */
export function MonthDaySegments({
  day,
  variant,
  dayLabel,
  onOpenSegment,
  zone = null,
  zoneCaps,
}: {
  day: DaySegments
  variant: 'cell' | 'agenda'
  /** Fecha larga ('jueves 10 de septiembre') para el aria-label de cada servicio. */
  dayLabel: string
  onOpenSegment: (segment: SegmentKey) => void
  /** Planta elegida en el filtro del calendario; null = «Todo». */
  zone?: SalonZone | null
  /** Cupo de cada planta (obligatorio si hay `zone`). */
  zoneCaps?: ZoneCaps
}) {
  if (zone && zoneCaps) {
    return (
      <ZoneDaySegments
        day={day}
        variant={variant}
        dayLabel={dayLabel}
        onOpenSegment={onOpenSegment}
        zone={zone}
        zoneCaps={zoneCaps}
      />
    )
  }

  const active = SEGMENT_KEYS.map((key) => day.segments[key]).filter((s) => s.hasActivity)
  if (active.length === 0) return null

  if (variant === 'agenda') {
    const details = agendaDetailLines(day)
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5">
          {active.map((s) => (
            <SegmentChip
              key={s.key}
              segment={s}
              label="short"
              onClick={() => onOpenSegment(s.key)}
              ariaLabel={segmentAriaLabel(s, dayLabel)}
            />
          ))}
        </div>
        {details.length > 0 ? (
          // Una línea por servicio, unidas en un solo párrafo para que el
          // line-clamp corte a dos renglones en total (y no dos por servicio).
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {details.join('. ')}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {active.map((s) => {
        const tone = SEGMENT_TONE_CLASSES[segmentTone(s)]
        const label = segmentAriaLabel(s, dayLabel)
        // La celda no repite el evento: su chip, justo abajo, ya muestra la carga.
        const breakdown = segmentCellBreakdown(s)
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onOpenSegment(s.key)}
            aria-label={label}
            title={label}
            className="-mx-1 flex min-w-0 flex-col gap-0.5 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span
              className={cn('font-mono text-[10px] leading-3 font-medium tabular-nums', tone.text)}
            >
              <span className="xl:hidden">{segmentHeadline(s, 'letter')}</span>
              <span className="hidden xl:inline">{segmentHeadline(s, 'short')}</span>
              {/* Rojo con pocas personas: las normales pisaron lo que apartó
                  el evento. El "!" avisa que el número solo no lo explica; la
                  causa entera está en el title. */}
              {segmentAlertMark(s)}
            </span>
            <SegmentBar segment={s} size="xs" />
            {breakdown ? (
              <span className="hidden text-[10px] leading-3 text-muted-foreground lg:line-clamp-2">
                {breakdown}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * El día filtrado por planta: por servicio CON GENTE EN ESA PLANTA, personas de
 * la planta contra su cupo ("Cena 46/60"), la barra simple y los festejos de
 * esa planta. Mismo layout que la vista sin filtro para que el ojo no tenga
 * que reaprender la celda; sin el desglose de normales ni del evento, que son
 * del servicio entero.
 */
function ZoneDaySegments({
  day,
  variant,
  dayLabel,
  onOpenSegment,
  zone,
  zoneCaps,
}: {
  day: DaySegments
  variant: 'cell' | 'agenda'
  dayLabel: string
  onOpenSegment: (segment: SegmentKey) => void
  zone: SalonZone
  zoneCaps: ZoneCaps
}) {
  const active = SEGMENT_KEYS.map((key) => zoneLoad(day.segments[key], zone, zoneCaps)).filter(
    (z) => z.hasActivity,
  )
  if (active.length === 0) return null

  if (variant === 'agenda') {
    const details = zoneAgendaDetailLines(day, zone, zoneCaps)
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5">
          {active.map((z) => (
            <ZoneChip
              key={z.segment}
              load={z}
              label="short"
              onClick={() => onOpenSegment(z.segment)}
              ariaLabel={zoneAriaLabel(z, dayLabel)}
            />
          ))}
        </div>
        {details.length > 0 ? (
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {details.join('. ')}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {active.map((z) => {
        const tone = SEGMENT_TONE_CLASSES[zoneTone(z)]
        const label = zoneAriaLabel(z, dayLabel)
        const breakdown = zoneCellBreakdown(z)
        return (
          <button
            key={z.segment}
            type="button"
            onClick={() => onOpenSegment(z.segment)}
            aria-label={label}
            title={label}
            className="-mx-1 flex min-w-0 flex-col gap-0.5 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span
              className={cn('font-mono text-[10px] leading-3 font-medium tabular-nums', tone.text)}
            >
              <span className="xl:hidden">{zoneHeadline(z, 'letter')}</span>
              <span className="hidden xl:inline">{zoneHeadline(z, 'short')}</span>
            </span>
            <ZoneBar load={z} size="xs" />
            {breakdown ? (
              <span className="hidden text-[10px] leading-3 text-muted-foreground lg:line-clamp-2">
                {breakdown}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
