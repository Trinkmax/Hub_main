'use client'

import { ArrowUpRight, CalendarPlus, Pencil, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import {
  SEGMENT_TONE_CLASSES,
  SegmentBar,
  SegmentChip,
  ZoneBar,
  ZoneChip,
} from '@/components/reservations/segment-meter'
import { StatusPill } from '@/components/reservations/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { editEventHref, editReservationHref, newReservationHref } from '@/lib/salon/calendar-links'
import { timeRangeLabel } from '@/lib/salon/format'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import {
  type IsoDow,
  NO_ZONE_CAPS,
  type SegmentEventLoad,
  type SegmentLoad,
  type ZoneCaps,
  zoneLoad,
} from '@/lib/salon/segments'
import {
  capSourceLabel,
  eventZoneLine,
  SEGMENT_LABELS,
  SEGMENT_WITH_ARTICLE,
  segmentAriaLabel,
  segmentEventNote,
  segmentStatusLine,
  segmentTone,
  ZONE_PLACE_LABELS,
  zoneAriaLabel,
  zoneSectionCopy,
} from '@/lib/salon/segments-copy'
import type { ReservationWithJoins, SalonZone } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Un servicio (almuerzo, merienda o cena) dentro de la vista del día.
 *
 * Se dibuja SIEMPRE, también vacío: el pedido del dueño es "ver cómo viene el
 * día antes de cargar", y un servicio sin reservas es justamente el lugar donde
 * hay que poder tocar "Nueva reserva en la merienda · 15:30". Con la agrupación
 * vieja (groupByService) un servicio vacío no existía y el 'hub_event' legacy
 * salía como una cuarta sección.
 *
 * Ningún número se calcula acá: todo sale de `SegmentLoad` (segments.ts) y los
 * textos de `segments-copy.ts`, así la cena dice lo mismo que en el mes, el
 * form y el operativo.
 *
 * Con `zone` (el filtro de planta del calendario) el encabezado mide la planta
 * contra su cupo («Cena · Planta Alta · 46 de 60»), las filas son solo las de
 * esa zona y cada evento dice cuántos de los suyos van ahí. Lo que es del
 * servicio entero (el aviso de que un evento se lleva todo, «Subir a N», de
 * dónde sale el cupo) se esconde: queda una línea chica con el servicio entero
 * («Toda la cena: 119/120») para no vender lugares que el servicio no tiene.
 * Si el servicio recorta la planta (cerrado, o con menos cupo que ella), el
 * servicio manda: ver `zoneSectionCopy`.
 */
export function DaySegmentSection({
  tenantSlug,
  date,
  dayLabel,
  isoDow,
  segment: s,
  defaultTime,
  reservations,
  canBook,
  canRaise,
  isToday,
  suggestedRaise,
  zone = null,
  zoneCaps = NO_ZONE_CAPS,
  raising,
  focusReservationId,
  openReservationId,
  onOpenReservation,
  onRaise,
}: {
  tenantSlug: string
  /** yyyy-MM-dd del día abierto. */
  date: string
  /** 'jue 10/09', para el título completo del chip. */
  dayLabel: string
  isoDow: IsoDow
  segment: SegmentLoad
  /** Hora sugerida del servicio ('21:00'), la misma que precarga el alta. */
  defaultTime: string
  /** Filas de este servicio, en orden de hora. Incluye canceladas y "no vino" (atenuadas). */
  reservations: ReservationWithJoins[]
  /** Reservar y editar eventos (RESERVATION_STAFF_ROLES). */
  canBook: boolean
  /** "Subir a N": solo el dueño cambia cupos, y solo de hoy en adelante. */
  canRaise: boolean
  /** El botón dice «hoy» solo si el día abierto es hoy; si no, nombra el día. */
  isToday: boolean
  suggestedRaise: number | null
  /** Planta del filtro del calendario; null = «Todo» (el servicio entero). */
  zone?: SalonZone | null
  /** Cupo de cada planta (el denominador cuando hay `zone`). */
  zoneCaps?: ZoneCaps
  raising: boolean
  focusReservationId: string | null
  /**
   * Vista rápida abierta. El estado vive en la vista del día y no en cada
   * fila: cambiar la hora de 13:00 a 21:00 pasa la reserva del almuerzo a la
   * cena, o sea a OTRA lista; con el estado en la fila, React desmontaba el
   * popup y lo volvía a montar cerrado.
   */
  openReservationId: string | null
  onOpenReservation: (id: string | null) => void
  onRaise: (capacity: number) => void
}) {
  const key = s.key
  const headingId = `dia-seg-${key}-titulo`
  const zl = zone ? zoneLoad(s, zone, zoneCaps) : null
  // Con planta, las líneas salen de zoneSectionCopy: un servicio cerrado o con
  // menos cupo que la planta no puede decir «Quedan 60 lugares en Planta Alta».
  const zc = zl ? zoneSectionCopy(s, zl) : null
  const tone = zc ? zc.tone : segmentTone(s)
  const statusLine = zc ? zc.status : segmentStatusLine(s)
  // Lo del servicio entero no se mezcla con la planta: ver el comentario de arriba.
  const eventNote = zl ? null : segmentEventNote(s)
  const [onlyEvent] = s.events
  // El título del chip lleva también de dónde sale el cupo: en un bar sin
  // config dice "Cupo general del salón", que explica por qué la cena es 130.
  const chipLabel = `${segmentAriaLabel(s, dayLabel)} ${capSourceLabel(s, isoDow)}.`
  // Solo el especial se muestra aparte (feriado, terraza): el semanal es lo
  // esperado y "sin tope" ya lo dice la línea de estado. Con planta, solo si
  // el servicio la recorta: es el porqué del «Cerrado» (evento privado).
  const sourceLine =
    s.capSource === 'override' && (!zc || zc.serviceLimits) ? capSourceLabel(s, isoDow) : null
  const showRaise =
    !zl && canRaise && s.cause === 'warn_threshold' && suggestedRaise !== null && suggestedRaise > 0
  const eventNames = new Map(s.events.map((e) => [e.id, e.name]))
  // Con planta: solo las filas de esa zona (canceladas incluidas, atenuadas
  // como siempre). «Sin ubicar» son las de evento que todavía no tienen planta.
  // La que tiene la vista rápida abierta se queda aunque ya no sea de la
  // planta: cambiarle la zona desde el popup la sacaba de la lista, el popup
  // (montado en la fila) desaparecía de golpe y, como nadie avisaba el cierre,
  // «Ver todo» lo volvía a abrir solo. Así se ve adónde pasó y, al cerrar el
  // popup, la fila se va.
  const rows = zone
    ? reservations.filter((r) => r.zone === zone || r.id === openReservationId)
    : reservations
  const listLabel = zone
    ? `Reservas de ${SEGMENT_WITH_ARTICLE[key]} · ${ZONE_PLACE_LABELS[zone]}`
    : `Reservas de ${SEGMENT_WITH_ARTICLE[key]}`

  return (
    <section
      id={`dia-seg-${key}`}
      aria-labelledby={headingId}
      className="flex flex-col gap-3 px-4 py-4 sm:px-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="flex items-baseline gap-2 type-subtitle">
          {SEGMENT_LABELS[key]}
          <span className="type-caption font-normal tabular-nums text-muted-foreground">
            {defaultTime}
          </span>
        </h3>
        {/* Un servicio sin nada no lleva chip ni barra: "0 de 120" no dice más
            que "Libre · 120 lugares" y ensucia el día vacío. Con planta, lo
            mismo para la planta. */}
        {zl ? (
          zl.hasActivity ? (
            <ZoneChip load={zl} label="long" ariaLabel={zoneAriaLabel(zl, dayLabel)} />
          ) : null
        ) : s.hasActivity ? (
          <SegmentChip segment={s} label="long" ariaLabel={chipLabel} />
        ) : null}
      </header>

      {zl ? (
        zl.hasActivity ? (
          <ZoneBar load={zl} size="sm" />
        ) : null
      ) : s.hasActivity ? (
        <SegmentBar segment={s} size="sm" />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* El title repite de dónde sale el cupo también en un servicio vacío
            (sin chip): "Cupo general del salón" en un bar sin config. */}
        <p
          className={cn('type-body', SEGMENT_TONE_CLASSES[tone].text)}
          title={zl ? undefined : capSourceLabel(s, isoDow)}
        >
          {statusLine}
        </p>
        {zc?.whole ? (
          // El servicio entero, en chico y con su propio tono: Planta Alta
          // puede tener lugar con la cena ya llena.
          <p
            className={cn('type-caption', SEGMENT_TONE_CLASSES[segmentTone(s)].text)}
            title={segmentAriaLabel(s, dayLabel)}
          >
            {zc.whole}
          </p>
        ) : null}
        {showRaise && suggestedRaise !== null ? (
          // El aviso propio del servicio (almuerzo lun-vie en 50: "conviene
          // abrir la terraza") se resuelve con un toque: crea el cupo especial
          // de este día con el cupo más alto de la semana, y se puede deshacer.
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onRaise(suggestedRaise)}
            loading={raising}
          >
            <ArrowUpRight aria-hidden />
            {/* El cupo especial es de ESTE día: "hoy" en el jue 25/09 visto
                el 21/09 prometía otra fecha que la que se guarda. */}
            Subir a {suggestedRaise} {isToday ? 'hoy' : `el ${dayLabel}`}
          </Button>
        ) : null}
      </div>

      {eventNote ? (
        // Informativo, no rojo: Pizza libre de 140 en una cena de 120 no es un
        // error de hoy. Tampoco hay botón de "bajar el cupo": ese número es
        // también el umbral del bonus de evento lleno y cambiarlo mueve plata.
        <Callout tone="info" role="note">
          {eventNote}
          {canBook && s.events.length === 1 && onlyEvent ? (
            <>
              {' · '}
              <Link
                href={editEventHref(tenantSlug, onlyEvent.id)}
                className="font-medium underline underline-offset-2"
              >
                Editar evento
              </Link>
            </>
          ) : null}
        </Callout>
      ) : null}

      {sourceLine ? <p className="type-caption text-muted-foreground">{sourceLine}</p> : null}

      {s.events.length > 0 ? (
        <ul className="grid gap-2" aria-label={`Eventos de ${SEGMENT_WITH_ARTICLE[key]}`}>
          {s.events.map((e) => (
            <li key={e.id}>
              <EventCard
                tenantSlug={tenantSlug}
                date={date}
                event={e}
                canBook={canBook}
                zoneLine={zone ? eventZoneLine(e, zone) : null}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <ul className="grid gap-2" aria-label={listLabel}>
          {rows.map((r) => (
            <li key={r.id} id={`dia-res-${r.id}`}>
              {/* Sin onChanged: cada action de la vista rápida revalida el
                  calendario y Next trae la página re-renderizada en la misma
                  respuesta, con el día y el mes nuevos. Releer acá era pedir
                  todo dos veces más. */}
              <ReservationQuickView
                tenantSlug={tenantSlug}
                reservation={r}
                // "Edición completa" vuelve al calendario al guardar, no a la lista.
                fullEditHref={editReservationHref(tenantSlug, r.id, { from: 'calendario' })}
                open={openReservationId === r.id}
                onOpenChange={(open) => onOpenReservation(open ? r.id : null)}
                trigger={reservationRow(
                  r,
                  // El nombre del evento como lo muestra el día (con el nombre
                  // propio de esa fecha); si no vino, el del join.
                  placeLabel(
                    r,
                    (r.scheduled_event_id ? eventNames.get(r.scheduled_event_id) : null) ??
                      joinedEventName(r),
                  ),
                  r.id === focusReservationId,
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {canBook ? (
        // La hora la precarga el server desde la config del bar: el link lleva
        // solo el servicio (una sola fuente para "a qué hora se reserva"). Con
        // ?volver=calendario, al guardar se vuelve a este día.
        <Button asChild variant="secondary" size="sm" className="max-w-full self-start">
          <Link href={newReservationHref(tenantSlug, { date, segment: key, from: 'calendario' })}>
            <CalendarPlus aria-hidden />
            <span className="truncate">
              Nueva reserva en {SEGMENT_WITH_ARTICLE[key]} · {defaultTime}
            </span>
          </Link>
        </Button>
      ) : null}
    </section>
  )
}

/** Solo hex: el color viene de la DB y va a un `style`. */
function safeColor(colorHex: string | null): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : 'var(--muted-foreground)'
}

/** "adentro: 1 cumple · 1 torta": la torta dentro del evento es la que se pasaba por alto. */
function insideLine(e: SegmentEventLoad): string | null {
  const parts: string[] = []
  if (e.birthdays > 0) parts.push(e.birthdays === 1 ? '1 cumple' : `${e.birthdays} cumples`)
  if (e.cakes > 0) parts.push(e.cakes === 1 ? '1 torta' : `${e.cakes} tortas`)
  return parts.length > 0 ? `adentro: ${parts.join(' · ')}` : null
}

/**
 * Tarjeta de evento del servicio. Tocar el evento es reservar ADENTRO (D2): el
 * alta llega con el evento, la hora y el servicio ya puestos. Editar el evento
 * pasa a ser la acción secundaria (antes el nombre linkeaba al editor).
 */
function EventCard({
  tenantSlug,
  date,
  event: e,
  canBook,
  zoneLine,
}: {
  tenantSlug: string
  date: string
  event: SegmentEventLoad
  canBook: boolean
  /** Con el día filtrado por planta: cuántos de este evento van en esa planta. */
  zoneLine: string | null
}) {
  const color = safeColor(e.colorHex)
  const full = !e.over && e.capacity > 0 && e.used >= e.capacity
  const inside = insideLine(e)

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* El color del formato: es como el dueño reconoce sus eventos en el
            calendario, así que acá tiene que ser la misma pista. */}
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1 truncate type-body font-medium">{e.name}</span>
        <span className="shrink-0 type-caption tabular-nums text-muted-foreground">
          {e.startsAt}
        </span>
        {e.over ? (
          <Badge
            tone="danger"
            icon={TriangleAlert}
            className="tabular-nums"
            title={`Se pasó por ${e.used - e.capacity}`}
          >
            {e.used}/{e.capacity}
            <span className="sr-only">: se pasó por {e.used - e.capacity}</span>
          </Badge>
        ) : full ? (
          <Badge tone="warning" className="tabular-nums" title="Evento lleno">
            {e.used}/{e.capacity}
            <span className="sr-only">: lleno</span>
          </Badge>
        ) : (
          <span
            className="shrink-0 type-caption tabular-nums text-muted-foreground"
            title={`${e.used} de ${e.capacity} lugares`}
          >
            {e.used}/{e.capacity}
          </span>
        )}
      </div>
      {zoneLine ? (
        <p className="ps-4.5 type-caption font-medium text-foreground">{zoneLine}</p>
      ) : null}
      {inside ? <p className="ps-4.5 type-caption text-muted-foreground">{inside}</p> : null}
      {canBook ? (
        <div className="flex flex-wrap items-center gap-2 ps-4.5">
          <Button asChild size="sm" className="max-w-full">
            <Link
              href={newReservationHref(tenantSlug, { date, eventId: e.id, from: 'calendario' })}
            >
              <CalendarPlus aria-hidden />
              <span className="truncate">Reservar en {e.name}</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={editEventHref(tenantSlug, e.id)} aria-label={`Editar evento ${e.name}`}>
              <Pencil aria-hidden />
              Editar evento
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * La fila de siempre del diálogo del día: hora, nombre (+ torta), dónde,
 * personas y estado. Es un `<button>` pelado (no un componente) a propósito:
 * el DialogTrigger de la vista rápida lo clona con `asChild` y le agrega el
 * onClick, el ref y los aria-*; un componente intermedio tendría que
 * reenviarlos a mano.
 */
function reservationRow(r: ReservationWithJoins, where: string, focused: boolean) {
  const inactive = r.status === 'cancelled' || r.status === 'no_show'
  return (
    <button
      type="button"
      aria-current={focused ? 'true' : undefined}
      className={cn(
        'flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left type-body',
        'outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2 active:bg-active',
        inactive && 'opacity-60',
        // La reserva recién cargada (o la que se buscó): el ojo tiene que caer
        // ahí sin leer la lista entera.
        focused && 'border-primary bg-selected',
      )}
    >
      <span className="whitespace-nowrap type-caption tabular-nums text-muted-foreground">
        {timeRangeLabel(r.reservation_time_local, r.reservation_end_time_local)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-medium">{r.guest_name}</span>
        {/* La torta viaja con la fila: es lo que el bar tiene que producir, no
            un detalle del cliente. */}
        {r.cake_count > 0 ? (
          <CakeChip
            count={r.cake_count}
            option={r.cake_option}
            optionId={r.cake_option_id}
            className="self-start"
          />
        ) : null}
      </span>
      <span className="hidden max-w-[40%] truncate type-caption text-muted-foreground sm:inline">
        {where}
      </span>
      <span className="whitespace-nowrap type-caption tabular-nums text-muted-foreground">
        {r.actual_guests ?? r.estimated_guests}
        <span className="sr-only">
          {(r.actual_guests ?? r.estimated_guests) === 1 ? ' persona' : ' personas'}
        </span>
        <span aria-hidden>p</span>
      </span>
      <StatusPill status={r.status} />
    </button>
  )
}
