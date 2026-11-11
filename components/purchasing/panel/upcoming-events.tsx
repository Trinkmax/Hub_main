'use client'

import { AlertTriangle, Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { addDays } from '@/lib/dates'
import { saveEventPlan } from '@/lib/purchasing/catalog-actions'
import { longDayLabel, onDayLabel as onDay, relativeDayLabel } from '@/lib/purchasing/dates'
import { type EventDeadline, isUrgent, type SupplierDeadline } from '@/lib/purchasing/deadlines'
import type { PlannedEvent } from '@/lib/purchasing/events'
import { addEventToOrder } from '@/lib/purchasing/order-actions'
import { cn } from '@/lib/utils'

function statusLine(e: PlannedEvent): { text: string; tone: 'ok' | 'muted' | 'warn' } {
  switch (e.status) {
    case 'sums':
      return {
        text: `Suma insumos · ${e.guests} ${e.guestsSource === 'recipe' ? 'personas (la receta)' : 'personas'}`,
        tone: 'ok',
      }
    case 'needs_variant':
      return { text: 'Elegí la variante', tone: 'warn' }
    case 'skipped':
      return { text: 'No suma (lo sacaste)', tone: 'muted' }
    case 'notice_only':
      return { text: e.notice ?? 'Aviso', tone: 'muted' }
    default:
      return { text: 'Sale con lo de siempre', tone: 'muted' }
  }
}

type Tone = 'ok' | 'muted' | 'todo' | 'urgent' | 'late'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-primary',
  muted: 'text-muted-foreground',
  todo: 'font-semibold text-warning-text',
  urgent: 'font-semibold text-warning-text',
  late: 'font-semibold text-destructive',
}

function itemsText(row: SupplierDeadline): string {
  const names = row.items.map((i) => i.name)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`
}

/** Qué dice el renglón de un proveedor: lo que pasa, el detalle y si se puede sumar al pedido. */
function rowText(
  row: SupplierDeadline,
  today: string,
  openCountDate: string | null,
): { title: string; detail: string | null; tone: Tone; canAdd: boolean } {
  const by = row.orderBy ? onDay(row.orderBy, today) : null
  const arrives = row.arrives ? onDay(row.arrives, today) : null
  const noDays = row.noDays ? 'sin días de entrega cargados' : null
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null
  switch (row.status) {
    case 'count': {
      const count =
        row.countDate === openCountDate
          ? 'Lo trae el conteo que se está haciendo'
          : row.countDate === today
            ? 'Lo trae el conteo de hoy'
            : `Lo trae el conteo del ${longDayLabel(row.countDate ?? today)}`
      return {
        title: count,
        detail: join(by ? `pedir hasta ${by}` : null, arrives ? `llega ${arrives}` : null, noDays),
        tone: 'ok',
        canAdd: false,
      }
    }
    case 'counted':
      return {
        title: `Lo vio el conteo del ${longDayLabel(row.countDate ?? today)}: alcanzaba`,
        detail: null,
        tone: 'muted',
        canAdd: false,
      }
    case 'draft': {
      const urgent = row.orderBy != null && row.orderBy <= today
      return {
        title: urgent
          ? 'En el pedido para revisar: mandalo hoy'
          : `En el pedido para revisar: mandalo hasta ${by}`,
        detail: join(arrives ? `llega ${arrives}` : null, noDays),
        tone: urgent ? 'urgent' : 'ok',
        canAdd: false,
      }
    }
    case 'draft_late':
      return {
        title: `En el pedido para revisar, pero llega ${arrives ?? 'tarde'}`,
        detail: `Tenía que llegar hasta ${onDay(row.mustArriveBy, today)}: pedile que lo traiga antes`,
        tone: 'late',
        canAdd: false,
      }
    case 'ordered':
      return {
        title: row.received
          ? `Llegó ${arrives ?? ''}`.trim()
          : arrives
            ? `Pedido · llega ${arrives}`
            : 'Pedido',
        detail: null,
        tone: 'ok',
        canAdd: false,
      }
    case 'ordered_late':
      return {
        title: row.received ? `Llegó ${arrives}, tarde` : `Pedido, pero llega ${arrives}`,
        detail: `Tenía que llegar hasta ${onDay(row.mustArriveBy, today)}`,
        tone: 'late',
        canAdd: false,
      }
    case 'today':
      return {
        title: 'Pedilo hoy',
        detail: join(
          row.deliveryDay ? `llega ${onDay(row.deliveryDay, today)}` : null,
          'ningún conteo llega a tiempo',
          noDays,
        ),
        tone: 'urgent',
        canAdd: true,
      }
    case 'late':
      return {
        title: arrives ? `Tarde: pedido hoy llega ${arrives}` : `Tarde: había que pedirlo ${by}`,
        detail: join(`tenía que llegar hasta ${onDay(row.mustArriveBy, today)}`, noDays),
        tone: 'late',
        canAdd: true,
      }
    case 'todo':
      return {
        title: `Pedilo aparte hasta ${by}`,
        detail: join(
          'ningún conteo llega a tiempo',
          row.deliveryDay ? `llega ${onDay(row.deliveryDay, today)}` : null,
          noDays,
        ),
        tone: 'todo',
        // Se suma desde el día antes: sumado antes, saldría con el próximo pedido y llegaría días antes.
        canAdd: row.orderBy != null && row.orderBy <= addDays(today, 1),
      }
    default:
      return {
        title: 'Sin proveedor',
        detail: 'Asignáselo en Insumos para saber cuándo pedirlo',
        tone: 'todo',
        canAdd: false,
      }
  }
}

/** «El Oficio, La Selecta y 3 más»: hasta cuatro nombres. */
function namesText(names: readonly string[]): string {
  if (names.length <= 4) {
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  }
  return `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`
}

/** Lo que hay que resolver hoy de una fecha, agrupado: llega tarde · pedir hoy · mandar hoy · sin proveedor. */
function urgentGroups(e: EventDeadline, today: string): { label: string; names: string[] }[] {
  const groups = [
    { label: 'llega tarde', names: [] as string[] },
    { label: 'pedir hoy', names: [] as string[] },
    { label: 'mandar hoy el pedido para revisar', names: [] as string[] },
  ]
  for (const row of e.suppliers) {
    if (!isUrgent(row, today)) continue
    const name = row.supplier?.name ?? 'Sin proveedor'
    if (row.status === 'today') groups[1]?.names.push(name)
    else if (row.status === 'draft') groups[2]?.names.push(name)
    else groups[0]?.names.push(name)
  }
  return groups.filter((g) => g.names.length > 0)
}

/** «Sumar al pedido»: lo de la receta para ese proveedor va a su pedido para revisar (o a uno nuevo). */
function AddToOrderButton({
  slug,
  eventId,
  supplierId,
}: {
  slug: string
  eventId: string
  supplierId: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mt-1.5 h-9 rounded-lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const res = await addEventToOrder({ slug, scheduledEventId: eventId, supplierId })
            if (!res.ok) {
              toast.error(res.message)
              return
            }
            toast.success(
              `Sumado al pedido de ${res.supplierName}: ${res.products} ${res.products === 1 ? 'producto' : 'productos'}. Revisalo en «Para revisar y mandar».`,
            )
            router.refresh()
          } catch {
            toast.error('No se pudo sumar. Revisá la conexión y probá de nuevo.')
          }
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      Sumar al pedido
    </Button>
  )
}

/**
 * Los eventos de la semana, con hasta cuándo pedirle a cada proveedor para que todo llegue N días antes (lo
 * que pidió Tomás el 11/11/2026). Arriba, lo que hay que resolver hoy. Tocando «Editar» se elige la variante y
 * las personas de la fecha.
 */
export function WeekEvents({
  slug,
  today,
  deadlines,
  arriveDaysBefore,
  openCountDate,
}: {
  slug: string
  today: string
  deadlines: EventDeadline[]
  arriveDaysBefore: number
  openCountDate: string | null
}) {
  const [editing, setEditing] = useState<PlannedEvent | null>(null)
  if (!deadlines.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay fechas en el calendario para los próximos 7 días.
      </p>
    )
  }
  // Lo urgente, por fecha: una línea por evento con los proveedores agrupados (una receta puede tener diez).
  const urgent = deadlines
    .map((e) => ({ event: e, groups: urgentGroups(e, today) }))
    .filter((u) => u.groups.length > 0)
  return (
    <>
      {urgent.length ? (
        <div
          role="status"
          className="rounded-2xl border border-warning/50 bg-warning/10 px-4 py-3 text-[0.95rem] sm:px-5"
        >
          <p className="flex items-center gap-2 font-semibold text-warning-text">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            Para que todo llegue {arriveDaysBefore === 1 ? '1 día' : `${arriveDaysBefore} días`}{' '}
            antes del evento
          </p>
          <ul className="mt-1.5 space-y-1">
            {urgent.map(({ event, groups }) => (
              <li key={event.planned.event.id}>
                <a
                  href={`#pur-ev-${event.planned.event.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  <span className="font-medium">
                    {event.planned.event.name} ({relativeDayLabel(event.planned.event.date, today)})
                  </span>
                  {groups.map((g) => (
                    <span key={g.label}>
                      {' '}
                      · {g.label}: {namesText(g.names)}
                    </span>
                  ))}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {deadlines.map((e) => {
          const p = e.planned
          const s = statusLine(p)
          const late = e.suppliers.some((r) => r.status === 'late' || r.status.endsWith('_late'))
          return (
            <li
              key={p.event.id}
              id={`pur-ev-${p.event.id}`}
              className={cn(
                'scroll-mt-24 rounded-2xl border bg-card p-4 shadow-xs',
                late
                  ? 'border-destructive/40'
                  : p.status === 'needs_variant'
                    ? 'border-warning/60'
                    : 'border-border/70',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground first-letter:uppercase">
                    {relativeDayLabel(p.event.date, today)}
                    {p.event.startsAt ? ` · ${p.event.startsAt}` : ''}
                  </p>
                  <p className="mt-0.5 font-semibold leading-snug">
                    {p.event.name}
                    {p.recipe && p.variants.length > 1 ? ` · ${p.recipe.variant}` : ''}
                  </p>
                  {p.status === 'sums' ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {p.guests} personas{p.guestsSource === 'recipe' ? ' (la receta)' : ''} · todo
                      tiene que llegar hasta {onDay(e.mustArriveBy, today)}
                    </p>
                  ) : (
                    <p
                      className={cn(
                        'mt-0.5 text-sm',
                        s.tone === 'warn'
                          ? 'font-semibold text-warning-text'
                          : 'text-muted-foreground',
                      )}
                    >
                      {s.text}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 rounded-lg"
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Editar
                </Button>
              </div>
              {e.suppliers.length ? (
                <ul className="mt-3 divide-y divide-border/70 border-t border-border/70">
                  {e.suppliers.map((row) => {
                    const t = rowText(row, today, openCountDate)
                    return (
                      <li
                        key={row.supplier?.id ?? 'sin-proveedor'}
                        className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{row.supplier?.name ?? 'Sin proveedor'}</p>
                          <p className="truncate text-sm text-muted-foreground">{itemsText(row)}</p>
                        </div>
                        <div className="min-w-0 sm:text-right">
                          <p className={cn('text-[0.95rem]', TONE_CLASS[t.tone])}>{t.title}</p>
                          {t.detail ? (
                            <p className="text-sm text-muted-foreground">{t.detail}</p>
                          ) : null}
                          {t.canAdd && row.supplier ? (
                            <AddToOrderButton
                              slug={slug}
                              eventId={p.event.id}
                              supplierId={row.supplier.id}
                            />
                          ) : null}
                          {row.status === 'no_supplier' ? (
                            <Link
                              href={`/${slug}/compras/insumos`}
                              className="text-sm font-semibold underline underline-offset-4"
                            >
                              Ir a Insumos
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : p.status === 'sums' ? (
                <p className="mt-3 border-t border-border/70 pt-2.5 text-sm text-muted-foreground">
                  No hay nada para pedir: todo se hace en el local.
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {editing ? (
        <PlanDialog slug={slug} today={today} planned={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  )
}

function PlanDialog({
  slug,
  today,
  planned,
  onClose,
}: {
  slug: string
  today: string
  planned: PlannedEvent
  onClose: () => void
}) {
  const router = useRouter()
  const { event, variants } = planned
  const base = planned.recipe?.baseGuests ?? variants[0]?.baseGuests ?? 60
  const [recipeId, setRecipeId] = useState<string | null>(planned.recipe?.id ?? null)
  const [guests, setGuests] = useState(
    planned.guestsSource === 'plan' ? String(planned.guests) : '',
  )
  const [skip, setSkip] = useState(planned.status === 'skipped')
  const [pending, start] = useTransition()

  const save = () => {
    const n = guests.trim() ? Number.parseInt(guests, 10) : null
    if (n != null && (!Number.isFinite(n) || n < 1)) {
      toast.error('Las personas tienen que ser un número.')
      return
    }
    start(async () => {
      const res = await saveEventPlan({
        slug,
        scheduledEventId: event.id,
        recipeId: variants.length > 1 ? recipeId : null,
        guests: n,
        skip,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Guardado: el próximo conteo ya lo tiene en cuenta.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{event.name}</DialogTitle>
          <DialogDescription className="first-letter:uppercase">
            {relativeDayLabel(event.date, today)}
            {event.startsAt ? ` · ${event.startsAt}` : ''} · {event.reservedGuests}{' '}
            {event.reservedGuests === 1 ? 'reservada' : 'reservadas'}
            {event.capacity ? ` de ${event.capacity}` : ''}
          </DialogDescription>
        </DialogHeader>

        {!variants.length ? (
          <p className="text-sm text-muted-foreground">
            Este formato no tiene receta: sale con lo de siempre.{' '}
            <Link
              href={
                event.templateId
                  ? `/${slug}/compras/recetas?nuevo=1&formato=${event.templateId}`
                  : `/${slug}/compras/recetas`
              }
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Cargar la receta
            </Link>
          </p>
        ) : (
          <div className="space-y-5">
            {variants.length > 1 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">¿Qué variante va?</legend>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={recipeId === v.id}
                      onClick={() => setRecipeId(v.id)}
                      className={cn(
                        'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                        recipeId === v.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card hover:bg-muted',
                      )}
                    >
                      {v.variant}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="pur-guests">¿Para cuántas personas comprás?</Label>
              <Input
                id="pur-guests"
                inputMode="numeric"
                value={guests}
                onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
                placeholder={String(Math.max(event.reservedGuests, base))}
                className="h-11 w-32"
              />
              <p className="text-sm text-muted-foreground">
                Vacío: las reservadas, y nunca menos que las {base} de la receta.
              </p>
            </div>
            <Label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3.5 font-normal">
              <span>
                <span className="block font-medium">Esta fecha no suma insumos</span>
                <span className="block text-sm text-muted-foreground">
                  Por si no se hace o sale con lo de siempre.
                </span>
              </span>
              <Switch checked={skip} onCheckedChange={setSkip} />
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {variants.length ? 'Cancelar' : 'Cerrar'}
          </Button>
          {variants.length ? (
            <Button
              type="button"
              onClick={save}
              disabled={pending || (variants.length > 1 && !recipeId && !skip)}
            >
              Guardar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
