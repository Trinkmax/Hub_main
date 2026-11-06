'use client'

import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { formatWeekdayDayMonth } from '@/lib/dates'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import type { EventNeed } from '@/lib/purchasing/events'
import { buildSuggestion, countSummary, type SuggestedLine } from '@/lib/purchasing/suggest'
import { COUNT_KIND_LABELS, type PurZone } from '@/lib/purchasing/types'
import { formatAmount, formatQty, packsText } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'
import type { LocalLine } from './count-row'
import type { CountScreenProps } from './count-screen'

/** De dónde sale el número: «Hay 2 kg · objetivo 10 · +66 para Shrek · en camino 3». */
export function lineReason(l: SuggestedLine): string {
  const u = l.item.unit
  const parts: string[] = []
  if (l.countState == null) parts.push('No se contó')
  else if (l.countState === 'none') parts.push('No hay')
  else if (l.countState === 'enough') parts.push('Alcanza')
  else if (l.countState === 'low')
    parts.push(l.countedQty == null ? 'Poco' : `Poco (≈ ${formatAmount(l.countedQty, u)})`)
  else parts.push(`Hay ${formatAmount(l.countedQty, u)}`)
  // Lo que no se contó se pide solo por el evento: el objetivo no entra en la cuenta.
  if (l.targetQty != null && l.countState != null) parts.push(`objetivo ${formatQty(l.targetQty)}`)
  if (l.eventQty > 0) parts.push(`+${formatQty(l.eventQty)} para ${l.eventNames.join(', ')}`)
  if (l.inTransitQty > 0) parts.push(`en camino ${formatAmount(l.inTransitQty, u)}`)
  if (l.suggestedPacks == null) parts.push('sin objetivo: la cantidad la define quien compra')
  return parts.join(' · ')
}

export function CountSummary(
  props: Omit<CountScreenProps, 'needs' | 'zones'> & {
    lines: Map<string, LocalLine>
    needs: Map<string, EventNeed>
    zones: PurZone[]
    sending: boolean
    reviewer: string | null
    firstPendingZone: number
    onBack: () => void
    onCompletePending: () => void
    onSend: () => void
    onDiscard: () => void
  },
) {
  const { count, items, lines, needs, zones, lowFraction, reviewer } = props
  const orders = useMemo(
    () =>
      buildSuggestion({
        items,
        lines,
        needs,
        inTransit: new Map(props.inTransit),
        suppliers: props.suppliers,
        zones: props.zones,
        lowFraction,
        today: props.today,
      }),
    [items, lines, needs, props.inTransit, props.suppliers, props.zones, lowFraction, props.today],
  )
  const summary = useMemo(() => countSummary({ items, lines, needs }), [items, lines, needs])
  const products = orders.reduce((n, o) => n + o.lines.length, 0)
  const summing = props.events.filter((e) => e.status === 'sums')
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(orders[0] ? [orders[0].supplier?.id ?? ''] : []),
  )
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const pending = summary.pending.length
  const who = reviewer ?? 'quien compra'

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="mx-auto w-full max-w-xl pt-2 pb-28">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {COUNT_KIND_LABELS[count.kind]} · {formatWeekdayDayMonth(count.countDate)}
      </p>
      <h1 className="font-serif text-[2rem] font-semibold leading-tight tracking-[-0.015em] text-primary">
        Resumen
      </h1>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="card-hairline rounded-2xl bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Contados
          </p>
          <p className="mt-1 font-serif text-4xl font-semibold tabular-nums">{summary.counted}</p>
          <p className="text-sm text-muted-foreground">de {items.length}</p>
        </div>
        <div className="card-hairline rounded-2xl bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Para pedir
          </p>
          <p className="mt-1 font-serif text-4xl font-semibold tabular-nums">{products}</p>
          <p className="text-sm text-muted-foreground">
            {products === 1 ? 'producto' : 'productos'}
          </p>
        </div>
        <div
          className={cn(
            'rounded-2xl p-4',
            summary.none
              ? 'border border-destructive/30 bg-destructive/10'
              : 'card-hairline bg-card shadow-xs',
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            No hay
          </p>
          <p
            className={cn(
              'mt-1 font-serif text-4xl font-semibold tabular-nums',
              summary.none && 'text-destructive',
            )}
          >
            {summary.none}
          </p>
        </div>
        <div className="card-hairline rounded-2xl bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Eventos
          </p>
          <p className="mt-1 font-serif text-4xl font-semibold tabular-nums">{summing.length}</p>
          <p className="text-sm text-muted-foreground">
            hasta {relativeDayLabel(count.eventsUntil, props.today)}
          </p>
        </div>
      </div>

      {pending ? (
        <div className="mt-4 rounded-2xl bg-warning/15 p-4 text-warning-text">
          <p>
            <b>
              Faltan contar {pending} {pending === 1 ? 'producto' : 'productos'}.
            </b>{' '}
            Lo que no se cuenta no se pide (salvo lo de los eventos, que se pide completo).
          </p>
          <button
            type="button"
            onClick={props.onCompletePending}
            className="mt-3 h-12 w-full rounded-xl border border-border bg-card font-semibold text-foreground active:bg-muted"
          >
            Completar los que faltan
          </button>
        </div>
      ) : null}

      <section className="card-hairline mt-4 rounded-3xl bg-card p-4 shadow-xs">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Stock por zona
        </h2>
        <ul className="mt-3 space-y-3.5">
          {zones.map((z) => {
            const s = summary.zones.get(z.id)
            if (!s) return null
            const total = s.enough + s.low + s.none + s.pending
            if (!total) return null
            const pct = (n: number) => `${(100 * n) / total}%`
            return (
              <li key={z.id || 'sin-zona'}>
                <div className="flex items-baseline justify-between gap-3 text-[0.95rem]">
                  <span className="min-w-0 truncate">{z.name}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {s.low || s.none
                      ? `${s.low} poco · ${s.none} no hay`
                      : s.pending
                        ? `${s.pending} sin contar`
                        : 'todo alcanza'}
                  </span>
                </div>
                <div
                  className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <i className="block bg-primary" style={{ width: pct(s.enough) }} />
                  <i className="block bg-warning" style={{ width: pct(s.low) }} />
                  <i className="block bg-destructive" style={{ width: pct(s.none) }} />
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-primary" aria-hidden /> Alcanza
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-warning" aria-hidden /> Poco
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-destructive" aria-hidden /> No hay
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-muted ring-1 ring-border" aria-hidden /> Sin contar
          </span>
        </div>
      </section>

      <h2 className="mt-7 font-serif text-2xl font-semibold">Pedido sugerido</h2>
      <p className="text-muted-foreground">
        {reviewer
          ? `${reviewer} lo revisa y lo manda a cada proveedor.`
          : 'Quien compra lo revisa y lo manda a cada proveedor.'}
      </p>
      {orders.length ? (
        <div className="mt-3 space-y-3">
          {orders.map((o) => {
            const key = o.supplier?.id ?? ''
            const isOpen = open.has(key)
            return (
              <div
                key={key || 'sin-proveedor'}
                className="card-hairline rounded-3xl bg-card shadow-xs"
              >
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                  className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[1.05rem] font-semibold">
                      {o.supplier?.name ?? 'Sin proveedor'}
                    </span>
                    {o.expectedDate ? (
                      <span className="text-sm text-muted-foreground">
                        entrega {relativeDayLabel(o.expectedDate, props.today)}
                      </span>
                    ) : null}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    {o.lines.length} {o.lines.length === 1 ? 'producto' : 'productos'}
                    <ChevronDown
                      className={cn('size-4 transition-transform', isOpen && 'rotate-180')}
                      aria-hidden
                    />
                  </span>
                </button>
                {isOpen ? (
                  <ul className="divide-y divide-border/70 border-t border-border/70 px-4">
                    {o.lines.map((l) => (
                      <li key={l.item.id} className="flex items-start justify-between gap-3 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium">{l.item.name}</span>
                          <span className="block text-sm text-muted-foreground">
                            {lineReason(l)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-right font-semibold tabular-nums',
                            l.suggestedPacks == null && 'text-warning-text',
                          )}
                        >
                          {l.suggestedPacks == null
                            ? 'A definir'
                            : packsText({
                                packs: l.suggestedPacks,
                                packLabel: l.item.packLabel,
                                packSize: l.item.packSize,
                                unit: l.item.unit,
                              })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="card-hairline mt-3 rounded-3xl bg-card p-4 text-muted-foreground shadow-xs">
          No hace falta pedir nada: todo lo contado alcanza.
        </p>
      )}

      {props.inHouse.length ? (
        <section className="mt-6 rounded-3xl border border-border/70 bg-muted/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Se hace en el local
          </h2>
          <ul className="mt-2 space-y-1 text-[0.95rem]">
            {props.inHouse.map((r) => (
              <li key={`${r.eventLabel}-${r.name}`}>
                {r.name}
                {r.qty != null ? ` · ${formatQty(r.qty)} ${r.unit ?? ''}` : ''}
                <span className="text-muted-foreground"> · {r.eventLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => setConfirmDiscard(true)}
          className="min-h-11 text-sm text-muted-foreground underline underline-offset-4"
        >
          Descartar este conteo
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-[var(--salon-tabbar-h)] z-20 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={props.onBack}
            className="h-12 shrink-0 rounded-2xl border border-border bg-card px-5 font-semibold active:bg-muted"
          >
            Volver
          </button>
          <button
            type="button"
            disabled={props.sending}
            onClick={() => (pending ? setConfirmSend(true) : props.onSend())}
            className="h-12 min-w-0 flex-1 truncate rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
          >
            {props.sending ? 'Enviando…' : reviewer ? `Enviar a ${reviewer}` : 'Enviar a revisión'}
          </button>
        </div>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Faltan contar {pending} {pending === 1 ? 'producto' : 'productos'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Lo que no se contó no se pide (salvo lo de los eventos). ¿Lo mandás igual a {who}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir contando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSend(false)
                props.onSend()
              }}
            >
              Enviar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este conteo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra lo contado y no se arma ningún pedido. Sirve si se empezó por error.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setConfirmDiscard(false)
                props.onDiscard()
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
