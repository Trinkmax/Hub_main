'use client'

import { CalendarPlus, ChevronLeft, ChevronRight, Clock4, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RollCallDialog } from '@/app/(manager)/[tenantSlug]/reservas/_components/roll-call-dialog'
import { keepOpenOnToast } from '@/components/reservations/reservation-quick-view'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { editEventHref, newReservationHref } from '@/lib/salon/calendar-links'
import { formatDayLabel } from '@/lib/salon/date-presets'
import { nowMinutesInCordoba } from '@/lib/salon/operativo'
import {
  fetchDayOverview,
  removeSegmentOverride,
  upsertSegmentOverride,
} from '@/lib/salon/segment-actions'
import type { DayOverview } from '@/lib/salon/segment-queries'
import type { SegmentActionResult } from '@/lib/salon/segment-schemas'
import {
  computeDaySegments,
  focusSegment,
  groupReservationsBySegment,
  isoDowOf,
  SEGMENT_KEYS,
  type SegmentKey,
  type SegmentLoad,
  type SegmentOverrideRow,
} from '@/lib/salon/segments'
import { mismatchCopy, SEGMENT_LABELS } from '@/lib/salon/segments-copy'
import { RESERVATION_OPERATOR_ROLES, RESERVATION_STAFF_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import {
  DayCapacityEditor,
  type DayOverrideInput,
  lowerFirst,
  weekdayCapLabel,
} from './day-capacity-editor'
import { DaySegmentSection } from './day-segment-section'

export type DayViewProps = {
  tenantSlug: string
  date: string | null // null = cerrado
  today: string
  role: TenantRole
  anchorSegment: SegmentKey | null
  focusReservationId: string | null
  initialOverview: DayOverview | null
  onDateChange: (date: string) => void
  onClose: () => void
}

/**
 * Estado de la carga del día. Va atado a SU fecha: la vista solo muestra
 * números cuando `view.date` es el día abierto, así que al cambiar de día con
 * las flechas nunca queda a la vista el cupo del día anterior (el diálogo viejo
 * mostraba la caja de capacidad del día previo mientras cargaba).
 */
type ViewState = {
  date: string
  status: 'loading' | 'ready' | 'error'
  overview: DayOverview | null
  /** Recargando por detrás después de un cambio: se siguen viendo los números. */
  refreshing: boolean
  /** Se cerró la vista: al reabrir el mismo día se vuelve a pedir por detrás. */
  stale: boolean
}

const DAY_ERROR = 'No pudimos leer el día.'

/** Clases de la hoja inferior en mobile: sin JS de media query y sin vaul. */
const CONTENT_CLASSES = cn(
  // El contenedor no scrollea: header y footer quedan fijos y scrollea solo el
  // medio. Con `grid` (el default del DialogContent) un header `sticky` queda
  // atado a su fila y se va con el scroll.
  'flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl',
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-full max-sm:max-h-[92dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:pb-[env(safe-area-inset-bottom)]',
)

function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

/**
 * Día anterior / siguiente. Aritmética en UTC a propósito (como
 * date-presets): con la TZ del navegador un cambio de horario corría el día.
 */
function shiftIsoDay(iso: string, delta: number): string {
  const d = parseIsoDay(iso)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** 'Jueves, 10 de septiembre'. */
function longDayLabel(iso: string): string {
  const label = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parseIsoDay(iso))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** 'jue 10/09', para frases ("Almuerzo del jue 25/09: 120 lugares"). */
function shortDayLabel(iso: string): string {
  return lowerFirst(formatDayLabel(iso))
}

function placesText(capacity: number): string {
  if (capacity === 0) return 'cerrado'
  return capacity === 1 ? '1 lugar' : `${capacity} lugares`
}

/** Las flechas del teclado no cambian de día si el foco está escribiendo o en un control que las usa. */
function usesArrowKeys(target: HTMLElement): boolean {
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (
    target.closest(
      '[role="slider"],[role="listbox"],[role="menu"],[role="radiogroup"],[role="tablist"],[role="spinbutton"]',
    ) !== null
  )
}

/**
 * Posición de `el` dentro del contenedor que scrollea, sin getBoundingClientRect:
 * durante la animación de apertura el diálogo está escalado al 95 % y las
 * medidas de pantalla salen corridas. `offsetTop` es de layout, no de pantalla.
 */
function offsetWithin(el: HTMLElement, container: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = el
  while (node && node !== container) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return top
}

/**
 * La vista del día: almuerzo, merienda y cena por separado, cada uno contra su
 * cupo, con sus eventos y sus reservas. Reemplaza al diálogo del día que
 * mostraba "Cubiertos del día 171/130".
 *
 * Es la puerta a las reservas: se ve cómo viene el día (pedido 3 del dueño) y
 * desde cada servicio se reserva con la hora ya puesta, o adentro de un evento.
 *
 * Los datos llegan en UNA server action (fetchDayOverview: reservas + eventos +
 * cupos resueltos + ajustes). El cálculo corre acá con `computeDaySegments`, la
 * misma función que usan el mes, el form y el operativo: ninguna pantalla
 * muestra otro número para lo mismo.
 *
 * La URL (?day, ?seg, ?res) la maneja el mes: esta vista solo avisa con
 * `onDateChange` / `onClose`.
 *
 * Después de un cambio (cupo especial, vista rápida, pasar lista) no se relee
 * nada a mano: todas esas actions revalidan /eventos/programados y Next 16
 * devuelve la página re-renderizada en la MISMA respuesta de la action (con el
 * ?day de la URL), así que el mes y `initialOverview` llegan nuevos solos.
 * Antes cada cambio sumaba fetchDayOverview + router.refresh (y Pasar lista
 * otro router.refresh): 3 o 4 lecturas completas por toque.
 */
export function DayView({
  tenantSlug,
  date,
  today,
  role,
  anchorSegment,
  focusReservationId,
  initialOverview,
  onDateChange,
  onClose,
}: DayViewProps) {
  // Último día abierto: el contenido sigue en pantalla durante la animación
  // de cierre en lugar de vaciarse de golpe.
  const [shownDate, setShownDate] = useState(date)
  if (date !== null && date !== shownDate) setShownDate(date)

  const [view, setView] = useState<ViewState | null>(null)

  // El día precargado por la página (?day en la URL, o volver de guardar una
  // reserva) se usa directo, sin flash de carga. Se ajusta en el render y no en
  // un efecto para que el primer frame ya tenga los números. Un overview nuevo
  // para el mismo día (la página que vuelve con la respuesta de una action)
  // también se toma: es la relectura de ese cambio.
  const [consumedInitial, setConsumedInitial] = useState<DayOverview | null>(null)
  if (
    date !== null &&
    initialOverview !== null &&
    initialOverview.date === date &&
    initialOverview !== consumedInitial
  ) {
    setConsumedInitial(initialOverview)
    setView({ date, status: 'ready', overview: initialOverview, refreshing: false, stale: false })
  }

  // Guard de respuesta vieja: cada pedido lleva un número y solo el último
  // escribe. Pasar rápido del 10 al 11 y al 12 no puede terminar mostrando el 11.
  const requestRef = useRef(0)

  // Un overview que trae la página es posterior a cualquier pedido propio en
  // vuelo (p. ej. la recarga de fondo al reabrir el día, pisada por un cambio
  // hecho enseguida): ese pedido ya no escribe. Va antes del efecto que carga,
  // así una carga que arranca en el mismo commit no queda invalidada.
  useEffect(() => {
    if (consumedInitial) requestRef.current++
  }, [consumedInitial])

  const load = useCallback(
    async (target: string, mode: 'reset' | 'refresh') => {
      const id = ++requestRef.current
      setView((prev) =>
        mode === 'refresh' && prev?.date === target && prev.overview
          ? { ...prev, refreshing: true, stale: false }
          : { date: target, status: 'loading', overview: null, refreshing: false, stale: false },
      )

      let res: SegmentActionResult<DayOverview>
      try {
        res = await fetchDayOverview(tenantSlug, target)
      } catch (error) {
        // Red caída o deploy nuevo en el medio: sin datos del bar en el log.
        console.error('[calendario.dia.load]', error instanceof Error ? error.message : error)
        res = { ok: false, message: `${DAY_ERROR} Probá de nuevo.` }
      }
      if (id !== requestRef.current) return

      if (res.ok) {
        setView({
          date: target,
          status: 'ready',
          overview: res.data,
          refreshing: false,
          stale: false,
        })
        return
      }
      if (mode === 'refresh') toast.error(res.message)
      // Si ya había números de este día, se quedan: mejor el dato de hace un
      // minuto que una pantalla de error por una recarga que falló.
      setView((prev) =>
        mode === 'refresh' && prev?.date === target && prev.overview
          ? { ...prev, refreshing: false }
          : { date: target, status: 'error', overview: null, refreshing: false, stale: false },
      )
    },
    [tenantSlug],
  )

  const viewDate = view?.date ?? null
  const viewStale = view?.stale ?? false

  // Día nuevo → carga con skeleton. Reabrir el mismo día que quedó en memoria →
  // se muestra y se refresca por detrás (pudo cambiar mientras estaba cerrado).
  useEffect(() => {
    if (date === null) return
    if (viewDate !== date) void load(date, 'reset')
    else if (viewStale) void load(date, 'refresh')
  }, [date, viewDate, viewStale, load])

  // Al cerrar, lo que quedó en memoria pasa a "viejo".
  useEffect(() => {
    if (date !== null) return
    setView((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev))
  }, [date])

  const current = view && view.date === shownDate ? view : null
  const overview = current?.overview ?? null
  const failed = current?.status === 'error'

  const daySegments = useMemo(
    () =>
      overview
        ? computeDaySegments({
            date: overview.date,
            reservations: overview.reservations,
            events: overview.events,
            caps: overview.caps,
          })
        : null,
    [overview],
  )
  const rowsBySegment = useMemo(
    () => (overview ? groupReservationsBySegment(overview.reservations, overview.events) : null),
    [overview],
  )

  // Vista rápida abierta, atada a su día: al cambiar de día o cerrar la vista
  // se descarta, así reabrir el mismo día no vuelve a abrir el popup solo.
  const [quickOpen, setQuickOpen] = useState<{ date: string; id: string } | null>(null)
  if (quickOpen !== null && quickOpen.date !== date) setQuickOpen(null)
  const openReservationId = quickOpen?.id ?? null
  const onOpenReservation = useCallback(
    (id: string | null) => setQuickOpen(id && date ? { date, id } : null),
    [date],
  )

  // ── Reloj: el servicio en foco de hoy es el que está en curso ──
  const isToday = shownDate !== null && shownDate === today
  const [nowMinutes, setNowMinutes] = useState(() => nowMinutesInCordoba())
  useEffect(() => {
    if (date === null || date !== today) return
    setNowMinutes(nowMinutesInCordoba())
    const timer = window.setInterval(() => setNowMinutes(nowMinutesInCordoba()), 60_000)
    return () => window.clearInterval(timer)
  }, [date, today])
  const focus = daySegments ? focusSegment(daySegments, isToday ? nowMinutes : null) : null

  // ── Scroll al servicio anclado o a la reserva resaltada, una vez por día ──
  // El contenedor llega por callback ref (state, no ref): el contenido del
  // Dialog se monta en un portal DESPUÉS del primer render, y el efecto tiene
  // que volver a correr cuando existe. Reabrir el diálogo crea otro contenedor
  // (empieza arriba), así que el "ya scrolleé" va atado también al elemento.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scrolledRef = useRef<{ el: HTMLDivElement; key: string } | null>(null)
  useEffect(() => {
    if (!scrollEl || !overview) return
    const key = `${overview.date}|${anchorSegment ?? ''}|${focusReservationId ?? ''}`
    if (scrolledRef.current?.el === scrollEl && scrolledRef.current.key === key) return
    scrolledRef.current = { el: scrollEl, key }
    const row = focusReservationId ? document.getElementById(`dia-res-${focusReservationId}`) : null
    const section = anchorSegment ? document.getElementById(`dia-seg-${anchorSegment}`) : null
    if (row && scrollEl.contains(row)) {
      const top = offsetWithin(row, scrollEl) - (scrollEl.clientHeight - row.offsetHeight) / 2
      scrollEl.scrollTop = Math.max(0, top)
    } else if (section && scrollEl.contains(section)) {
      scrollEl.scrollTop = offsetWithin(section, scrollEl)
    } else {
      scrollEl.scrollTop = 0
    }
  }, [scrollEl, overview, anchorSegment, focusReservationId])

  // ── Cupo especial del día (solo owner): guardar, quitar y deshacer ──
  const [busySegment, setBusySegment] = useState<SegmentKey | null>(null)

  const undoOverride = useCallback(
    async (targetDate: string, segment: SegmentKey, previous: SegmentOverrideRow | null) => {
      let res: SegmentActionResult<{ previous: SegmentOverrideRow | null }>
      try {
        res = previous
          ? await upsertSegmentOverride(tenantSlug, {
              override_date: previous.override_date,
              segment: previous.segment,
              capacity: previous.capacity,
              warn_at: previous.warn_at,
              reason: previous.reason,
            })
          : await removeSegmentOverride(tenantSlug, { override_date: targetDate, segment })
      } catch (error) {
        console.error(
          '[calendario.dia.undoOverride]',
          error instanceof Error ? error.message : error,
        )
        res = { ok: false, message: 'No se pudo deshacer. Probá de nuevo.' }
      }
      // Sin relectura propia: la action revalida y la página vuelve con el
      // día (si sigue abierto) y el mes al día.
      if (res.ok) toast.success('Listo: el cupo quedó como estaba.')
      else toast.error(res.message)
    },
    [tenantSlug],
  )

  const saveOverride = useCallback(
    async (targetDate: string, input: DayOverrideInput): Promise<boolean> => {
      setBusySegment(input.segment)
      try {
        const res = await upsertSegmentOverride(tenantSlug, {
          override_date: targetDate,
          segment: input.segment,
          capacity: input.capacity,
          warn_at: input.warn_at,
          reason: input.reason,
        })
        if (!res.ok) {
          toast.error(res.message)
          return false
        }
        const previous = res.data.previous
        toast.success(
          `${SEGMENT_LABELS[input.segment]} del ${shortDayLabel(targetDate)}: ${placesText(input.capacity)}`,
          {
            action: {
              label: 'Deshacer',
              onClick: () => {
                void undoOverride(targetDate, input.segment, previous)
              },
            },
          },
        )
        return true
      } catch (error) {
        console.error(
          '[calendario.dia.saveOverride]',
          error instanceof Error ? error.message : error,
        )
        toast.error('No se pudo guardar el cupo especial. Probá de nuevo.')
        return false
      } finally {
        setBusySegment(null)
      }
    },
    [tenantSlug, undoOverride],
  )

  const removeOverride = useCallback(
    async (targetDate: string, s: SegmentLoad, isoDowLabel: string): Promise<boolean> => {
      setBusySegment(s.key)
      try {
        const res = await removeSegmentOverride(tenantSlug, {
          override_date: targetDate,
          segment: s.key,
        })
        if (!res.ok) {
          toast.error(res.message)
          return false
        }
        const previous = res.data.previous
        toast.success(
          `${SEGMENT_LABELS[s.key]} del ${shortDayLabel(targetDate)}: vuelve al ${isoDowLabel}`,
          previous
            ? {
                action: {
                  label: 'Deshacer',
                  onClick: () => {
                    void undoOverride(targetDate, s.key, previous)
                  },
                },
              }
            : undefined,
        )
        return true
      } catch (error) {
        console.error(
          '[calendario.dia.removeOverride]',
          error instanceof Error ? error.message : error,
        )
        toast.error('No se pudo quitar el cupo especial. Probá de nuevo.')
        return false
      } finally {
        setBusySegment(null)
      }
    },
    [tenantSlug, undoOverride],
  )

  // ── Navegación entre días ──
  const shift = useCallback(
    (delta: number) => {
      if (shownDate) onDateChange(shiftIsoDay(shownDate, delta))
    },
    [shownDate, onDateChange],
  )

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const target = e.target as HTMLElement
    // Los eventos de React atraviesan los portales: una flecha tipeada en la
    // vista rápida o en el popover del cupo (portaleados fuera de este nodo)
    // llega acá igual y no tiene que cambiar el día de abajo.
    if (!e.currentTarget.contains(target) || usesArrowKeys(target)) return
    e.preventDefault()
    shift(e.key === 'ArrowLeft' ? -1 : 1)
  }

  const canBook = RESERVATION_STAFF_ROLES.includes(role)
  const isOwner = role === 'owner'
  // "Subir a N" crea el cupo especial de ESTE día: en un día que ya pasó no
  // tiene nada que resolver.
  const canRaise = isOwner && shownDate !== null && shownDate >= today
  const canRollCall =
    shownDate !== null && shownDate <= today && RESERVATION_OPERATOR_ROLES.includes(role)
  const longLabel = shownDate ? longDayLabel(shownDate) : 'Día'
  const shortLabel = shownDate ? shortDayLabel(shownDate) : ''
  const isoDow = shownDate ? isoDowOf(shownDate) : null

  const footerHref =
    shownDate && focus
      ? newReservationHref(tenantSlug, { date: shownDate, segment: focus })
      : newReservationHref(tenantSlug, shownDate ? { date: shownDate } : {})
  const footerLabel =
    focus && overview
      ? `Nueva reserva · ${SEGMENT_LABELS[focus]} ${overview.settings[focus].defaultTime}`
      : 'Nueva reserva'

  return (
    <Dialog
      open={date !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={CONTENT_CLASSES}
        onKeyDown={handleKeyDown}
        // Los "Deshacer" del cupo especial viven en un toast, fuera del
        // diálogo: sin esto, tocarlo cerraba el día (en desktop) antes de que
        // corriera el click. Que el toast reciba el click lo arregla el
        // `pointer-events: auto` de [data-sonner-toaster] en globals.css.
        onInteractOutside={keepOpenOnToast}
      >
        <header className="shrink-0 space-y-2.5 border-b border-border/60 px-3 pt-3 pb-3 sm:px-5">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Día anterior"
              aria-keyshortcuts="ArrowLeft"
              onClick={() => shift(-1)}
              disabled={!shownDate}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <div className="min-w-0 flex-1 text-center">
              <DialogTitle className="flex items-center justify-center gap-2 font-serif text-lg">
                <span className="truncate">{longLabel}</span>
                {isToday ? (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-sans text-[11px] font-medium text-primary">
                    Hoy
                  </span>
                ) : null}
                {/* Decorativo: el estado lo anuncia el aria-busy del contenido. */}
                {current?.refreshing ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Almuerzo, merienda y cena por separado
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Día siguiente"
              aria-keyshortcuts="ArrowRight"
              onClick={() => shift(1)}
              disabled={!shownDate}
            >
              <ChevronRight aria-hidden />
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Cerrar">
                <X aria-hidden />
              </Button>
            </DialogClose>
          </div>

          {shownDate && (canRollCall || isOwner) ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {canRollCall ? (
                <RollCallDialog tenantSlug={tenantSlug} day={shownDate} dayLabel={longLabel} />
              ) : null}
              {isOwner && isoDow !== null ? (
                // Mientras el día carga, `segments` es null y el botón queda
                // deshabilitado en su lugar (sin saltos en el header).
                <DayCapacityEditor
                  date={shownDate}
                  dayLabel={shortLabel}
                  isoDow={isoDow}
                  segments={daySegments?.segments ?? null}
                  busy={busySegment}
                  onSave={(input) => saveOverride(shownDate, input)}
                  onRemove={(segment) => {
                    const s = daySegments?.segments[segment]
                    if (!s) return Promise.resolve(false)
                    return removeOverride(shownDate, s, lowerFirst(weekdayCapLabel(s, isoDow)))
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </header>

        <div
          ref={setScrollEl}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          aria-busy={current?.refreshing || (!overview && !failed) ? true : undefined}
        >
          {failed ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">{DAY_ERROR}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (shownDate) void load(shownDate, 'reset')
                }}
              >
                Reintentar
              </Button>
            </div>
          ) : !overview || !daySegments || !rowsBySegment || !shownDate ? (
            <DaySkeleton />
          ) : (
            <>
              {daySegments.mismatches.length > 0 ? (
                // Horas de eventos mal cargadas: solo se avisa, el dato lo
                // corrige el dueño (Merienda Libre del 03/10 a las 21:00 con su
                // reserva de las 16:30 le restaba 33 a la cena).
                <div className="space-y-2 px-4 pt-4 sm:px-6">
                  {daySegments.mismatches.map((m) => (
                    <div
                      key={m.eventId}
                      role="note"
                      className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground"
                    >
                      <Clock4 className="mt-0.5 size-3.5 shrink-0 text-warning-text" aria-hidden />
                      <p className="min-w-0 flex-1">
                        {mismatchCopy(m)}
                        {canBook ? (
                          <>
                            {' '}
                            <Link
                              href={editEventHref(tenantSlug, m.eventId)}
                              className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            >
                              Editar evento
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="divide-y divide-border/60">
                {SEGMENT_KEYS.map((key) => (
                  <DaySegmentSection
                    key={key}
                    tenantSlug={tenantSlug}
                    date={shownDate}
                    dayLabel={shortLabel}
                    isoDow={daySegments.isoDow}
                    segment={daySegments.segments[key]}
                    defaultTime={overview.settings[key].defaultTime}
                    reservations={rowsBySegment[key]}
                    canBook={canBook}
                    canRaise={canRaise}
                    isToday={isToday}
                    suggestedRaise={overview.suggestedRaise[key]}
                    raising={busySegment === key}
                    focusReservationId={focusReservationId}
                    openReservationId={openReservationId}
                    onOpenReservation={onOpenReservation}
                    onRaise={(capacity) => {
                      // Mismo cupo especial que el editor, sin motivo: "subí el
                      // almuerzo porque se llenó" no necesita explicación.
                      void saveOverride(shownDate, {
                        segment: key,
                        capacity,
                        warn_at: null,
                        reason: null,
                      })
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {canBook && shownDate ? (
          <footer className="flex shrink-0 justify-end border-t border-border/60 bg-background px-4 py-3 sm:px-6">
            {/* El servicio del footer es el que está en curso si el día es hoy
                (a las 02:00 todavía es la cena), la cena si no. */}
            <Button asChild className="w-full gap-2 sm:w-auto">
              <Link href={footerHref}>
                <CalendarPlus className="size-4" aria-hidden />
                {footerLabel}
              </Link>
            </Button>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Tres servicios en esqueleto: la forma del día sin ningún número (ni del día anterior). */
function DaySkeleton() {
  return (
    <div role="status" className="divide-y divide-border/60">
      <span className="sr-only">Cargando el día…</span>
      {SEGMENT_KEYS.map((key) => (
        <div key={key} aria-hidden className="space-y-2.5 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
