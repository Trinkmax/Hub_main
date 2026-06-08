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
import { ChevronLeft, ChevronRight, GripVertical, Loader2, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { moveScheduledEvent } from '@/lib/salon/actions'
import type { MonthCapacity } from '@/lib/salon/month-capacity'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { ScheduledEventTemplateRow } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { DayReservationsDialog } from './day-reservations-dialog'
import { TemplateDropDialog } from './template-drop-dialog'

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

export function ScheduledEventsMonth({
  tenantSlug,
  ym,
  events: initialEvents,
  templates,
  monthCapacity,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  monthCapacity: MonthCapacity
}) {
  const router = useRouter()
  const [events, setEvents] = useState(initialEvents)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null)
  const [moving, startMoving] = useTransition()
  const [dayDialogDate, setDayDialogDate] = useState<string | null>(null)

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
    router.push(`/${tenantSlug}/eventos/programados?month=${next}`)
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Tira de templates draggables */}
      <TemplateRail templates={templates} />

      <div className="card-hairline rounded-2xl border bg-card p-3 sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Mes anterior"
            onClick={() => gotoMonth(shiftYM(ym, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-xl font-semibold capitalize">{formatYM(ym)}</h2>
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
        {/* Agenda vertical para mobile: la grilla 7-col deja celdas ilegibles en celular.
            El drag-and-drop queda solo en >=sm; en mobile se programa con el botón + por día. */}
        <div className="space-y-2 sm:hidden">
          <MonthAgenda
            ym={ym}
            events={events}
            tenantSlug={tenantSlug}
            monthCapacity={monthCapacity}
            onOpenDay={setDayDialogDate}
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
              events={cell.events}
              tenantSlug={tenantSlug}
              isDraggingTemplate={activeDrag?.kind === 'template'}
              isDraggingEvent={activeDrag?.kind === 'event'}
              capacity={
                cell.date
                  ? (monthCapacity.days[cell.date] ?? {
                      used: 0,
                      total: monthCapacity.defaultTotal,
                    })
                  : null
              }
              onOpenDay={setDayDialogDate}
            />
          ))}
        </div>
        <p className="mt-3 hidden text-center text-[11px] text-muted-foreground sm:block">
          Arrastrá un template a un día para programar, o un evento a otra fecha para moverlo.
        </p>
        <p className="mt-3 text-center text-[11px] text-muted-foreground sm:hidden">
          Tocá el + de un día para programar un evento.
        </p>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag?.kind === 'template' ? <TemplateChip template={activeDrag.template} /> : null}
        {activeDrag?.kind === 'event' ? <EventCardOverlay event={activeDrag.event} /> : null}
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

      <DayReservationsDialog
        tenantSlug={tenantSlug}
        date={dayDialogDate}
        open={dayDialogDate !== null}
        onOpenChange={(o) => {
          if (!o) setDayDialogDate(null)
        }}
      />
    </DndContext>
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

// Agenda mensual para mobile: lista de días con eventos (fecha + nombre + hora).
// Sin drag-and-drop — programar se hace con el botón + de cada día.
function MonthAgenda({
  ym,
  events,
  tenantSlug,
  monthCapacity,
  onOpenDay,
}: {
  ym: string
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  monthCapacity: MonthCapacity
  onOpenDay: (date: string) => void
}) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return null
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()

  const daysWithEvents: Array<{ date: string; events: ScheduledEventWithTemplate[] }> = []
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${ym}-${String(d).padStart(2, '0')}`
    const dayEvents = events.filter((e) => e.event_date === dateStr)
    if (dayEvents.length > 0) daysWithEvents.push({ date: dateStr, events: dayEvents })
  }

  if (daysWithEvents.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-4 text-center text-xs text-muted-foreground">
        No hay eventos programados este mes.
      </p>
    )
  }

  return (
    <>
      {daysWithEvents.map(({ date, events: dayEvents }) => {
        const capacity = monthCapacity.days[date] ?? {
          used: 0,
          total: monthCapacity.defaultTotal,
        }
        return (
          <div key={date} className="rounded-lg border border-border/60 bg-card/40 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpenDay(date)}
                className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary"
                aria-label={`Ver reservas del ${date}`}
              >
                <span className="text-sm font-semibold capitalize tabular-nums">
                  {formatAgendaDate(date)}
                </span>
                <CapacityBadge used={capacity.used} total={capacity.total} />
              </button>
              <Link
                href={`/${tenantSlug}/eventos/programados/nuevo?date=${date}`}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary"
                aria-label={`Programar evento ${date}`}
              >
                <Plus className="size-4" />
              </Link>
            </div>
            <div className="space-y-1">
              {dayEvents.map((e) => {
                const color = e.template?.color_hex ?? '#7c3aed'
                return (
                  <Link
                    key={e.id}
                    href={`/${tenantSlug}/eventos/programados/${e.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-transform"
                    style={{ backgroundColor: `${color}1f`, color }}
                  >
                    <span className="font-mono text-[11px] tabular-nums opacity-80">
                      {e.starts_at_local.slice(0, 5)}
                    </span>
                    <span className="truncate">
                      {e.name_override ?? e.template?.name ?? 'Evento'}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-70">
                      {e.capacity}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

function TemplateRail({ templates }: { templates: ScheduledEventTemplateRow[] }) {
  return (
    <div className="mb-4 rounded-2xl border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        <span className="uppercase tracking-wide">Arrastrá un template al calendario</span>
      </div>
      <div
        role="toolbar"
        aria-label="Templates disponibles para programar"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {templates.map((t) => (
          <DraggableTemplate key={t.id} template={t} />
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

function EventCardOverlay({ event }: { event: ScheduledEventWithTemplate }) {
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
      <span className="block truncate">
        {event.name_override ?? event.template?.name ?? 'Evento'}
      </span>
      <span className="block text-[10px] opacity-70 tabular-nums">
        {event.starts_at_local.slice(0, 5)} · {event.capacity}
      </span>
    </div>
  )
}

function CapacityBadge({ used, total }: { used: number; total: number }) {
  const isOver = used > total
  const isFull = !isOver && total > 0 && used >= total * 0.9
  return (
    <span
      className={cn(
        'rounded px-1 py-px font-mono text-[10px] font-semibold tabular-nums',
        isOver
          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
          : isFull
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      )}
      title="Cubiertos / tope del salón"
    >
      {used}/{total}
    </span>
  )
}

function DayCell({
  date,
  events,
  tenantSlug,
  isDraggingTemplate,
  isDraggingEvent,
  capacity,
  onOpenDay,
}: {
  date: string | null
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  isDraggingTemplate: boolean
  isDraggingEvent: boolean
  capacity: { used: number; total: number } | null
  onOpenDay: (date: string) => void
}) {
  // Las celdas vacías de padding no son droppables.
  const { setNodeRef, isOver } = useDroppable({
    id: date ? `${DAY_PREFIX}${date}` : `pad:${Math.random()}`,
    disabled: !date,
  })

  if (!date) {
    return (
      <div className="min-h-[88px] rounded-lg border border-transparent bg-transparent p-1.5" />
    )
  }

  const dragging = isDraggingTemplate || isDraggingEvent
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group min-h-[88px] rounded-lg border p-1.5 transition-colors',
        'border-border/60 bg-card/40',
        // Resalta destinos válidos al arrastrar
        dragging && !isOver && 'border-dashed border-border/40 bg-card/20',
        isOver && 'border-primary/70 bg-primary/10 ring-2 ring-primary/30',
      )}
    >
      <div className="flex h-full flex-col gap-1">
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            className="-mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-secondary"
            aria-label={`Ver reservas del ${date}`}
          >
            <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
              {Number(date.slice(-2))}
            </span>
            {capacity ? <CapacityBadge used={capacity.used} total={capacity.total} /> : null}
          </button>
          <Link
            href={`/${tenantSlug}/eventos/programados/nuevo?date=${date}`}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
            aria-label={`Programar evento ${date}`}
          >
            <Plus className="size-3" />
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          {events.map((e) => (
            <DraggableEvent key={e.id} event={e} tenantSlug={tenantSlug} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DraggableEvent({
  event,
  tenantSlug,
}: {
  event: ScheduledEventWithTemplate
  tenantSlug: string
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
        <span className="block truncate">
          {event.name_override ?? event.template?.name ?? 'Evento'}
        </span>
      </div>
    )
  }
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <Link
        href={`/${tenantSlug}/eventos/programados/${event.id}`}
        onClick={(e) => {
          // El listener de dnd-kit ya consume drag con threshold 6px; si igual
          // se dispara un click después de drag, evitamos navegación accidental.
          // En la práctica esto rara vez se ejecuta porque drag cancela el click.
          e.stopPropagation()
        }}
        className="block rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-snug transition-transform hover:scale-[1.02]"
        style={{
          backgroundColor: `${color}1f`,
          color,
        }}
      >
        <span className="block truncate">
          {event.name_override ?? event.template?.name ?? 'Evento'}
        </span>
        <span className="block text-[10px] opacity-70 tabular-nums">
          {event.starts_at_local.slice(0, 5)} · {event.capacity}
        </span>
      </Link>
    </div>
  )
}
