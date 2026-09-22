'use client'

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  Cake,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Info,
  Loader2,
  PartyPopper,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  type CSSProperties,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { moveScheduledEvent } from '@/lib/salon/actions'
import { calendarHref, hrefWithoutZone, newReservationHref } from '@/lib/salon/calendar-links'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { DayOverview } from '@/lib/salon/segment-queries'
import { calendarParamsSchema } from '@/lib/salon/segment-schemas'
import {
  type DaySegments,
  dayCelebrations,
  dayHasZoneActivity,
  eventDisplayName,
  eventLoadsById,
  type MonthSegments,
  SEGMENT_KEYS,
  type SegmentEventLoad,
  type SegmentKey,
  segmentOfEventStart,
  type ZoneCaps,
  type ZoneFilter,
  zoneOfFilter,
} from '@/lib/salon/segments'
import { calendarLegend, capSourceLabel, SEGMENT_LABELS } from '@/lib/salon/segments-copy'
import type { SalonZone, ScheduledEventTemplateRow } from '@/lib/salon/types'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { DayAddMenu } from './day-add-menu'
import { DayView } from './day-view'
import { MonthDaySegments } from './month-day-segments'
import { TemplateDropDialog } from './template-drop-dialog'
import { ZoneFilterControl } from './zone-filter-control'

function shiftYM(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1, 1))
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Prefijos de ID para distinguir qué clase de cosa se está arrastrando/dropeando.
const TMPL_PREFIX = 'tmpl:'
const EVENT_PREFIX = 'event:'
const DAY_PREFIX = 'day:'

type ActiveDrag =
  | { kind: 'template'; template: ScheduledEventTemplateRow }
  | { kind: 'event'; event: ScheduledEventWithTemplate }
  | null

/** Abre la vista del día; `segment` la ancla en ese servicio. */
type OpenDay = (date: string, segment?: SegmentKey) => void

/**
 * ¿La URL del navegador ya tiene un día (válido) abierto? Lee window.location
 * y no useSearchParams: el pushState de un primer toque ya la cambió aunque
 * React todavía no haya vuelto a renderizar.
 */
function urlHasOpenDay(): boolean {
  const day = new URLSearchParams(window.location.search).get('day') ?? undefined
  return calendarParamsSchema.shape.day.parse(day) !== undefined
}

export function ScheduledEventsMonth({
  tenantSlug,
  ym,
  events: initialEvents,
  templates,
  monthSegments,
  today,
  role,
  initialOverview,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  /** Personas por servicio contra su cupo, día por día (mismo cálculo que la vista del día). */
  monthSegments: MonthSegments
  /** Fecha de hoy (yyyy-MM-dd, TZ del local) para marcar el día actual. */
  today: string
  role: TenantRole
  /** El día de ?day precargado por la página: al volver de guardar no hay flash de carga. */
  initialOverview: DayOverview | null
}) {
  const router = useRouter()
  const [events, setEvents] = useState(initialEvents)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null)
  const [moving, startMoving] = useTransition()

  // Estado del dialog cuando se suelta un template
  const [dropDialog, setDropDialog] = useState<{
    template: ScheduledEventTemplateRow
    date: string
  } | null>(null)

  // Si el RSC re-renderea con nuevos events (cambio de mes), reseteamos.
  // useState ya respeta el initialValue de arranque; pero al navegar mes la
  // page se re-monta — entonces este componente recibe nuevos initialEvents.
  // Para asegurar consistencia ante un router.refresh:
  useMemo(() => setEvents(initialEvents), [initialEvents])

  // Carga de cada evento por id (personas anotadas contra su cupo), sacada del
  // mismo cálculo por servicio que pinta las celdas.
  const eventLoad = useMemo(() => eventLoadsById(monthSegments.days), [monthSegments])

  // ── Día abierto en la URL (?day, ?seg, ?res) y filtro de planta (?planta) ──
  // La URL es la fuente de verdad: el deep-link /eventos/programados?day=… abre
  // el día, ?day=hoy abre hoy (un link fijo) y el Atrás del celu lo cierra. Next
  // 16 sincroniza window.history.pushState/replaceState con useSearchParams
  // (docs 01-app/01-getting-started/04-linking-and-navigating.md, "Native
  // History API"), así que abrir y cerrar no pide nada al server.
  const searchParams = useSearchParams()
  const { openDay, anchorSegment, focusId, zoneFilter } = useMemo(() => {
    // Cada campo trae .catch(undefined): un ?day, ?res o ?planta roto se ignora.
    const p = calendarParamsSchema.parse({
      day: searchParams.get('day') ?? undefined,
      seg: searchParams.get('seg') ?? undefined,
      res: searchParams.get('res') ?? undefined,
      planta: searchParams.get('planta') ?? undefined,
    })
    return {
      openDay: p.day === 'hoy' ? today : (p.day ?? null),
      anchorSegment: p.seg ?? null,
      focusId: p.res ?? null,
      zoneFilter: p.planta ?? null,
    }
  }, [searchParams, today])
  // La zona que filtra el mes y el día (null = «Todo»). El filtro es solo de
  // vista: el mes ya trae todas las zonas y acá se elige cuál mostrar, sin
  // pedir nada al server.
  const zone: SalonZone | null = zoneFilter ? zoneOfFilter(zoneFilter) : null
  const zoneParam = zoneFilter ?? undefined

  // ¿La entrada anterior del historial es este mismo mes sin día abierto? Si
  // sí, cerrar = history.back() (el Atrás del celu y la X hacen lo mismo y el
  // historial no acumula el día). Vale cuando el día APARECE con el mes ya
  // montado y sin cambiar de mes: lo abrimos acá (pushState), desde el
  // buscador, ⌘K o el Adelante del navegador. Un día que ya venía en la URL al
  // montar (deep-link, volver de guardar una reserva) se cierra reemplazando la
  // URL: un back ahí sacaría al usuario del calendario.
  const pushedRef = useRef(false)
  const closingRef = useRef(false)
  // «Ver todo» con un día abierto desde el mes: la entrada de abajo es el mes
  // CON ?planta. Al volver a ella (la X hace back(), o el Atrás del celu), el
  // popstate le saca el filtro. Ver `clearZoneFromDay`.
  const dropZoneOnPopRef = useRef(false)
  const lastUrlRef = useRef<{ day: string | null; ym: string }>({ day: openDay, ym })
  useEffect(() => {
    const last = lastUrlRef.current
    lastUrlRef.current = { day: openDay, ym }
    if (openDay === null) {
      pushedRef.current = false
      closingRef.current = false
      dropZoneOnPopRef.current = false
      return
    }
    if (last.day === null) pushedRef.current = last.ym === ym
  }, [openDay, ym])

  // Todo Atrás/Adelante (incluido el back() de closeDay) termina el cierre en
  // curso. Si la entrada a la que se llegó TODAVÍA tiene un día (⌘K abrió hoy
  // encima del día abierto, o un doble toque dejó dos entradas iguales), un
  // back() más no garantiza volver al mes: el próximo cierre reemplaza la URL.
  // Sin esto closingRef quedaba en true y la X, Esc y el overlay no cerraban.
  // Si el Adelante abre un día desde el mes, el efecto de arriba corre después
  // y vuelve a poner pushedRef en true: ahí back() sí es lo correcto.
  useEffect(() => {
    function onPopState() {
      closingRef.current = false
      if (urlHasOpenDay()) {
        pushedRef.current = false
        return
      }
      // Se llegó al mes que quedó debajo del día después de «Ver todo»: se le
      // saca ?planta reemplazando la entrada (sin sumar otra), así el mes
      // queda sin filtro como pidió el dueño y el Atrás siguiente no vuelve
      // al mes filtrado.
      if (dropZoneOnPopRef.current) {
        dropZoneOnPopRef.current = false
        const href = hrefWithoutZone(window.location.href)
        if (href) window.history.replaceState(null, '', href)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openDayAt = useCallback<OpenDay>(
    (date, segment) => {
      // El filtro de planta viaja: el día abre mostrando la misma planta.
      const href = calendarHref(tenantSlug, { month: ym, zone: zoneParam, day: date, segment })
      // Un segundo toque antes de que el día termine de abrir no suma otra
      // entrada: con dos entradas iguales, cerrar volvía al mismo día.
      if (urlHasOpenDay()) window.history.replaceState(null, '', href)
      else window.history.pushState(null, '', href)
    },
    [tenantSlug, ym, zoneParam],
  )

  const closeDay = useCallback(() => {
    // Escape + click afuera en el mismo tick: dos back() sacarían del calendario.
    if (closingRef.current) return
    if (pushedRef.current) {
      closingRef.current = true
      window.history.back()
      return
    }
    window.history.replaceState(null, '', calendarHref(tenantSlug, { month: ym, zone: zoneParam }))
  }, [tenantSlug, ym, zoneParam])

  // Recorrer días con las flechas no agrega entradas: Atrás sigue cerrando.
  // ?seg y ?res eran del día que se abrió: no viajan al siguiente.
  const changeDay = useCallback(
    (date: string) => {
      window.history.replaceState(
        null,
        '',
        calendarHref(tenantSlug, { month: ym, zone: zoneParam, day: date }),
      )
    },
    [tenantSlug, ym, zoneParam],
  )

  // Cambiar el filtro de planta REEMPLAZA la URL: no ensucia el historial (el
  // Atrás no recorre filtros) y conserva el mes y el día abierto con su ancla.
  const changeZone = useCallback(
    (next: ZoneFilter | null) => {
      window.history.replaceState(
        null,
        '',
        calendarHref(tenantSlug, {
          month: ym,
          zone: next ?? undefined,
          day: openDay ?? undefined,
          segment: anchorSegment ?? undefined,
          focusId: focusId ?? undefined,
        }),
      )
    },
    [tenantSlug, ym, openDay, anchorSegment, focusId],
  )

  // «Ver todo» desde el día abierto. Si el día se abrió desde el mes, la
  // entrada de abajo es el mes TODAVÍA filtrado (tiene ?planta). Cerrar sigue
  // siendo history.back() —la X y el Atrás del celu hacen lo mismo y el
  // historial no acumula el día— y el popstate le saca el filtro a esa
  // entrada al llegar. Antes se apagaba pushedRef: la X reemplazaba la URL y
  // el mes filtrado quedaba debajo, y el Atrás del celu volvía directo a él.
  const clearZoneFromDay = useCallback(() => {
    if (pushedRef.current) dropZoneOnPopRef.current = true
    changeZone(null)
  }, [changeZone])

  const sensors = useSensors(
    // Distancia mínima evita que un click normal sobre el evento se interprete
    // como drag — el operador debe arrastrar al menos 6px.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch: presionar 200ms antes de empezar a arrastrar, deja scrollear.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    if (id.startsWith(TMPL_PREFIX)) {
      const tplId = id.slice(TMPL_PREFIX.length)
      const tpl = templates.find((t) => t.id === tplId) ?? null
      if (tpl) setActiveDrag({ kind: 'template', template: tpl })
    } else if (id.startsWith(EVENT_PREFIX)) {
      const evId = id.slice(EVENT_PREFIX.length)
      const ev = events.find((x) => x.id === evId) ?? null
      if (ev) setActiveDrag({ kind: 'event', event: ev })
    }
  }

  const refreshEventList = useCallback(() => {
    router.refresh()
  }, [router])

  function handleDragEnd(e: DragEndEvent) {
    const dragged = activeDrag
    setActiveDrag(null)
    if (!dragged || !e.over) return

    const overId = String(e.over.id)
    if (!overId.startsWith(DAY_PREFIX)) return
    const targetDate = overId.slice(DAY_PREFIX.length)

    if (dragged.kind === 'template') {
      setDropDialog({ template: dragged.template, date: targetDate })
      return
    }

    // Mover evento existente
    const ev = dragged.event
    if (ev.event_date === targetDate) return // mismo día — no-op

    // Optimistic update
    const prevEvents = events
    setEvents((cur) => cur.map((x) => (x.id === ev.id ? { ...x, event_date: targetDate } : x)))

    startMoving(async () => {
      const result = await moveScheduledEvent(tenantSlug, {
        id: ev.id,
        event_date: targetDate,
      })
      if (result.ok) {
        toast.success(`Evento movido al ${formatShortDate(targetDate)}`)
        refreshEventList()
      } else {
        setEvents(prevEvents) // revert
        toast.error(result.message)
      }
    })
  }

  const grid = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    if (!y || !m) return []
    const firstDay = new Date(Date.UTC(y, m - 1, 1))
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const firstDow = (firstDay.getUTCDay() + 6) % 7
    const cells: Array<{ date: string | null; events: ScheduledEventWithTemplate[] }> = []
    for (let i = 0; i < firstDow; i++) cells.push({ date: null, events: [] })
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${ym}-${String(d).padStart(2, '0')}`
      const dayEvents = events.filter((e) => e.event_date === dateStr)
      cells.push({ date: dateStr, events: dayEvents })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, events: [] })
    return cells
  }, [ym, events])

  function gotoMonth(next: string) {
    router.push(calendarHref(tenantSlug, { month: next, zone: zoneParam }))
  }

  return (
    <>
      <DndContext
        id="eventos-mes"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {role === 'owner' && !monthSegments.configured ? (
          <UnconfiguredBanner tenantSlug={tenantSlug} fallbackTotal={monthSegments.fallbackTotal} />
        ) : null}

        {/* Tira de templates draggables. Sin formatos no hay nada que arrastrar
            (el aviso "Creá tus formatos" va arriba, en las pestañas). */}
        {templates.length > 0 ? (
          <TemplateRail templates={templates} tenantSlug={tenantSlug} />
        ) : null}

        <div className="card-hairline rounded-2xl border bg-card p-3 sm:p-5">
          <header className="mb-3 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mes anterior"
              onClick={() => gotoMonth(shiftYM(ym, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex items-center gap-2.5">
              <h2 className="font-serif text-xl font-semibold capitalize">{formatYM(ym)}</h2>
              {ym !== today.slice(0, 7) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => gotoMonth(today.slice(0, 7))}
                >
                  Hoy
                </Button>
              ) : null}
              {moving ? (
                <Loader2
                  className="size-3.5 animate-spin text-muted-foreground"
                  aria-label="Guardando cambios"
                />
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mes siguiente"
              onClick={() => gotoMonth(shiftYM(ym, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </header>

          {/* Filtro de planta: «Todo» es la vista por servicio de siempre. */}
          <div className="mb-2 flex justify-center">
            <ZoneFilterControl value={zoneFilter} onChange={changeZone} />
          </div>

          {/* Leyenda única: explica el número una vez en lugar de en cada celda.
              Con una planta elegida dice que el número es de esa planta. */}
          <p
            data-tour="eventos-leyenda"
            aria-live="polite"
            className="mb-3 text-center text-[11px] text-muted-foreground text-pretty"
          >
            {calendarLegend(zoneFilter, monthSegments.zoneCaps)}
          </p>

          {/* Agenda vertical para mobile: la grilla 7-col deja celdas ilegibles en celular.
              El drag-and-drop queda solo en >=sm. */}
          <div className="space-y-2 sm:hidden">
            <MonthAgenda
              ym={ym}
              events={events}
              tenantSlug={tenantSlug}
              monthSegments={monthSegments}
              eventLoad={eventLoad}
              today={today}
              zone={zone}
              onOpenDay={openDayAt}
            />
          </div>
          <div className="hidden grid-cols-7 gap-1.5 text-xs sm:grid">
            {DOW_LABELS.map((d) => (
              <div
                key={d}
                className="px-1 py-1 text-center uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </div>
            ))}
            {grid.map((cell, idx) => (
              <DayCell
                key={cell.date ?? `pad-${idx}`}
                date={cell.date}
                day={cell.date ? (monthSegments.days[cell.date] ?? null) : null}
                events={cell.events}
                tenantSlug={tenantSlug}
                today={today}
                isWeekend={idx % 7 >= 5}
                isDraggingTemplate={activeDrag?.kind === 'template'}
                isDraggingEvent={activeDrag?.kind === 'event'}
                eventLoad={eventLoad}
                zone={zone}
                zoneCaps={monthSegments.zoneCaps}
                onOpenDay={openDayAt}
              />
            ))}
          </div>
          <p className="mt-3 hidden text-center text-[11px] text-muted-foreground text-pretty sm:block">
            Arrastrá un formato a un día para programarlo o un evento para moverlo. Tocá un evento
            para reservar adentro; tocá un servicio para ver el día.
          </p>
          <p className="mt-3 text-center text-[11px] text-muted-foreground text-pretty sm:hidden">
            Tocá un día o un servicio para ver cómo viene y reservar. Tocá un evento para reservar
            adentro.
          </p>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.kind === 'template' ? <TemplateChip template={activeDrag.template} /> : null}
          {activeDrag?.kind === 'event' ? (
            <EventCardOverlay
              event={activeDrag.event}
              load={eventLoad[activeDrag.event.id] ?? null}
            />
          ) : null}
        </DragOverlay>

        <TemplateDropDialog
          open={dropDialog !== null}
          onOpenChange={(open) => {
            if (!open) setDropDialog(null)
          }}
          tenantSlug={tenantSlug}
          template={dropDialog?.template ?? null}
          date={dropDialog?.date ?? null}
          onCreated={refreshEventList}
        />
      </DndContext>

      <DayView
        tenantSlug={tenantSlug}
        date={openDay}
        today={today}
        role={role}
        anchorSegment={anchorSegment}
        focusReservationId={focusId}
        initialOverview={initialOverview}
        zoneFilter={zoneFilter}
        onClearZone={clearZoneFromDay}
        onDateChange={changeDay}
        onClose={closeDay}
        // Sin onMutated: los cambios del día (vista rápida, pasar lista, cupo
        // especial) revalidan esta ruta y la respuesta de la action ya trae el
        // mes re-renderizado. Un router.refresh encima era otra lectura entera.
      />
    </>
  )
}

// ───────────────────────────────────────────────────────────────
// Subcomponentes
// ───────────────────────────────────────────────────────────────

function formatShortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(dt)
}

function formatAgendaDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

/** 'jueves 10 de septiembre': para los aria-label (la celda solo muestra el número). */
function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

/**
 * Solo para el dueño y solo mientras no cargó cupos por servicio: el mes está
 * midiendo cada servicio contra el cupo general (PA + PB) y no contra el
 * almuerzo de 70 o la cena de 120 que maneja en la cabeza.
 */
function UnconfiguredBanner({
  tenantSlug,
  fallbackTotal,
}: {
  tenantSlug: string
  fallbackTotal: number
}) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-info/40 bg-info/10 px-3 py-2.5 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p className="text-pretty">
        {fallbackTotal > 0
          ? `Estás usando el cupo general del salón (${fallbackTotal} por servicio).`
          : 'Todavía no cargaste cupos: cada servicio muestra personas, sin tope.'}{' '}
        <Link
          href={`/${tenantSlug}/configuracion/salon`}
          className="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Configurá almuerzo, merienda y cena →
        </Link>
      </p>
    </div>
  )
}

/**
 * Marca de "cupo especial" (feriado, terraza abierta) en el encabezado del
 * día, con el motivo en el title. No es interactiva: el detalle está en la
 * vista del día.
 */
function OverrideMark({ day }: { day: DaySegments }) {
  const labels = SEGMENT_KEYS.filter((key) => day.segments[key].capSource === 'override').map(
    (key) => `${SEGMENT_LABELS[key]} · ${capSourceLabel(day.segments[key], day.isoDow)}`,
  )
  if (labels.length === 0) return null
  const text = labels.join('; ')
  return (
    <span role="img" aria-label={text} title={text} className="inline-flex shrink-0">
      <SlidersHorizontal className="size-3 text-muted-foreground" aria-hidden />
    </span>
  )
}

/**
 * ¿El día tiene algo que mostrar? Un servicio con gente o eventos; con el
 * filtro de planta, gente en esa planta (los eventos se ven igual en su chip).
 */
function hasSegmentActivity(day: DaySegments | null, zone: SalonZone | null): boolean {
  if (day === null) return false
  if (zone) return dayHasZoneActivity(day, zone)
  return SEGMENT_KEYS.some((key) => day.segments[key].hasActivity)
}

// Agenda mensual para mobile: todos los días del mes, con sus servicios y
// eventos. Sin drag-and-drop — programar se hace desde el + de cada día.
function MonthAgenda({
  ym,
  events,
  tenantSlug,
  monthSegments,
  eventLoad,
  today,
  zone,
  onOpenDay,
}: {
  ym: string
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  monthSegments: MonthSegments
  eventLoad: Record<string, SegmentEventLoad>
  today: string
  /** Planta del filtro (null = «Todo»). */
  zone: SalonZone | null
  onOpenDay: OpenDay
}) {
  // El hook va ANTES de cualquier early return: si no, React rompe el orden.
  const todayRef = useRef<HTMLDivElement | null>(null)
  // Con el mes entero visible la lista pasó de ~6 filas a 31: abrir el
  // calendario el día 25 te dejaba a tres pantallas de hoy. `block: 'center'`
  // y no 'start' para que se vean los días de alrededor, que es lo que se mira
  // cuando estás decidiendo dónde meter un evento.
  useEffect(() => {
    const el = todayRef.current
    // En desktop este componente sigue montado (lo oculta `sm:hidden`), así que
    // sin la guarda estaríamos scrolleando la página por un elemento invisible.
    // `offsetParent === null` es exactamente "no tiene caja de layout".
    if (!el || el.offsetParent === null) return
    el.scrollIntoView({ block: 'center' })
  }, [])

  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return null
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()

  // TODOS los días del mes, tengan evento o no. Antes se filtraba por
  // `dayEvents.length > 0` y en el celular el mes aparecía con agujeros: no se
  // podía tocar el + de un día vacío para programar, ni ver la ocupación de un
  // día que tenía reservas normales pero ningún evento. En desktop nunca se
  // notó porque la grilla mensual dibuja el mes entero.
  const days: Array<{ date: string; events: ScheduledEventWithTemplate[] }> = []
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${ym}-${String(d).padStart(2, '0')}`
    days.push({ date: dateStr, events: events.filter((e) => e.event_date === dateStr) })
  }

  return (
    <>
      {days.map(({ date, events: dayEvents }) => {
        const day = monthSegments.days[date] ?? null
        const isToday = date === today
        // Un mes son 30 filas: el día sin servicios activos ni eventos va
        // compacto y apagado para que la lista siga siendo recorrible con el pulgar.
        const isEmpty = dayEvents.length === 0 && !hasSegmentActivity(day, zone)
        const celebrations = day ? dayCelebrations(day, zone) : null
        const longLabel = formatLongDate(date)
        return (
          <div
            key={date}
            ref={isToday ? todayRef : undefined}
            className={cn(
              'scroll-mt-4 rounded-lg border',
              isEmpty ? 'bg-card/20 px-2 py-1' : 'bg-card/40 p-2',
              isToday ? 'border-primary/40 ring-1 ring-primary/30' : 'border-border/60',
            )}
          >
            <div className={cn('flex items-center justify-between gap-2', !isEmpty && 'mb-1.5')}>
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenDay(date)}
                  className="-mx-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label={`Ver el día ${longLabel}`}
                >
                  <span
                    className={cn(
                      'capitalize tabular-nums',
                      isEmpty ? 'text-sm text-muted-foreground' : 'text-sm font-semibold',
                    )}
                  >
                    {formatAgendaDate(date)}
                  </span>
                  {isToday ? (
                    <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                      Hoy
                    </span>
                  ) : null}
                  {celebrations ? <CelebrationBadge {...celebrations} /> : null}
                </button>
                {day ? <OverrideMark day={day} /> : null}
              </div>
              <DayAddMenu
                variant="agenda"
                tenantSlug={tenantSlug}
                date={date}
                dayLabel={longLabel}
                onOpenDay={() => onOpenDay(date)}
              />
            </div>
            {isEmpty ? null : (
              <div className="space-y-1.5">
                {day ? (
                  <MonthDaySegments
                    day={day}
                    variant="agenda"
                    dayLabel={longLabel}
                    zone={zone}
                    zoneCaps={monthSegments.zoneCaps}
                    onOpenSegment={(segment) => onOpenDay(date, segment)}
                  />
                ) : null}
                {dayEvents.length > 0 ? (
                  <div className="space-y-1">
                    {dayEvents.map((e) => {
                      const color = e.template?.color_hex ?? '#7c3aed'
                      const load = eventLoad[e.id] ?? null
                      return (
                        <EventTap
                          key={e.id}
                          event={e}
                          load={load}
                          tenantSlug={tenantSlug}
                          today={today}
                          onOpenDay={onOpenDay}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring/50"
                          style={{ backgroundColor: `${color}1f`, color }}
                        >
                          <span className="font-mono text-[11px] tabular-nums opacity-80">
                            {e.starts_at_local.slice(0, 5)}
                          </span>
                          <span className="truncate">{eventDisplayName(e)}</span>
                          <span className="ml-auto shrink-0 text-[10px] opacity-70">
                            <EventLoad load={load} capacity={e.capacity} />
                          </span>
                        </EventTap>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Tocar un evento (D2): si todavía no pasó, lleva al alta de reserva ADENTRO
 * del evento (?date&event: el form ya trae el evento, el servicio y la hora).
 * Si ya pasó, no hay nada que reservar: abre el día anclado en el servicio del
 * evento. Editar el evento quedó como acción secundaria en la vista del día.
 */
function EventTap({
  event,
  load,
  tenantSlug,
  today,
  onOpenDay,
  className,
  style,
  children,
}: {
  event: ScheduledEventWithTemplate
  load: SegmentEventLoad | null
  tenantSlug: string
  today: string
  onOpenDay: OpenDay
  className: string
  style: CSSProperties
  children: ReactNode
}) {
  const name = eventDisplayName(event)
  const time = event.starts_at_local.slice(0, 5)
  const count = `${load?.used ?? 0} de ${event.capacity}`
  // El listener de dnd-kit ya consume el drag con umbral de 6 px; si igual
  // llega un click después de arrastrar, que no suba al contenedor.
  const stop = (e: ReactMouseEvent) => e.stopPropagation()

  if (event.event_date >= today) {
    return (
      <Link
        href={newReservationHref(tenantSlug, {
          date: event.event_date,
          eventId: event.id,
          from: 'calendario',
        })}
        onClick={stop}
        aria-label={`Reservar en ${name}, ${time}, ${count}`}
        className={className}
        style={style}
      >
        {children}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e)
        onOpenDay(event.event_date, segmentOfEventStart(event.starts_at_local))
      }}
      aria-label={`Ver el día de ${name}, ${time}, ${count}`}
      className={className}
      style={style}
    >
      {children}
    </button>
  )
}

function TemplateRail({
  templates,
  tenantSlug,
}: {
  templates: ScheduledEventTemplateRow[]
  tenantSlug: string
}) {
  return (
    <div className="mb-4 rounded-2xl border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        {/* En mobile no hay grilla adonde soltar: el drag-and-drop es solo
            >=sm. Decirle "arrastrá" a alguien que está en el celular es pedirle
            algo que no puede hacer. */}
        <span className="hidden uppercase tracking-wide sm:inline">
          Arrastrá un template al calendario
        </span>
        <span className="uppercase tracking-wide sm:hidden">
          Formatos del bar · programalos con el + de cada día
        </span>
      </div>
      <div
        role="toolbar"
        aria-label="Templates disponibles para programar"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {templates.map((t) => (
          <Fragment key={t.id}>
            {/* Desktop: se arrastra a la grilla. Mobile: la grilla está oculta,
                así que arrastrar no puede funcionar — el gesto arrancaba, el chip
                flotaba y moría en silencio, que es peor que no poder hacerlo.
                Ahí el chip es un link al alta con el formato ya elegido. */}
            <span className="hidden sm:contents">
              <DraggableTemplate template={t} />
            </span>
            <Link
              href={`/${tenantSlug}/eventos/programados/nuevo?template=${t.id}`}
              className="sm:hidden"
            >
              <TemplateChip template={t} />
            </Link>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function DraggableTemplate({ template }: { template: ScheduledEventTemplateRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TMPL_PREFIX}${template.id}`,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`Arrastrar template ${template.name}`}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex shrink-0 cursor-grab items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-shadow active:cursor-grabbing',
        'hover:shadow-md',
        isDragging && 'opacity-30',
      )}
      style={{
        borderColor: `${template.color_hex}55`,
        backgroundColor: `${template.color_hex}10`,
      }}
    >
      <GripVertical
        className="size-3 text-muted-foreground opacity-60 group-hover:opacity-100"
        aria-hidden
      />
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: template.color_hex }}
      />
      <span style={{ color: template.color_hex }}>{template.name}</span>
      {template.default_capacity ? (
        <span className="text-[10px] text-muted-foreground">· {template.default_capacity}</span>
      ) : null}
    </button>
  )
}

function TemplateChip({ template }: { template: ScheduledEventTemplateRow }) {
  return (
    <div
      className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-lg"
      style={{ borderColor: `${template.color_hex}99`, color: template.color_hex }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: template.color_hex }}
      />
      {template.name}
    </div>
  )
}

function EventCardOverlay({
  event,
  load,
}: {
  event: ScheduledEventWithTemplate
  load: SegmentEventLoad | null
}) {
  const color = event.template?.color_hex ?? '#7c3aed'
  return (
    <div
      className="block rounded-md border bg-background px-2 py-1 text-[11px] font-medium leading-snug shadow-lg"
      style={{
        borderColor: `${color}66`,
        backgroundColor: `${color}1f`,
        color,
      }}
    >
      <span className="block truncate">{eventDisplayName(event)}</span>
      <span className="block text-[10px] opacity-70 tabular-nums">
        {event.starts_at_local.slice(0, 5)} · <EventLoad load={load} capacity={event.capacity} />
      </span>
    </div>
  )
}

/**
 * Ocupación del evento: `anotados/cupo`. Sale del mismo cálculo por servicio
 * que la celda (actual ?? estimado, sin canceladas ni "no vino"), así el chip
 * y la vista del día dicen el mismo número.
 */
function EventLoad({ load, capacity }: { load: SegmentEventLoad | null; capacity: number }) {
  const used = load?.used ?? 0
  const over = load?.over ?? false
  const full = !over && capacity > 0 && used >= capacity
  return (
    <span
      className={cn('tabular-nums', (over || full) && 'font-semibold')}
      title={`${used} de ${capacity} lugares reservados`}
    >
      {used}/{capacity}
      {over ? ' ⚠' : null}
    </span>
  )
}

function DayCell({
  date,
  day,
  events,
  tenantSlug,
  today,
  isWeekend,
  isDraggingTemplate,
  isDraggingEvent,
  eventLoad,
  zone,
  zoneCaps,
  onOpenDay,
}: {
  date: string | null
  /** Los servicios del día (null en las celdas de relleno). */
  day: DaySegments | null
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  today: string
  isWeekend: boolean
  isDraggingTemplate: boolean
  isDraggingEvent: boolean
  /** Carga de cada evento, indexada por id. */
  eventLoad: Record<string, SegmentEventLoad>
  /** Planta del filtro (null = «Todo»). */
  zone: SalonZone | null
  zoneCaps: ZoneCaps
  onOpenDay: OpenDay
}) {
  // Las celdas vacías de padding no son droppables.
  const { setNodeRef, isOver } = useDroppable({
    id: date ? `${DAY_PREFIX}${date}` : `pad:${Math.random()}`,
    disabled: !date,
  })

  if (!date) {
    return <div className="min-h-[92px] rounded-lg border border-transparent bg-transparent p-2" />
  }

  const isToday = date === today
  const dragging = isDraggingTemplate || isDraggingEvent
  const hasEvents = events.length > 0
  const busy = hasEvents || hasSegmentActivity(day, zone)
  // Acento de borde-izquierdo con el color del primer evento del día.
  const accent = hasEvents ? (events[0]?.template?.color_hex ?? null) : null
  const longLabel = formatLongDate(date)
  // Cumpleaños y tortas del día: lo que hay que PREPARAR, no lo que hay que
  // sentar. Con el filtro, los de esa planta (los mismos que dice la celda).
  const celebrations = day ? dayCelebrations(day, zone) : null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group relative min-h-[92px] min-w-0 overflow-hidden rounded-lg border p-2 transition-colors',
        // Día con actividad resalta; día vacío queda liviano.
        busy ? 'border-border/70 bg-card/70' : 'border-border/40 bg-transparent',
        isWeekend && !busy && 'bg-cream-tint/40',
        isToday && 'ring-1 ring-primary/40',
        // Resalta destinos válidos al arrastrar
        dragging && !isOver && 'border-dashed border-border/40',
        isOver && 'border-primary/70 bg-primary/10 ring-2 ring-primary/30',
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5"
          style={{ backgroundColor: accent }}
        />
      ) : null}
      <div className="flex h-full flex-col gap-1">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenDay(date)}
              className="-mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Ver el día ${longLabel}`}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums',
                  isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {Number(date.slice(-2))}
              </span>
              {/* El cumple deja de esconderse adentro del evento ya desde el mes:
                  el 21/09 el calendario decía "Pizza libre" y nada más. */}
              {celebrations ? <CelebrationBadge {...celebrations} /> : null}
            </button>
            {day ? <OverrideMark day={day} /> : null}
          </div>
          <DayAddMenu
            variant="cell"
            tenantSlug={tenantSlug}
            date={date}
            dayLabel={longLabel}
            onOpenDay={() => onOpenDay(date)}
          />
        </div>
        {day ? (
          <MonthDaySegments
            day={day}
            variant="cell"
            dayLabel={longLabel}
            zone={zone}
            zoneCaps={zoneCaps}
            onOpenSegment={(segment) => onOpenDay(date, segment)}
          />
        ) : null}
        {hasEvents ? (
          <div className="flex flex-col gap-1">
            {events.map((e) => (
              <DraggableEvent
                key={e.id}
                event={e}
                tenantSlug={tenantSlug}
                today={today}
                load={eventLoad[e.id] ?? null}
                onOpenDay={onOpenDay}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * El aviso de festejo en la celda del día: 🎂 con el número de tortas, o el
 * gorrito si hay cumple sin torta. Chiquito pero destinado a saltar — es lo que
 * hoy no se ve hasta que la gente está en la puerta.
 */
function CelebrationBadge({ birthdays, cakes }: { birthdays: number; cakes: number }) {
  if (birthdays === 0 && cakes === 0) return null
  // Manda la torta: es lo único de un día que hay que EMPEZAR con antelación.
  const label =
    cakes > 0
      ? `${cakes} ${cakes === 1 ? 'torta' : 'tortas'}${birthdays > 0 ? ` · ${birthdays} ${birthdays === 1 ? 'cumple' : 'cumples'}` : ''}`
      : `${birthdays} ${birthdays === 1 ? 'cumpleaños' : 'cumpleaños'}`
  return (
    <span
      title={label}
      className="inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium leading-tight text-primary"
    >
      <span className="sr-only">{label}</span>
      {cakes > 0 ? (
        <Cake className="size-2.5" aria-hidden />
      ) : (
        <PartyPopper className="size-2.5" aria-hidden />
      )}
      {cakes > 0 ? cakes : birthdays}
    </span>
  )
}

function DraggableEvent({
  event,
  tenantSlug,
  today,
  load,
  onOpenDay,
}: {
  event: ScheduledEventWithTemplate
  tenantSlug: string
  today: string
  load: SegmentEventLoad | null
  onOpenDay: OpenDay
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${EVENT_PREFIX}${event.id}`,
  })
  const color = event.template?.color_hex ?? '#7c3aed'
  // Si está siendo arrastrado, lo ocultamos para que solo se vea el overlay.
  if (isDragging) {
    return (
      <div
        className="rounded-md border border-dashed px-1.5 py-0.5 text-[11px] leading-snug"
        style={{ borderColor: `${color}66`, color: `${color}99` }}
      >
        <span className="block truncate">{eventDisplayName(event)}</span>
      </div>
    )
  }
  // Los listeners de dnd quedan en el contenedor (MouseSensor 6 px, TouchSensor
  // 200 ms): en la compu arrastrar el chip sigue moviendo el evento, y un toque
  // sin arrastre es un click normal que reserva adentro (o abre el día si ya pasó).
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <EventTap
        event={event}
        load={load}
        tenantSlug={tenantSlug}
        today={today}
        onOpenDay={onOpenDay}
        className="block w-full rounded-md px-1.5 py-1 text-left text-[11px] font-medium leading-snug outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ backgroundColor: `${color}2e`, color }}
      >
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="truncate">{eventDisplayName(event)}</span>
        </span>
        <span className="block pl-2.5 text-[10px] opacity-80 tabular-nums">
          {event.starts_at_local.slice(0, 5)} · <EventLoad load={load} capacity={event.capacity} />
        </span>
      </EventTap>
    </div>
  )
}
