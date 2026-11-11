'use client'

import { ChevronDown, MessageCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { QtyStepper } from '@/components/purchasing/qty-stepper'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { effectiveDeliveryDate, onDayLabel, relativeDayLabel } from '@/lib/purchasing/dates'
import type { SupplierDeadline } from '@/lib/purchasing/deadlines'
import type { PlannedEvent } from '@/lib/purchasing/events'
import { approveOrder, saveDraft, skipOrder } from '@/lib/purchasing/order-actions'
import type { PurItem, PurOrder, PurOrderLine, PurSupplier, PurZone } from '@/lib/purchasing/types'
import { formatAmount, formatQty, packsText, parseQty } from '@/lib/purchasing/units'
import { orderMessage, whatsappLink } from '@/lib/purchasing/whatsapp'
import { cn } from '@/lib/utils'
import { ItemPicker } from './item-picker'

type Added = { key: string; item: PurItem; packs: number }

function hayText(l: PurOrderLine): string {
  if (l.addedByHand && l.countState == null) return '–'
  switch (l.countState) {
    case null:
      return 'no se contó'
    case 'enough':
      return 'alcanza'
    case 'none':
      return formatAmount(0, l.unit)
    case 'low':
      return `≈ ${formatAmount(l.countedQty, l.unit)}`
    default:
      return formatAmount(l.countedQty, l.unit)
  }
}

/** Un borrador por proveedor: lo que el sistema calculó, para corregir solo lo que no cierra y mandarlo. */
export function DraftCard({
  slug,
  today,
  order,
  supplier,
  suppliers,
  items,
  zones,
  senderName,
  defaultOpen,
  eventRows = [],
}: {
  slug: string
  today: string
  order: PurOrder
  supplier: PurSupplier | null
  suppliers: readonly PurSupplier[]
  items: readonly PurItem[]
  zones: readonly PurZone[]
  senderName: string
  defaultOpen: boolean
  /** Los eventos que lleva este pedido, con su plazo: avisa si llega tarde o si hay que mandarlo hoy. */
  eventRows?: { event: PlannedEvent; row: SupplierDeadline }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)
  const [qty, setQty] = useState<Map<string, number | null>>(new Map())
  const [added, setAdded] = useState<Added[]>([])
  const [note, setNote] = useState(order.supplierNote ?? '')
  const [pickSupplier, setPickSupplier] = useState<string>('')
  const [remember, setRemember] = useState(true)
  const [newItem, setNewItem] = useState<string | null>(null)
  const [newQty, setNewQty] = useState('')
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [pending, start] = useTransition()

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const zoneName = useMemo(() => new Map(zones.map((z) => [z.id, z.name])), [zones])
  const supplierNames = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const chosen = supplier ?? suppliers.find((s) => s.id === pickSupplier) ?? null
  const packsOf = (l: PurOrderLine) => (qty.has(l.id) ? (qty.get(l.id) ?? null) : l.orderedPacks)
  const expected = effectiveDeliveryDate(order.expectedDate, chosen, today)
  // Con la entrega de este pedido: ¿llega a tiempo para cada evento que lleva? ¿Hay que mandarlo hoy?
  const lateFor = eventRows.filter((r) => expected != null && expected > r.row.mustArriveBy)
  const sendToday = eventRows.filter(
    (r) => !lateFor.includes(r) && r.row.orderBy != null && r.row.orderBy <= today,
  )

  const effective = [
    ...order.lines.map((l) => ({
      name: l.name,
      packs: packsOf(l),
      packLabel: l.packLabel,
      packSize: l.packSize,
      unit: l.unit,
    })),
    ...added.map((a) => ({
      name: a.item.name,
      packs: a.packs,
      packLabel: a.item.packLabel,
      packSize: a.item.packSize,
      unit: a.item.unit,
    })),
  ]
  const toOrder = effective.filter((l) => (l.packs ?? 0) > 0)
  const undefinedNames = effective.filter((l) => l.packs == null).map((l) => l.name)
  const message = orderMessage({
    senderName,
    contactName: chosen?.contactName ?? null,
    expectedDate: expected,
    lines: toOrder.map((l) => ({ ...l, packs: l.packs ?? 0 })),
    note: note.trim() || null,
  })
  const waUrl = chosen ? whatsappLink(chosen.whatsapp, message) : null
  const dirty =
    qty.size > 0 ||
    added.length > 0 ||
    note.trim() !== (order.supplierNote ?? '').trim() ||
    (!supplier && Boolean(pickSupplier))

  const payload = () => ({
    slug,
    orderId: order.id,
    lines: order.lines.map((l) => ({ id: l.id, orderedPacks: packsOf(l) })),
    added: added.map((a) => ({ itemId: a.item.id, packs: a.packs })),
    supplierNote: note.trim() || null,
    supplierId: supplier ? null : pickSupplier || null,
    rememberSupplier: remember,
  })

  const reset = () => {
    setQty(new Map())
    setAdded([])
  }

  const problem = (): string | null => {
    if (!chosen) return 'Elegí a qué proveedor se le pide.'
    if (undefinedNames.length) return `Completá cuánto pedir de: ${undefinedNames.join(', ')}.`
    if (!toOrder.length) return 'No hay nada para pedir: usá «Hoy no pido».'
    return null
  }

  const approve = () =>
    start(async () => {
      const res = await approveOrder(payload())
      if (!res.ok) {
        toast.error(`No se marcó como enviado: ${res.message}`)
        return
      }
      toast.success(
        `Pedido a ${chosen?.name ?? 'el proveedor'} enviado. Cuando conteste, confirmalo abajo.`,
      )
      reset()
      router.refresh()
    })

  const save = () =>
    start(async () => {
      const res = await saveDraft(payload())
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Cambios guardados.')
      reset()
      router.refresh()
    })

  const skip = () =>
    start(async () => {
      const res = await skipOrder({ slug, orderId: order.id })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Listo: hoy no se le pide. Lo que faltaba vuelve a salir en el próximo conteo.')
      router.refresh()
    })

  const addLine = () => {
    const item = newItem ? itemsById.get(newItem) : undefined
    const n = parseQty(newQty)
    if (!item || !n) {
      toast.error('Elegí un producto y una cantidad.')
      return
    }
    setAdded((prev) => [...prev, { key: `${item.id}-${prev.length}`, item, packs: n }])
    setNewItem(null)
    setNewQty('')
  }

  const exclude = new Set<string>([
    ...order.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v)),
    ...added.map((a) => a.item.id),
  ])
  const count = order.lines.length + added.length

  return (
    <article
      className={cn(
        'overflow-hidden rounded-3xl bg-card shadow-xs transition-colors',
        open ? 'border-2 border-primary/70' : 'card-hairline',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-5 py-4 text-left',
          open && 'bg-accent/60',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold">
            {supplier?.name ?? 'Sin proveedor'}
          </span>
          <span className="block text-sm text-muted-foreground">
            {count} {count === 1 ? 'producto' : 'productos'}
            {expected
              ? ` · entrega ${relativeDayLabel(expected, today)}`
              : chosen
                ? ' · sin días de entrega'
                : ''}
            {chosen && !chosen.whatsapp ? ' · sin WhatsApp cargado' : ''}
          </span>
          {lateFor.length ? (
            <span className="block text-sm font-semibold text-destructive">
              Llega tarde para {lateFor.map((r) => r.event.event.name).join(', ')}
            </span>
          ) : sendToday.length ? (
            <span className="block text-sm font-semibold text-warning-text">
              Mandalo hoy: lleva lo de {sendToday.map((r) => r.event.event.name).join(', ')}
            </span>
          ) : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          {open ? 'Cerrar' : 'Abrir'}
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>

      {open ? (
        <div className="space-y-4 px-4 pt-1 pb-5 sm:px-5">
          {lateFor.length || sendToday.length ? (
            <ul className="space-y-1 rounded-2xl bg-pur-event-soft px-4 py-3 text-[0.95rem] text-pur-event">
              {lateFor.map(({ event, row }) => (
                <li key={event.event.id}>
                  Para <span className="font-semibold">{event.event.name}</span> (
                  {relativeDayLabel(event.event.date, today)}) tiene que llegar hasta{' '}
                  {onDayLabel(row.mustArriveBy, today)} y con este pedido llega{' '}
                  {expected ? onDayLabel(expected, today) : 'después'}: pedile que lo traiga antes.
                </li>
              ))}
              {sendToday.map(({ event }) => (
                <li key={event.event.id}>
                  Lleva lo de <span className="font-semibold">{event.event.name}</span> (
                  {relativeDayLabel(event.event.date, today)}): mandalo hoy para que llegue{' '}
                  {expected ? onDayLabel(expected, today) : 'a tiempo'}.
                </li>
              ))}
            </ul>
          ) : null}
          {!supplier ? (
            <div className="rounded-2xl bg-warning/15 p-4 text-[0.95rem] text-warning-text">
              <p className="font-semibold">Estos productos no tienen proveedor.</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <select
                  value={pickSupplier}
                  onChange={(e) => setPickSupplier(e.target.value)}
                  className="h-11 rounded-xl border border-input bg-background px-3 text-foreground"
                  aria-label="Proveedor para este pedido"
                >
                  <option value="">¿A quién se lo pedís?</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Label className="inline-flex items-center gap-2 text-sm font-normal text-foreground">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                  Que queden con ese proveedor
                </Label>
              </div>
            </div>
          ) : null}

          {chosen && (!chosen.whatsapp || !chosen.deliveryWeekdays.length) ? (
            <p className="text-sm text-warning-text">
              {!chosen.whatsapp
                ? 'Sin WhatsApp cargado: el mensaje se copia para que lo mandes vos. '
                : ''}
              {!chosen.deliveryWeekdays.length
                ? 'Sin días de entrega: el mensaje le pregunta cuándo puede. '
                : ''}
              <Link
                href={`/${slug}/compras/proveedores?editar=${chosen.id}`}
                className="font-semibold underline underline-offset-4"
              >
                Completar {chosen.name}
              </Link>
            </p>
          ) : null}

          <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,0.8fr))_auto_minmax(0,1.1fr)] gap-3 px-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
            <span>Producto</span>
            <span className="text-right">Hay</span>
            <span className="text-right">Objetivo</span>
            <span className="text-right">Eventos</span>
            <span className="text-right">En camino</span>
            <span className="text-right">Sugerido</span>
            <span className="text-center">A pedir</span>
            <span>Se compra</span>
          </div>

          <ul className="divide-y divide-border/70 md:border-t md:border-border/70">
            {order.lines.map((l) => {
              const packs = packsOf(l)
              const removed = packs === 0
              const item = l.itemId ? itemsById.get(l.itemId) : undefined
              const zone = item?.zoneId ? zoneName.get(item.zoneId) : undefined
              return (
                <li
                  key={l.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 md:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,0.8fr))_auto_minmax(0,1.1fr)]"
                >
                  <div className={cn('col-span-2 min-w-0 md:col-span-1', removed && 'opacity-50')}>
                    <p className={cn('font-semibold', removed && 'line-through')}>{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {zone ?? (l.addedByHand ? 'Agregado a mano' : '')}
                    </p>
                    {l.eventNames.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.eventNames.map((e) => (
                          <span
                            key={e}
                            className="rounded-md bg-pur-event-soft px-1.5 py-0.5 text-[0.75rem] font-semibold text-pur-event"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      {l.countState == null
                        ? l.addedByHand
                          ? 'Agregado a mano'
                          : 'No se contó'
                        : `Hay ${hayText(l)}`}
                      {l.targetQty != null && l.countState != null
                        ? ` · objetivo ${formatQty(l.targetQty)}`
                        : ''}
                      {l.eventQty > 0 ? ` · eventos +${formatQty(l.eventQty)}` : ''}
                      {l.inTransitQty > 0 ? ` · en camino ${formatQty(l.inTransitQty)}` : ''}
                      {l.suggestedPacks != null ? ` · sugerido ${formatQty(l.suggestedPacks)}` : ''}
                    </p>
                  </div>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {hayText(l)}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {formatQty(l.targetQty)}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {l.eventQty > 0 ? `+${formatQty(l.eventQty)}` : '–'}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {l.inTransitQty > 0 ? formatQty(l.inTransitQty) : '–'}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {l.suggestedPacks == null ? (
                      l.addedByHand ? (
                        'a mano'
                      ) : (
                        <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-warning-text">
                          a definir
                        </span>
                      )
                    ) : (
                      formatQty(l.suggestedPacks)
                    )}
                  </span>
                  <div className="flex items-center gap-1 justify-self-start md:justify-self-center">
                    <QtyStepper
                      size="sm"
                      value={packs}
                      placeholder="definir"
                      label={`Cuánto pedir de ${l.name}`}
                      onChange={(n) =>
                        setQty((prev) => {
                          const next = new Map(prev)
                          if (n === l.orderedPacks) next.delete(l.id)
                          else next.set(l.id, n)
                          return next
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setQty((prev) => new Map(prev).set(l.id, 0))}
                      aria-label={`Quitar ${l.name} del pedido`}
                      className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <span
                    className={cn(
                      'justify-self-end text-sm font-medium md:justify-self-start',
                      packs == null && 'text-warning-text',
                    )}
                  >
                    {packs == null
                      ? 'a definir'
                      : packsText({
                          packs,
                          packLabel: l.packLabel,
                          packSize: l.packSize,
                          unit: l.unit,
                        })}
                  </span>
                </li>
              )
            })}
            {added.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{a.item.name}</p>
                  <p className="text-xs text-muted-foreground">Agregado a mano · sin guardar</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {packsText({
                      packs: a.packs,
                      packLabel: a.item.packLabel,
                      packSize: a.item.packSize,
                      unit: a.item.unit,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAdded((prev) => prev.filter((x) => x.key !== a.key))}
                    aria-label={`Sacar ${a.item.name}`}
                    className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row">
            <ItemPicker
              className="sm:flex-1"
              items={items}
              supplierNames={supplierNames}
              preferSupplierId={chosen?.id ?? null}
              excludeIds={exclude}
              value={newItem}
              onChange={setNewItem}
            />
            <div className="flex gap-2">
              <input
                inputMode="decimal"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="Cant."
                aria-label="Cantidad a agregar"
                className="h-11 w-24 rounded-xl border border-input bg-background px-3 text-base"
              />
              <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={addLine}>
                Agregar
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`note-${order.id}`}>Nota para el proveedor (sale en el WhatsApp)</Label>
            <Textarea
              id={`note-${order.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Ej.: entregar antes de las 11"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmSkip(true)}
              disabled={pending}
              className="min-h-11 px-2 text-sm font-medium text-muted-foreground underline underline-offset-4"
            >
              Hoy no pido
            </button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={save}
              disabled={pending || !dirty}
            >
              Guardar cambios
            </Button>
            <a
              href={waUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={pending}
              onClick={(e) => {
                const why = problem()
                if (why || pending) {
                  e.preventDefault()
                  if (why) toast.error(why)
                  return
                }
                if (!waUrl) {
                  e.preventDefault()
                  void navigator.clipboard?.writeText(message).then(
                    () => toast.message('Copiamos el mensaje: pegalo en el chat del proveedor.'),
                    () => toast.message(message),
                  )
                }
                approve()
              }}
              className={cn(
                'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-xs hover:bg-primary/90',
                pending && 'pointer-events-none opacity-60',
              )}
            >
              <MessageCircle className="size-4" aria-hidden />
              {waUrl ? 'Aprobar y abrir WhatsApp' : 'Aprobar y copiar mensaje'}
            </a>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Hoy no le pedís a {supplier?.name ?? 'este proveedor'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El borrador se descarta. Si algo sigue faltando, vuelve a aparecer en el próximo
              conteo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSkip(false)
                skip()
              }}
            >
              Hoy no pido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
