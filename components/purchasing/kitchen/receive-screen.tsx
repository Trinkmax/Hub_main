'use client'

import { Check, ChevronLeft, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import { type ReceiveDifference, receiveOrder } from '@/lib/purchasing/kitchen-actions'
import { expectedPacks, type PurOrder } from '@/lib/purchasing/types'
import { packsText } from '@/lib/purchasing/units'
import { differenceText } from '@/lib/purchasing/whatsapp'
import { cn } from '@/lib/utils'
import { rememberedName, rememberName } from './new-count-form'

type Mark = { state: 'ok' | 'partial' | 'missing'; packs: number }

/**
 * Recibir un pedido: «Llegó todo bien» de un toque o producto por producto (llegó / otra cantidad / no
 * llegó). Si algo vino distinto, le aparece a quien compra para reclamar. No suma stock.
 */
export function ReceiveScreen({
  slug,
  today,
  order,
  supplierName,
  reviewerName,
  defaultName,
}: {
  slug: string
  today: string
  order: PurOrder
  supplierName: string
  reviewerName: string | null
  defaultName: string | null
}) {
  const lines = order.lines.filter((l) => expectedPacks(l) > 0)
  const notComing = order.lines.filter((l) => expectedPacks(l) <= 0)
  const [who, setWho] = useState(defaultName ?? '')
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map())
  const [confirmAll, setConfirmAll] = useState(false)
  const [result, setResult] = useState<{
    status: 'completed' | 'with_differences'
    differences: ReceiveDifference[]
  } | null>(null)
  const [pending, start] = useTransition()
  const reviewer = reviewerName?.trim() || null

  useEffect(() => {
    const saved = rememberedName()
    if (saved) setWho(saved)
  }, [])

  const setMark = (id: string, m: Mark | null) =>
    setMarks((prev) => {
      const next = new Map(prev)
      if (m) next.set(id, m)
      else next.delete(id)
      return next
    })

  const submit = (all: boolean) => {
    const name = who.trim()
    if (!name) {
      toast.error('Escribí quién recibe.')
      document.getElementById('pur-receiver')?.focus()
      return
    }
    rememberName(name)
    start(async () => {
      const res = await receiveOrder({
        slug,
        orderId: order.id,
        receivedByName: name,
        lines: lines.map((l) => {
          const m = all ? undefined : marks.get(l.id)
          return { id: l.id, state: m?.state ?? 'ok', packs: m ? m.packs : expectedPacks(l) }
        }),
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      setResult({ status: res.status, differences: res.differences })
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    })
  }

  if (result) {
    const ok = result.status === 'completed'
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center pt-10 pb-6 text-center">
        <div
          className={cn(
            'grid size-16 place-items-center rounded-full',
            ok ? 'bg-accent text-primary' : 'bg-destructive/10 text-destructive',
          )}
        >
          {ok ? (
            <Check className="size-8" aria-hidden />
          ) : (
            <span className="font-serif text-3xl font-bold">!</span>
          )}
        </div>
        <h1 className="mt-4 font-serif text-[2rem] font-semibold leading-tight text-primary">
          {ok ? 'Recibido' : 'Recibido con diferencias'}
        </h1>
        {ok ? (
          <p className="mt-2 text-muted-foreground">
            Llegó todo: el pedido de {supplierName} quedó cerrado.
          </p>
        ) : (
          <div className="mt-2 text-muted-foreground">
            <p>{reviewer ?? 'Quien compra'} lo ve en Compras para resolverlo con el proveedor:</p>
            <ul className="mt-2 space-y-0.5 text-foreground">
              {result.differences.map((d) => (
                <li key={d.name}>
                  {d.name}:{' '}
                  {differenceText({
                    name: d.name,
                    packs: d.expectedPacks,
                    packLabel: d.packLabel,
                    packSize: d.packSize,
                    unit: d.unit,
                    receivedPacks: d.receivedPacks,
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-8 grid w-full max-w-sm grid-cols-[auto_1fr] gap-3">
          <Link
            href={`/${slug}/salon/stock/recibir`}
            className="inline-flex h-14 items-center justify-center rounded-2xl border border-border bg-card px-5 font-semibold"
          >
            Otro pedido
          </Link>
          <Link
            href={`/${slug}/salon/stock`}
            className="inline-flex h-14 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground"
          >
            Inicio
          </Link>
        </div>
      </div>
    )
  }

  const missing = lines.filter((l) => !marks.has(l.id)).length

  return (
    <div className="mx-auto w-full max-w-xl pb-28">
      <Link
        href={`/${slug}/salon/stock/recibir`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Pedidos en camino
      </Link>
      <h1 className="mt-1 font-serif text-[2rem] font-semibold leading-tight tracking-[-0.015em] text-primary">
        {supplierName}
      </h1>
      <p className="text-muted-foreground">
        {lines.length} {lines.length === 1 ? 'producto' : 'productos'} ·{' '}
        {order.expectedDate
          ? `entrega ${relativeDayLabel(order.expectedDate, today)}`
          : 'sin fecha de entrega'}
      </p>

      {order.status === 'sent' ? (
        <p className="mt-3 rounded-2xl bg-warning/15 px-4 py-3 text-[0.95rem] text-warning-text">
          {reviewer ?? 'Quien compra'} todavía no confirmó este pedido con el proveedor: revisalo
          contra el remito.
        </p>
      ) : null}
      {order.kitchenNote ? (
        <div className="mt-3 rounded-2xl bg-pur-event-soft px-4 py-3 text-pur-event">
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">
            Nota de {reviewer ?? 'compras'}
          </p>
          <p className="mt-0.5 text-[0.95rem]">{order.kitchenNote}</p>
        </div>
      ) : null}

      <div className="mt-5 space-y-1.5">
        <Label htmlFor="pur-receiver">Quién recibe</Label>
        <Input
          id="pur-receiver"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Tu nombre"
          autoComplete="given-name"
          maxLength={60}
          className="h-12 text-base"
        />
      </div>

      <button
        type="button"
        onClick={() => setConfirmAll(true)}
        disabled={pending}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-card text-lg font-semibold text-primary active:bg-accent disabled:opacity-60"
      >
        <Check className="size-5" aria-hidden /> Llegó todo bien
      </button>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Si algo vino distinto, marcá producto por producto.
      </p>

      <ul className="mt-4 space-y-3">
        {lines.map((l) => {
          const m = marks.get(l.id)
          const expected = expectedPacks(l)
          const viene = packsText({
            packs: expected,
            packLabel: l.packLabel,
            packSize: l.packSize,
            unit: l.unit,
          })
          return (
            <li
              key={l.id}
              className={cn(
                'rounded-3xl p-4 shadow-xs',
                !m && 'card-hairline bg-card',
                m?.state === 'ok' && 'bg-accent',
                m?.state === 'missing' && 'bg-destructive/10',
                m?.state === 'partial' && 'border-2 border-warning/60 bg-card',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[1.05rem] font-semibold leading-snug">{l.name}</p>
                  <p className="text-sm text-muted-foreground">Viene: {viene}</p>
                  {l.eventNames.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {l.eventNames.map((e) => (
                        <span
                          key={e}
                          className="rounded-lg bg-pur-event-soft px-2 py-0.5 text-[0.8rem] font-semibold text-pur-event"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {m ? (
                  <button
                    type="button"
                    onClick={() => setMark(l.id, null)}
                    className="min-h-11 shrink-0 px-1 text-sm font-medium text-muted-foreground underline underline-offset-4"
                  >
                    cambiar
                  </button>
                ) : null}
              </div>

              {!m ? (
                <div className="mt-3 grid grid-cols-[1fr_1.4fr_1fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setMark(l.id, { state: 'ok', packs: expected })}
                    className="flex h-12 items-center justify-center gap-1 rounded-xl border border-border bg-card font-semibold text-primary active:bg-muted"
                  >
                    <Check className="size-4" aria-hidden /> Llegó
                  </button>
                  <button
                    type="button"
                    onClick={() => setMark(l.id, { state: 'partial', packs: expected })}
                    className="flex h-12 items-center justify-center whitespace-nowrap rounded-xl border border-border bg-card px-1 text-[0.95rem] font-semibold text-warning-text active:bg-muted"
                  >
                    Otra cantidad
                  </button>
                  <button
                    type="button"
                    onClick={() => setMark(l.id, { state: 'missing', packs: 0 })}
                    className="flex h-12 items-center justify-center gap-1 rounded-xl border border-border bg-card font-semibold text-destructive active:bg-muted"
                  >
                    <X className="size-4" aria-hidden /> No llegó
                  </button>
                </div>
              ) : m.state === 'partial' ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.95rem] text-muted-foreground">¿Cuántas llegaron?</span>
                    <QtyStepper
                      value={m.packs}
                      onChange={(n) => setMark(l.id, { state: 'partial', packs: n ?? 0 })}
                      label={`Cuánto llegó de ${l.name}`}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    En la misma unidad del pedido:{' '}
                    {packsText({
                      packs: m.packs,
                      packLabel: l.packLabel,
                      packSize: l.packSize,
                      unit: l.unit,
                    })}
                  </p>
                </div>
              ) : (
                <p
                  className={cn(
                    'mt-2 inline-flex items-center gap-1.5 font-semibold',
                    m.state === 'ok' ? 'text-primary' : 'text-destructive',
                  )}
                >
                  {m.state === 'ok' ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <X className="size-4" aria-hidden />
                  )}
                  {m.state === 'ok' ? 'Llegó' : 'No llegó'}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {notComing.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No vienen (el proveedor no los tenía): {notComing.map((l) => l.name).join(', ')}.
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-[var(--salon-tabbar-h)] z-20 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto w-full max-w-xl px-4 py-2.5">
          <button
            type="button"
            disabled={missing > 0 || pending}
            onClick={() => submit(false)}
            className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Guardando…' : missing > 0 ? `Terminar · faltan ${missing}` : 'Terminar'}
          </button>
        </div>
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Llegó todo bien?</AlertDialogTitle>
            <AlertDialogDescription>
              Se marcan {lines.length === 1 ? 'el producto' : `los ${lines.length} productos`} como
              recibidos y el pedido de {supplierName} queda cerrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAll(false)
                submit(true)
              }}
            >
              Sí, llegó todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
