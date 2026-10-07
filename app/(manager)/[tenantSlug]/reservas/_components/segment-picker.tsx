import { SEGMENT_TONE_CLASSES } from '@/components/reservations/segment-meter'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SEGMENT_KEYS,
  type SegmentKey,
  type SegmentLoad,
  type SegmentSettingsResolved,
} from '@/lib/salon/segments'
import {
  SEGMENT_LABELS,
  SEGMENT_WITH_ARTICLE,
  segmentAriaLabel,
  segmentRatio,
  segmentTone,
} from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * "Tipo de servicio" del alta y la edición de reservas: Almuerzo, Merienda y
 * Cena, cada uno con su hora sugerida y cómo viene su cupo ese día ("19/70").
 *
 * Reemplaza al selector de `meal_type` con 4 opciones: el desayuno dejó de
 * ofrecerse (hubo 2 en toda la historia y cuenta como almuerzo) y el cupo se
 * mide por estos 3 servicios, así que elegir el servicio y ver si entra es la
 * misma decisión.
 *
 * Presentacional y sin estado: el form decide qué pasa al tocar (mover la hora
 * si no la tocaron, avisar si la hora es de otro servicio). Una reserva legacy
 * con 'breakfast' o 'hub_event' se ve marcada en Almuerzo o Cena sin cambiar
 * su valor hasta que alguien toque un servicio.
 */
export function SegmentPicker({
  value,
  settings,
  segments,
  segmentsFailed,
  lockedSegment,
  onSelect,
  timeMismatch,
  onUseSuggestedTime,
  autoSwitchedTo,
}: {
  /** Servicio marcado (el del evento si hay uno elegido). */
  value: SegmentKey
  settings: SegmentSettingsResolved
  /** Cómo viene cada servicio ese día; null mientras llega el cupo o si falló. */
  segments: Record<SegmentKey, SegmentLoad> | null
  /**
   * No se pudo leer el cupo del día. Sin esto, `segments` null se leía como
   * "está llegando" y los 3 skeletons quedaban para siempre; el reintento vive
   * en el medidor de personas.
   */
  segmentsFailed: boolean
  /** Con un evento elegido, el servicio lo define su hora y no se puede cambiar acá. */
  lockedSegment: SegmentKey | null
  onSelect: (segment: SegmentKey) => void
  /** La hora cargada cae en otro servicio que el marcado. */
  timeMismatch: { time: string; timeSegment: SegmentKey } | null
  onUseSuggestedTime: () => void
  /** El cambio de hora pasó la reserva a otro servicio: se avisa (aria-live). */
  autoSwitchedTo: SegmentKey | null
}) {
  const locked = lockedSegment !== null
  const suggested = settings[value].defaultTime

  return (
    <div className="space-y-2">
      <fieldset aria-describedby={locked ? 'segment-picker-locked' : undefined} className="min-w-0">
        <legend className="sr-only">Servicio</legend>
        <div className="grid grid-cols-3 gap-2">
          {SEGMENT_KEYS.map((key) => {
            const active = value === key
            const load = segments?.[key] ?? null
            const time = settings[key].defaultTime
            // El número y la causa van completos para el lector de pantalla: el
            // color de la pastilla nunca es la única señal.
            const label = load
              ? `${segmentAriaLabel(load, '')} Hora sugerida ${time}.`
              : `${SEGMENT_LABELS[key]}, hora sugerida ${time}.`
            return (
              <button
                type="button"
                key={key}
                aria-pressed={active}
                aria-label={label}
                disabled={locked}
                onClick={() => onSelect(key)}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border px-1.5 py-2 text-sm font-medium outline-none transition-all',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-inner'
                    : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary disabled:opacity-60 disabled:hover:bg-card/40',
                )}
              >
                <span>{SEGMENT_LABELS[key]}</span>
                <span className="font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
                  {time}
                </span>
                {load ? (
                  <RatioPill load={load} />
                ) : segmentsFailed ? (
                  // Mismo alto que la pastilla para que los botones no salten.
                  <span
                    aria-hidden
                    className="font-mono text-[10px] font-normal leading-4 text-muted-foreground"
                  >
                    —
                  </span>
                ) : (
                  <Skeleton aria-hidden className="h-4 w-10 rounded-full" />
                )}
              </button>
            )
          })}
        </div>
      </fieldset>

      {locked ? (
        <p id="segment-picker-locked" className="text-xs text-muted-foreground">
          El servicio lo define el evento ({SEGMENT_LABELS[lockedSegment]})
        </p>
      ) : null}

      {!locked && timeMismatch ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2">
          <p className="text-xs text-foreground">
            La hora {timeMismatch.time} es de {SEGMENT_WITH_ARTICLE[timeMismatch.timeSegment]}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 bg-card"
            onClick={onUseSuggestedTime}
          >
            Pasar a {suggested}
          </Button>
        </div>
      ) : null}

      {/* Siempre montado: un aria-live que aparece junto con su texto no se
          anuncia en todos los lectores de pantalla. */}
      <p
        aria-live="polite"
        className={autoSwitchedTo ? 'text-xs font-medium text-foreground' : 'sr-only'}
      >
        {autoSwitchedTo ? `Pasó a ${SEGMENT_LABELS[autoSwitchedTo]}` : ''}
      </p>
    </div>
  )
}

/** "19/70" con el tono del servicio (verde, ámbar o rojo). Decorativa: el botón ya lo dice. */
function RatioPill({ load }: { load: SegmentLoad }) {
  const tone = SEGMENT_TONE_CLASSES[segmentTone(load)]
  return (
    <span
      aria-hidden
      className={cn(
        'rounded-full border px-1.5 font-mono text-[10px] font-normal leading-4 tabular-nums',
        tone.chip,
        tone.text,
      )}
    >
      {segmentRatio(load)}
    </span>
  )
}
