'use client'

import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { formatWeekdayDayMonth } from '@/lib/dates'
import type { EventNeed, InHouseReminder, PlannedEvent } from '@/lib/purchasing/events'
import { discardCount, saveCountLines, submitCount } from '@/lib/purchasing/kitchen-actions'
import {
  COUNT_KIND_LABELS,
  type PurCount,
  type PurCountLine,
  type PurItem,
  type PurSupplier,
  type PurZone,
} from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'
import { CountRow, type LocalLine } from './count-row'
import { CountSummary } from './count-summary'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'offline' }

export type CountScreenProps = {
  slug: string
  today: string
  count: Pick<PurCount, 'id' | 'kind' | 'countDate' | 'eventsUntil' | 'countedByName'>
  zones: PurZone[]
  items: PurItem[]
  initialLines: PurCountLine[]
  needs: Array<[string, EventNeed]>
  events: PlannedEvent[]
  inHouse: InHouseReminder[]
  inTransit: Array<[string, number]>
  suppliers: PurSupplier[]
  lowFraction: number
  reviewerName: string | null
}

const NO_ZONE = ''

function hhmm(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * El conteo por zona, en el orden del recorrido. Cada toque se guarda solo (en tandas), así se puede cortar
 * y seguir después o contar entre dos. Al final, el resumen con lo que se va a pedir y «Enviar».
 */
export function CountScreen(props: CountScreenProps) {
  const { slug, count, items, lowFraction } = props
  const router = useRouter()
  const needs = useMemo(() => new Map(props.needs), [props.needs])

  const [lines, setLines] = useState<Map<string, LocalLine>>(
    () =>
      new Map(props.initialLines.map((l) => [l.itemId, { state: l.state, quantity: l.quantity }])),
  )
  const pending = useRef(new Map<string, LocalLine | null>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<boolean> | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [view, setView] = useState<'count' | 'summary' | 'done'>('count')
  const [done, setDone] = useState<{ orders: number; products: number } | null>(null)
  const [sending, startSending] = useTransition()

  // Lo que contó otra persona (al volver a la pantalla o al tirar para actualizar) entra sin pisar lo que
  // este celular todavía no guardó.
  useEffect(() => {
    setLines((prev) => {
      const next = new Map(
        props.initialLines.map((l) => [
          l.itemId,
          { state: l.state, quantity: l.quantity } as LocalLine,
        ]),
      )
      for (const [id, local] of pending.current) {
        if (local) next.set(id, local)
        else next.delete(id)
      }
      // Lo local que ya se guardó también vale (el server puede venir un toque atrasado).
      for (const [id, local] of prev)
        if (!next.has(id) && !pending.current.has(id)) next.set(id, local)
      return next
    })
  }, [props.initialLines])

  const zones = useMemo(() => {
    const known = new Set(props.zones.map((z) => z.id))
    const withItems = props.zones.filter((z) => items.some((i) => i.zoneId === z.id))
    const orphans = items.filter((i) => !i.zoneId || !known.has(i.zoneId))
    if (!orphans.length) return withItems
    // Lo que no tiene zona suele ser lo de los eventos (los eventuales): se llama por lo que es.
    const forEvents = orphans.every((i) => i.frequency === 'occasional' || needs.has(i.id))
    return [
      ...withItems,
      {
        id: NO_ZONE,
        name: forEvents ? 'Para los eventos' : 'Sin zona',
        area: null,
        sortOrder: 1e9,
        active: true,
      },
    ]
  }, [props.zones, items, needs])
  const zoneOf = useCallback(
    (item: PurItem) =>
      item.zoneId && zones.some((z) => z.id === item.zoneId) ? item.zoneId : NO_ZONE,
    [zones],
  )
  const byZone = useMemo(() => {
    const m = new Map<string, PurItem[]>()
    for (const item of items) {
      const key = zoneOf(item)
      const list = m.get(key) ?? []
      list.push(item)
      m.set(key, list)
    }
    return m
  }, [items, zoneOf])

  const [zoneIdx, setZoneIdx] = useState(() => {
    // Se retoma en la primera zona que tiene algo sin contar.
    const i = zones.findIndex((z) =>
      (byZone.get(z.id) ?? []).some((it) => !props.initialLines.some((l) => l.itemId === it.id)),
    )
    return i < 0 ? 0 : i
  })
  const zone = zones[Math.min(zoneIdx, Math.max(0, zones.length - 1))]
  const zoneItems = zone ? (byZone.get(zone.id) ?? []) : []
  const doneCount = items.filter((i) => lines.has(i.id)).length
  const missingIn = (zoneId: string) =>
    (byZone.get(zoneId) ?? []).filter((i) => !lines.has(i.id)).length

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (saving.current) await saving.current
    if (!pending.current.size) return true
    const batch = new Map(pending.current)
    pending.current.clear()
    setSave({ kind: 'saving' })
    const run = (async () => {
      const res = await saveCountLines({
        slug,
        countId: count.id,
        lines: [...batch].map(([itemId, l]) => ({
          itemId,
          state: l?.state ?? null,
          quantity: l?.quantity ?? null,
        })),
      })
      if (!res.ok) {
        // Lo que no se guardó vuelve a la cola (salvo que ya haya algo más nuevo).
        for (const [id, l] of batch) if (!pending.current.has(id)) pending.current.set(id, l)
        if (res.message.includes('ya se envió')) {
          toast.error(res.message)
          setSave({ kind: 'idle' })
          return false
        }
        setSave({ kind: 'offline' })
        timer.current = setTimeout(() => void flush(), 5000)
        return false
      }
      setSave({ kind: 'saved', at: res.savedAt })
      return true
    })()
    saving.current = run
    try {
      return await run
    } finally {
      saving.current = null
    }
  }, [slug, count.id])

  const onMark = useCallback(
    (itemId: string, next: LocalLine | null) => {
      setLines((prev) => {
        const m = new Map(prev)
        if (next) m.set(itemId, next)
        else m.delete(itemId)
        return m
      })
      pending.current.set(itemId, next)
      setSave((s) => (s.kind === 'offline' ? s : { kind: 'saving' }))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 900)
    },
    [flush],
  )

  // Si se va de la pantalla (otra app, bloqueo), se guarda lo que haya.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [flush])

  const chipsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>(`[data-zone-idx="${zoneIdx}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [zoneIdx])

  const goZone = (i: number) => {
    setZoneIdx(i)
    setView('count')
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }
  const isLast = zoneIdx >= zones.length - 1
  const openSummary = async () => {
    await flush()
    setView('summary')
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    router.refresh()
  }

  const firstPending = zones.findIndex((z) => missingIn(z.id) > 0)

  const send = () =>
    startSending(async () => {
      const ok = await flush()
      if (!ok && pending.current.size) {
        toast.error('No se pudo guardar lo último. Revisá la conexión y probá de nuevo.')
        return
      }
      const res = await submitCount({ slug, countId: count.id })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      setDone({ orders: res.orders, products: res.products })
      setView('done')
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    })

  const discard = () =>
    startSending(async () => {
      const res = await discardCount({ slug, countId: count.id })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      router.push(`/${slug}/salon/stock`)
    })

  const reviewer = props.reviewerName?.trim() || null

  if (view === 'done' && done) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center pt-10 pb-6 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-accent text-primary">
          <Check className="size-8" aria-hidden />
        </div>
        <h1 className="mt-4 font-serif text-[2rem] font-semibold text-primary">Listo</h1>
        <p className="mt-2 max-w-sm text-muted-foreground">
          El conteo quedó cerrado.{' '}
          {done.products
            ? `${reviewer ?? 'Quien compra'} ya tiene ${done.products} ${done.products === 1 ? 'producto' : 'productos'} para revisar, en ${done.orders} ${done.orders === 1 ? 'pedido' : 'pedidos'}.`
            : 'No hace falta pedir nada: todo alcanza.'}
        </p>
        <Link
          href={`/${slug}/salon/stock`}
          className="mt-8 inline-flex h-14 w-full max-w-sm items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
        >
          Volver al inicio
        </Link>
      </div>
    )
  }

  if (view === 'summary') {
    return (
      <CountSummary
        {...props}
        lines={lines}
        needs={needs}
        zones={zones}
        sending={sending}
        reviewer={reviewer}
        firstPendingZone={firstPending}
        onBack={() => goZone(zoneIdx)}
        onCompletePending={() => goZone(firstPending < 0 ? 0 : firstPending)}
        onSend={send}
        onDiscard={discard}
      />
    )
  }

  const shownEvents = props.events.filter(
    (e) => e.status === 'sums' || e.status === 'needs_variant',
  )

  return (
    <div className="mx-auto w-full max-w-xl pb-28">
      <div className="sticky top-[calc(var(--salon-topbar-h)+env(safe-area-inset-top))] z-20 -mx-4 border-b border-border/70 bg-background/95 px-4 pt-2 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="truncate text-muted-foreground">
            {COUNT_KIND_LABELS[count.kind]} · {formatWeekdayDayMonth(count.countDate)} ·{' '}
            {count.countedByName}
          </p>
          <p className="shrink-0 tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{doneCount}</span> de {items.length}
          </p>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={doneCount}
          aria-label="Productos contados"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${items.length ? (100 * doneCount) / items.length : 0}%` }}
          />
        </div>
        <div
          ref={chipsRef}
          className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]"
        >
          {zones.map((z, i) => {
            const missing = missingIn(z.id)
            const active = i === zoneIdx
            return (
              <button
                key={z.id || 'sin-zona'}
                type="button"
                data-zone-idx={i}
                onClick={() => goZone(i)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground',
                )}
              >
                {z.name}
                <span
                  className={cn(
                    'grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold',
                    active
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : missing
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-accent text-primary',
                  )}
                >
                  {missing || <Check className="size-3" aria-label="completa" />}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => void openSummary()}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 text-sm font-medium whitespace-nowrap text-muted-foreground"
          >
            Resumen <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {zoneIdx === 0 && (shownEvents.length || props.events.length) ? (
        <div className="mt-4 rounded-2xl bg-pur-event-soft px-4 py-3 text-pur-event">
          <p className="font-semibold">
            Eventos hasta el {formatWeekdayDayMonth(count.eventsUntil)}
          </p>
          {shownEvents.length ? (
            <ul className="mt-1 space-y-0.5 text-[0.95rem]">
              {shownEvents.map((e) => (
                <li key={e.event.id}>
                  {e.label}
                  {e.status === 'needs_variant' ? (
                    <span className="font-medium">
                      {' '}
                      · falta elegir la variante: avisale a {reviewer ?? 'quien compra'}
                    </span>
                  ) : (
                    <span className="opacity-80"> · {e.guests} personas</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.95rem]">Ninguno pide insumos: salen con lo de siempre.</p>
          )}
          {shownEvents.some((e) => e.status === 'sums') ? (
            <p className="mt-1.5 text-sm opacity-90">
              Lo que piden los eventos aparece marcado: contalo exacto.
            </p>
          ) : null}
        </div>
      ) : null}

      {zone ? (
        <section className="mt-5" aria-labelledby="pur-zone-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="pur-zone-title" className="font-serif text-2xl font-semibold leading-tight">
              {zone.name}
            </h2>
            {zone.area ? <span className="text-sm text-muted-foreground">{zone.area}</span> : null}
          </div>
          <div className="card-hairline mt-3 divide-y divide-border/70 rounded-3xl bg-card px-4 shadow-xs">
            {zoneItems.map((item) => (
              <CountRow
                key={item.id}
                item={item}
                line={lines.get(item.id)}
                need={needs.get(item.id)}
                lowFraction={lowFraction}
                onMark={onMark}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="mt-8 text-center text-muted-foreground">
          No hay productos para contar. Cargalos en Compras › Insumos.
        </p>
      )}

      <div className="fixed inset-x-0 bottom-[var(--salon-tabbar-h)] z-20 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" aria-live="polite">
            {save.kind === 'saving'
              ? 'Guardando…'
              : save.kind === 'saved'
                ? `Guardado ${hhmm(save.at)}`
                : save.kind === 'offline'
                  ? 'Sin conexión: se reintenta'
                  : 'Se guarda solo'}
          </p>
          {isLast ? (
            <button
              type="button"
              onClick={() => void openSummary()}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground active:scale-[0.98]"
            >
              Ver resumen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goZone(zoneIdx + 1)}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground active:scale-[0.98]"
            >
              Siguiente zona <ArrowRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
