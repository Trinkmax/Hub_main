import { SEGMENT_TONE_CLASSES } from '@/components/reservations/segment-meter'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { RadioCards, type RadioCardsItem } from '@/components/ui/radio-cards'
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
 * Son las `RadioCards` del kit: un grupo de radio de verdad (las flechas
 * mueven y eligen), con la hora como dato al costado y el cupo como línea de
 * apoyo.
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

  const items: RadioCardsItem[] = SEGMENT_KEYS.map((key) => {
    const load = segments?.[key] ?? null
    return {
      value: key,
      label: SEGMENT_LABELS[key],
      meta: settings[key].defaultTime,
      description: load ? (
        <>
          <RatioPill load={load} />
          {/* El número y la causa van completos para el lector de pantalla: el
              color de la pastilla nunca es la única señal. */}
          <span className="sr-only">{segmentAriaLabel(load, '')}</span>
        </>
      ) : segmentsFailed ? (
        // Mismo alto que la pastilla para que las tarjetas no salten.
        <span aria-hidden>—</span>
      ) : (
        <Skeleton aria-hidden className="h-4 w-12 rounded-full" />
      ),
    }
  })

  return (
    <div className="grid gap-2">
      <RadioCards
        aria-label="Servicio"
        aria-describedby={locked ? 'segment-picker-locked' : undefined}
        items={items}
        size="sm"
        // Tres columnas desde 390 px (casi todos los celulares): son tres
        // palabras cortas y así la decisión entra en una sola fila.
        className="min-[390px]:grid-cols-3"
        value={value}
        disabled={locked}
        onValueChange={(next) => onSelect(next as SegmentKey)}
      />

      {locked ? (
        <p id="segment-picker-locked" className="type-caption text-muted-foreground">
          El servicio lo define el evento ({SEGMENT_LABELS[lockedSegment]})
        </p>
      ) : null}

      {!locked && timeMismatch ? (
        <Callout
          tone="warning"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={onUseSuggestedTime}>
              Pasar a {suggested}
            </Button>
          }
        >
          La hora {timeMismatch.time} es de {SEGMENT_WITH_ARTICLE[timeMismatch.timeSegment]}
        </Callout>
      ) : null}

      {/* Siempre montado: un aria-live que aparece junto con su texto no se
          anuncia en todos los lectores de pantalla. */}
      <p
        aria-live="polite"
        className={autoSwitchedTo ? 'type-caption font-medium text-foreground' : 'sr-only'}
      >
        {autoSwitchedTo ? `Pasó a ${SEGMENT_LABELS[autoSwitchedTo]}` : ''}
      </p>
    </div>
  )
}

/** "19/70" con el tono del servicio (verde, ámbar o rojo). Decorativa: la tarjeta ya lo dice. */
function RatioPill({ load }: { load: SegmentLoad }) {
  const tone = SEGMENT_TONE_CLASSES[segmentTone(load)]
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex rounded-full border px-1.5 type-caption tabular-nums',
        tone.chip,
        tone.text,
      )}
    >
      {segmentRatio(load)}
    </span>
  )
}
