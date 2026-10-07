import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { SegmentLoad, ZoneLoad } from '@/lib/salon/segments'
import {
  type SegmentTone,
  segmentAlertMark,
  segmentAriaLabel,
  segmentHeadline,
  segmentStatusLine,
  segmentTone,
  zoneAriaLabel,
  zoneHeadline,
  zoneTone,
} from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * El medidor de un servicio (almuerzo, merienda o cena): chip, barra y punto.
 *
 * Una sola pieza para todas las pantallas (mes, vista del día, alta, vista
 * rápida, operativo y salón) porque el dueño compara: si la cena se ve roja en
 * el calendario y ámbar en el operativo, deja de creerle a las dos. Los números
 * y los textos salen de `segments.ts` / `segments-copy.ts`; acá solo se pintan.
 *
 * Sin estado ni directiva: se renderiza igual en un Server Component que en un
 * componente cliente (la vista del día, el form).
 *
 * Tokens de la casa y nada más: ok = success, warn = warning con el texto en
 * `--warning-text` (el `--warning` pelado no llega a AA sobre la card en
 * claro), over = destructive. Nada de rose/amber/emerald de la paleta cruda,
 * que no respetan el tema oscuro ni la marca.
 */
export const SEGMENT_TONE_CLASSES: Record<
  SegmentTone,
  { chip: string; text: string; dot: string; bar: string }
> = {
  none: {
    chip: 'border-border/60 bg-card',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/40',
    bar: 'bg-muted-foreground/50',
  },
  ok: {
    chip: 'border-border/70 bg-card',
    text: 'text-foreground',
    dot: 'bg-success',
    bar: 'bg-success',
  },
  warn: {
    chip: 'border-warning/50 bg-warning/10',
    text: 'text-warning-text',
    dot: 'bg-warning',
    bar: 'bg-warning',
  },
  over: {
    chip: 'border-destructive/50 bg-destructive/10',
    text: 'text-destructive',
    dot: 'bg-destructive',
    bar: 'bg-destructive',
  },
}

const CHIP_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] leading-4 tabular-nums'

// Solo el chip que hace algo: área táctil de 24 px (WCAG 2.2, el staff lo usa
// con el dedo en la agenda del celu) y el mismo anillo de foco que el Button.
const CHIP_INTERACTIVE =
  'min-h-6 cursor-pointer outline-none transition-colors hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50'

/**
 * El número del servicio como pastilla: "Cena 119/120" (personas de cupo,
 * nunca lo ocupado), con "!" si las normales pisaron lo apartado por un evento
 * ("Cena 58/120!"). Es `<button>` si recibe `onClick`, link si recibe `href`
 * y un `<span>` si no hace nada, así se puede meter adentro de otro botón (la
 * franja de servicios del alta) sin anidar interactivos.
 */
export function SegmentChip({
  segment,
  label = 'short',
  emphasized = false,
  onClick,
  href,
  ariaLabel,
  className,
}: {
  segment: SegmentLoad
  label?: 'letter' | 'short' | 'long'
  /** El servicio en foco (el del reloj en el operativo): se destaca sin cambiar el tono. */
  emphasized?: boolean
  onClick?: () => void
  href?: string
  ariaLabel?: string
  className?: string
}) {
  const tone = SEGMENT_TONE_CLASSES[segmentTone(segment)]
  const headline = segmentHeadline(segment, label)
  // Rojo con pocas personas ("Cena 58/120"): el mismo "!" que la celda del mes
  // avisa a la vista que el número no cuenta todo. Decorativo: la causa la lee
  // el lector de pantalla en el aria-label (botón, link) o en el texto oculto
  // del span.
  const mark = segmentAlertMark(segment)
  const text = (
    <>
      {headline}
      {mark ? <span aria-hidden>{mark}</span> : null}
    </>
  )
  // El color nunca es la única señal: la causa ("te pasaste por 13", "los
  // eventos tienen apartados 120") va completa para el lector de pantalla y en
  // el `title` para el mouse (no hay TooltipProvider global).
  const fullLabel = ariaLabel ?? segmentAriaLabel(segment, '')
  const classes = cn(
    CHIP_BASE,
    tone.chip,
    tone.text,
    emphasized && 'font-semibold ring-1 ring-primary/40',
    (onClick || href) && CHIP_INTERACTIVE,
    className,
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={fullLabel}
        title={fullLabel}
        className={classes}
      >
        {text}
      </button>
    )
  }
  if (href) {
    return (
      <Link href={href} aria-label={fullLabel} title={fullLabel} className={classes}>
        {text}
      </Link>
    )
  }
  // Un <span> no admite aria-label (rol genérico, ARIA 1.2): el texto visible
  // ya es su nombre y la explicación completa queda en el title, que en el
  // celu no se lee y el lector de pantalla no anuncia. Por eso, cuando va el
  // "!", la causa también va como texto oculto (el chip del salón es un span).
  return (
    <span title={fullLabel} className={classes}>
      {text}
      {mark ? <span className="sr-only">{`. ${segmentStatusLine(segment)}`}</span> : null}
    </span>
  )
}

/** Color que usan los chips de evento del mes cuando el formato no trae el suyo. */
const EVENT_FALLBACK_COLOR = '#7c3aed'

/**
 * El color del formato viene de la DB y va a parar a un `style` (y adentro de
 * un gradiente). Solo se acepta un hex: cualquier otra cosa podría colar
 * declaraciones CSS en el HTML del server, y además ensucia la barra.
 */
function eventColor(colorHex: string | null | undefined): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : EVENT_FALLBACK_COLOR
}

type BarPart = {
  key: 'event' | 'event-reserved' | 'normal' | 'free'
  value: number
  className?: string
  style?: CSSProperties
}

/**
 * La barra del servicio, en tramos proporcionales:
 *
 * 1. Lo que el evento ya vendió, con el color del formato (como el dueño lo
 *    reconoce en el calendario).
 * 2. Lo que el evento apartó y todavía está vacío, del mismo color pero
 *    rayado: ocupa lugar para el semáforo (esas mesas no se venden como
 *    normales), pero todavía no es gente.
 * 3. Las reservas normales, con el tono del estado.
 * 4. Lo libre.
 *
 * La pista es max(cupo, ocupado, 1): si el servicio se pasó, la barra se llena
 * con lo ocupado y el rojo de las normales muestra el exceso. Sin tope no hay
 * tramo libre (no hay contra qué medir). Cada tramo crece en proporción a su
 * número (flex-grow con base 0), así los tramos suman exacto la pista sin
 * redondear porcentajes. Decorativa: el número y la causa van en el chip.
 */
export function SegmentBar({
  segment: s,
  size = 'xs',
  className,
}: {
  segment: SegmentLoad
  size?: 'xs' | 'sm'
  className?: string
}) {
  const color = eventColor(s.events[0]?.colorHex)
  const reservedEmpty = Math.max(0, s.eventSeats - s.eventUsed)
  const free = s.capacity === null ? 0 : Math.max(0, s.capacity - s.occupied)

  const parts: BarPart[] = [
    { key: 'event', value: s.eventUsed, style: { backgroundColor: color, opacity: 0.7 } },
    {
      key: 'event-reserved',
      value: reservedEmpty,
      style: {
        backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 4px)`,
        opacity: 0.7,
      },
    },
    { key: 'normal', value: s.normalUsed, className: SEGMENT_TONE_CLASSES[segmentTone(s)].bar },
    { key: 'free', value: free, className: 'bg-secondary' },
  ]

  return (
    <div
      aria-hidden
      className={cn(
        // El fondo de la pista cubre el servicio vacío o cerrado (sin tramos).
        'flex w-full overflow-hidden rounded-full bg-secondary',
        size === 'xs' ? 'h-[3px]' : 'h-1.5',
        className,
      )}
    >
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            data-part={p.key}
            className={cn('h-full min-w-0 basis-0', p.className)}
            style={{ ...p.style, flexGrow: p.value }}
          />
        ))}
    </div>
  )
}

/** El semáforo reducido a un punto, para listas chicas. Siempre acompañado del número. */
export function SegmentStatusDot({ tone, className }: { tone: SegmentTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        SEGMENT_TONE_CLASSES[tone].dot,
        className,
      )}
    />
  )
}

/**
 * El número de una PLANTA en un servicio, para el calendario filtrado por
 * planta: "Cena 46/60" (personas de Planta Alta contra el cupo de la planta).
 * Mismo aspecto y mismos tonos que `SegmentChip` para que se lea igual; sin el
 * «!» porque una planta no tiene lugares apartados por eventos. Botón con
 * `onClick`, `<span>` si no hace nada.
 */
export function ZoneChip({
  load,
  label = 'short',
  onClick,
  ariaLabel,
  className,
}: {
  load: ZoneLoad
  label?: 'letter' | 'short' | 'long'
  onClick?: () => void
  ariaLabel?: string
  className?: string
}) {
  const tone = SEGMENT_TONE_CLASSES[zoneTone(load)]
  const fullLabel = ariaLabel ?? zoneAriaLabel(load, '')
  const classes = cn(CHIP_BASE, tone.chip, tone.text, onClick && CHIP_INTERACTIVE, className)
  const headline = zoneHeadline(load, label)

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={fullLabel}
        title={fullLabel}
        className={classes}
      >
        {headline}
      </button>
    )
  }
  // Como en SegmentChip: el texto visible es el nombre del span y el detalle
  // va en el title (el rojo lo explica la línea de estado de al lado).
  return (
    <span title={fullLabel} className={classes}>
      {headline}
    </span>
  )
}

/**
 * La barra de una planta: personas contra el cupo de la planta, con el tono
 * del estado, y lo libre. Más simple que `SegmentBar` a propósito: la planta
 * no tiene lugares apartados por eventos. La pista es max(cupo, personas, 1):
 * pasada, se llena de rojo. Sin tope (zona flotante o planta sin cupo) la
 * barra se llena con el tono neutro: hay gente pero nada contra qué medirla.
 * Decorativa: el número y la causa van en el chip.
 */
export function ZoneBar({
  load,
  size = 'xs',
  className,
}: {
  load: ZoneLoad
  size?: 'xs' | 'sm'
  className?: string
}) {
  const free = load.capacity === null ? 0 : Math.max(0, load.capacity - load.people)
  const parts = [
    { key: 'people', value: load.people, className: SEGMENT_TONE_CLASSES[zoneTone(load)].bar },
    { key: 'free', value: free, className: 'bg-secondary' },
  ]
  return (
    <div
      aria-hidden
      className={cn(
        'flex w-full overflow-hidden rounded-full bg-secondary',
        size === 'xs' ? 'h-[3px]' : 'h-1.5',
        className,
      )}
    >
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            data-part={p.key}
            className={cn('h-full min-w-0 basis-0', p.className)}
            style={{ flexGrow: p.value }}
          />
        ))}
    </div>
  )
}
