'use client'

import { ChevronLeft, ChevronRight, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { formatCentsShort } from '@/lib/money/format'
import {
  fireTicket,
  markServed,
  refreshMenu,
  refreshSession,
  requestBill,
  setStockout,
  updateTable,
} from '@/lib/pos/actions'
import { MAX_LINES, priceDraft, quantityByItem } from '@/lib/pos/order/cart'
import { clockAt, minutesSince } from '@/lib/pos/order/clock'
import { buildMenuIndex, needsChoice } from '@/lib/pos/order/menu-index'
import { entryStatus, entryTotalCents, makeEntry, type OutboxEntry } from '@/lib/pos/order/outbox'
import { pickRepeatRound } from '@/lib/pos/order/repeat-round'
import {
  applyOverlay,
  barPrimary,
  NO_OVERLAY,
  newlyReady,
  nextCourse,
  type Overlay,
  summarizeSession,
  tandaNumbers,
  ticketDisplay,
} from '@/lib/pos/order/tickets'
import type { MenuItem, PosMenu, SessionDetail, SessionItem } from '@/lib/pos/types'
import { usePosPoke } from '@/lib/pos/use-poke'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { ActionBar, BlockedNote, SendRow } from './action-bar'
import { buzz } from './haptics'
import { InfoStrip, ServiceAlerts } from './info-strip'
import { LineSheet, type LineTarget, REASON_SOLD_OUT } from './line-sheet'
import { type OptionsChoice, OptionsSheet, type OptionsTarget } from './options-sheet'
import { newId } from './order-storage'
import { PosOutboxRunner } from './outbox-runner'
import { PartySheet } from './party-sheet'
import { ProductPicker } from './product-picker'
import { StockSheet } from './stock-sheet'
import { DraftTicket, PendingTicket, SentTicket } from './ticket-card'
import { useLocalOrder } from './use-local-order'
import { useNow } from './use-now'
import { useOnline } from './use-online'
import './order.css'
import '../ui/pos-toast.css'

/**
 * La comanda de una mesa: la pantalla del mozo parado al lado, con el celular en una mano.
 *
 * Arriba, la mesa en una fila. En el medio, las tandas como comandas de papel, en el orden en que
 * se pidieron, y al final la que se está armando. Abajo, un solo botón que manda. La carta se abre
 * encima (en el celular) o vive al lado (con ancho).
 *
 * Todo responde al toque: lo que el mozo hace se ve ya y el servidor lo confirma después. Un pedido
 * no se pierde nunca: se guarda en el celular y se manda solo cuando vuelve la señal.
 */

type Props = {
  slug: string
  initial: SessionDetail
  initialMenu: PosMenu
  timeZone: string
  /** Mesa recién abierta o sin pedido: derecho a cargar. */
  startAdding: boolean
  /** El botón de la cuenta de quien trabaja, armado en la página. */
  account?: React.ReactNode
}

type Echo = { entry: OutboxEntry; ticketId: string }
type Failure = { ok: false; message: string; code: string }
const NO_SIGNAL: Failure = {
  ok: false,
  message: 'No hay señal: no se guardó. Probá de nuevo cuando vuelva.',
  code: 'network',
}

/** «Mesa 12». Lo que no es una mesa del salón se llama por lo que es. */
function tableTitle(detail: SessionDetail): string {
  if (detail.table) return `Mesa ${detail.table.label}`
  return detail.session.kind === 'delivery' ? 'Delivery' : 'Venta rápida'
}

/**
 * Una lectura por vez. Si piden otra mientras una viaja, se hace una más al terminar (una sola): así
 * lo que se muestra nunca es más viejo que el último pedido de leer.
 */
function useCoalesced(task: () => Promise<boolean>): () => Promise<boolean> {
  const latest = useRef(task)
  useEffect(() => {
    latest.current = task
  })
  const running = useRef<Promise<boolean> | null>(null)
  const queued = useRef<Promise<boolean> | null>(null)
  return useCallback(() => {
    const start = (): Promise<boolean> => {
      const run = latest.current().finally(() => {
        if (running.current === run) running.current = null
      })
      running.current = run
      return run
    }
    if (!running.current) return start()
    if (!queued.current) {
      const after = () => {
        queued.current = null
        return start()
      }
      queued.current = running.current.then(after, after)
    }
    return queued.current
  }, [])
}

export function OrderScreen({ slug, initial, initialMenu, timeZone, startAdding, account }: Props) {
  const router = useRouter()
  const sessionId = initial.session.id
  const branchId = initial.session.branch_id

  const [server, setServer] = useState(initial)
  const [menu, setMenu] = useState(initialMenu)
  const [overlay, setOverlay] = useState<Overlay>(NO_OVERLAY)
  const [pickerOpen, setPickerOpen] = useState(startAdding)
  const [echoes, setEchoes] = useState<Echo[]>([])
  const [options, setOptions] = useState<OptionsTarget | null>(null)
  const [lineTarget, setLineTarget] = useState<LineTarget | null>(null)
  const [partyOpen, setPartyOpen] = useState(false)
  const [stockItem, setStockItem] = useState<MenuItem | null>(null)
  const [billBusy, setBillBusy] = useState(false)
  const [firing, setFiring] = useState<string[]>([])
  const [alive, setAlive] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const [endTick, setEndTick] = useState(0)

  // Si la página se vuelve a leer entera (al volver a la app), manda lo nuevo.
  useEffect(() => setServer(initial), [initial])
  useEffect(() => setMenu(initialMenu), [initialMenu])
  useEffect(() => setAlive(true), [])

  // ── Lecturas ──
  const reloadSession = useCoalesced(async () => {
    try {
      const result = await refreshSession(slug, sessionId)
      if (!result.ok) return false
      setServer(result.data)
      return true
    } catch {
      return false
    }
  })
  const reloadMenu = useCoalesced(async () => {
    try {
      const result = await refreshMenu(slug, branchId)
      if (!result.ok) return false
      setMenu(result.data)
      return true
    } catch {
      return false
    }
  })
  const reloadSessionSoon = useDebouncedRefresh(() => void reloadSession(), 250)
  const reloadMenuSoon = useDebouncedRefresh(() => void reloadMenu(), 250)

  const live = usePosPoke(branchId, (what, pokedSession) => {
    if (what === 'menu') {
      reloadMenuSoon()
      return
    }
    if (pokedSession === sessionId) reloadSessionSoon()
    else if (pokedSession === null) {
      // Volvió el canal: lo que pasó mientras estuvo caído no se reenvía, así que se lee todo.
      reloadSessionSoon()
      reloadMenuSoon()
    }
  })
  // Red de seguridad: si un aviso en vivo se pierde, igual se pone al día.
  useVisibleInterval(() => void reloadSession(), 45_000)

  const online = useOnline()
  const offline = !online || live === 'offline'

  // ── Lo que no llegó al servidor ──
  const local = useLocalOrder({
    slug,
    sessionId,
    label: tableTitle(initial),
    online,
    onSent: (entry, sent) => {
      // La tanda ya está en el servidor: queda a la vista hasta que la lectura nueva la traiga.
      setEchoes((list) => [
        ...list.filter((e) => e.entry.key !== entry.key),
        { entry, ticketId: sent.ticketId },
      ])
      void reloadSession().then((ok) => {
        if (ok) setEchoes((list) => list.filter((e) => e.entry.key !== entry.key))
      })
    },
    onRejected: (_entry, message) => {
      toast.error(message, {
        description: 'La tanda volvió al borrador: corregila y mandala de nuevo.',
        duration: 9000,
      })
      void reloadMenu()
      void reloadSession()
    },
  })
  const { draft, dispatch, outbox } = local

  // ── Lo que se ve ──
  const now = useNow(server.now)
  const view = useMemo(
    () => applyOverlay(server, overlay, new Date(now).toISOString()),
    [server, overlay, now],
  )
  const index = useMemo(() => buildMenuIndex(menu), [menu])
  const totals = useMemo(() => priceDraft(draft, index), [draft, index])
  const quantities = useMemo(() => quantityByItem(draft), [draft])
  const summary = useMemo(() => summarizeSession(view.tickets), [view.tickets])
  const round = useMemo(() => pickRepeatRound(view.tickets, index), [view.tickets, index])

  const { session, table } = view
  const closed = session.status !== 'open'
  const title = tableTitle(view)
  const customerName = view.customer
    ? `${view.customer.first_name} ${view.customer.last_name}`.trim()
    : null
  const name = session.alias || view.reservation?.name || customerName || null

  // Las confirmadas que la lectura todavía no trajo, y después las que están viajando.
  const confirmed = echoes.filter((e) => !view.tickets.some((t) => t.id === e.ticketId))
  const pending = [...confirmed.map((e) => e.entry), ...outbox]
  const pendingCourses = pending.map((e) => e.course)
  const numbers = tandaNumbers([...view.tickets.map((t) => t.course), ...pendingCourses])
  const draftNumber = (numbers[numbers.length - 1] ?? 0) + 1
  const course = nextCourse(view.tickets, pendingCourses)
  const primary = closed ? ({ kind: 'add' } as const) : barPrimary(totals.units, summary)
  const fireNumber =
    primary.kind === 'fire'
      ? (numbers[view.tickets.findIndex((t) => t.id === primary.ticketId)] ?? null)
      : null
  const empty = !summary.hasOrders && pending.length === 0 && totals.units === 0
  // Lo que ya se mandó (aunque el servidor todavía no lo haya sumado). Lo sin enviar va aparte.
  const tableTotal = session.total_cents + pending.reduce((sum, e) => sum + entryTotalCents(e), 0)

  // ── Comida lista: vibra y avisa (solo lo que pasó a listo con la pantalla abierta) ──
  const readySeen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ready = summarizeSession(server.tickets).readyItemIds
    if (readySeen.current !== null && newlyReady(readySeen.current, server.tickets).length > 0) {
      buzz([60, 40, 60])
      toast.success(`${title}: lista para llevar`)
    }
    readySeen.current = new Set(ready)
  }, [server, title])

  // ── Ir al final de la comanda (donde está lo último) ──
  useLayoutEffect(() => {
    if (endTick === 0) return
    const scroller = scrollRef.current
    scroller?.scrollTo({ top: scroller.scrollHeight })
  }, [endTick])
  const toEnd = () => setEndTick((n) => n + 1)
  /** Lo listo puede haber quedado arriba, fuera de la vista: ir a esa tanda. */
  const showReady = () => {
    const ticket = scrollRef.current?.querySelector(
      '[data-stage="ready"], [data-stage="partly_ready"]',
    )
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ticket?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }

  // ── Acciones que se ven ya y el servidor confirma después ──
  const optimistic = async (
    apply: (o: Overlay) => Overlay,
    undo: (o: Overlay) => Overlay,
    call: () => Promise<{ ok: true } | Failure>,
  ): Promise<boolean> => {
    setOverlay(apply)
    let result: { ok: true } | Failure
    try {
      result = await call()
    } catch {
      result = NO_SIGNAL
    }
    // Primero la lectura nueva, después se saca lo provisorio: así no parpadea.
    if (result.ok) await reloadSession()
    setOverlay(undo)
    if (!result.ok) toast.error(result.message)
    return result.ok
  }

  const serve = (itemIds: string[], call: () => Promise<{ ok: true } | Failure>) => {
    if (itemIds.length === 0) return
    buzz(12)
    void optimistic(
      (o) => ({ ...o, served: [...o.served, ...itemIds] }),
      (o) => ({ ...o, served: o.served.filter((id) => !itemIds.includes(id)) }),
      call,
    )
  }
  const serveReady = () =>
    serve(summary.readyItemIds, () => markServed(slug, { sessionId, onlyReady: true }))
  const serveLine = (item: SessionItem) =>
    serve([item.id], () => markServed(slug, { sessionId, itemIds: [item.id], onlyReady: false }))

  const fire = (ticketId: string) => {
    if (firing.includes(ticketId)) return
    buzz([12, 30, 12])
    setFiring((list) => [...list, ticketId])
    void optimistic(
      (o) => ({ ...o, fired: [...o.fired, ticketId] }),
      (o) => ({ ...o, fired: o.fired.filter((id) => id !== ticketId) }),
      () => fireTicket(slug, ticketId),
    ).finally(() => setFiring((list) => list.filter((id) => id !== ticketId)))
  }

  const toggleBill = () => {
    if (billBusy) return
    const next = session.bill_requested_at === null
    buzz(10)
    setBillBusy(true)
    void optimistic(
      (o) => ({ ...o, bill: next }),
      (o) => ({ ...o, bill: null }),
      () => requestBill(slug, sessionId, next),
    ).finally(() => setBillBusy(false))
  }

  const saveParty = (change: { partySize?: number; alias?: string }) => {
    void optimistic(
      (o) => ({
        ...o,
        partySize: change.partySize ?? o.partySize,
        ...(change.alias === undefined ? {} : { alias: change.alias || null }),
      }),
      (o) => ({ served: o.served, fired: o.fired, bill: o.bill, partySize: null }),
      () => updateTable(slug, { sessionId, ...change }),
    )
  }

  const toggleStock = (item: MenuItem, soldOut: boolean) => {
    const set = (value: boolean) =>
      setMenu((m) => ({
        ...m,
        items: m.items.map((i) => (i.id === item.id ? { ...i, sold_out: value } : i)),
      }))
    set(soldOut)
    void (async () => {
      let result: { ok: true } | Failure
      try {
        result = await setStockout(slug, branchId, item.id, soldOut)
      } catch {
        result = NO_SIGNAL
      }
      if (result.ok) {
        toast.success(soldOut ? `${item.name}: agotado por hoy` : `${item.name}: volvió a haber`)
        return
      }
      set(!soldOut)
      toast.error(result.message)
    })()
  }

  // ── Armar la tanda ──
  const addItem = (item: MenuItem) => {
    if (closed || item.sold_out) return
    if (needsChoice(index, item.id)) {
      setOptions({ mode: 'add', item })
      return
    }
    const hasPlainLine = draft.lines.some(
      (l) => l.menu_item_id === item.id && l.option_ids.length === 0 && !l.notes,
    )
    if (draft.lines.length >= MAX_LINES && !hasPlainLine) {
      toast.error('El pedido es demasiado largo: mandalo en dos partes.')
      return
    }
    dispatch({ type: 'add', menu_item_id: item.id, lineKey: newId(), draftKey: newId() })
    buzz(10)
  }
  const addChosen = (item: MenuItem, choice: OptionsChoice) => {
    dispatch({
      type: 'add',
      menu_item_id: item.id,
      quantity: choice.quantity,
      option_ids: choice.option_ids,
      notes: choice.notes,
      lineKey: newId(),
      draftKey: newId(),
    })
    buzz(10)
  }
  const decItem = (item: MenuItem) => {
    dispatch({ type: 'dec_item', menu_item_id: item.id })
    buzz(6)
  }
  const repeatRound = () => {
    if (!round || closed) return
    dispatch({
      type: 'add_many',
      draftKey: newId(),
      lines: round.lines.map((line) => ({
        menu_item_id: line.menu_item_id,
        quantity: line.quantity,
        option_ids: line.option_ids,
        notes: line.notes,
        lineKey: newId(),
      })),
    })
    buzz([10, 30, 10])
    if (round.skipped.length > 0) {
      toast(`No se repitió ${round.skipped.join(', ')}: hoy no hay.`)
    }
  }
  const editLine = (lineKey: string) => {
    const line = draft.lines.find((l) => l.key === lineKey)
    if (!line) return
    const item = index.items.get(line.menu_item_id)
    setOptions({ mode: 'edit', line, name: item?.name ?? 'Producto que ya no está en la carta' })
  }

  const send = (fireNow: boolean) => {
    if (closed || !draft.key || totals.lines.length === 0 || totals.blocked) return
    local.enqueue(
      makeEntry({ key: draft.key, lines: totals.lines, fire: fireNow, course, now: Date.now() }),
    )
    buzz(fireNow ? [12, 30, 12] : 12)
    setPickerOpen(false)
    toEnd()
  }

  // ── La carta ──
  const openPicker = () => {
    // Dentro del mismo toque: si no, el iPhone no abre el teclado.
    flushSync(() => setPickerOpen(true))
    searchRef.current?.focus({ preventScroll: true })
  }
  const closePicker = () => {
    setPickerOpen(false)
    toEnd()
    addRef.current?.focus({ preventScroll: true })
  }
  // Mesa recién abierta: derecho al buscador.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir la pantalla
  useEffect(() => {
    if (startAdding && !closed) searchRef.current?.focus({ preventScroll: true })
  }, [])

  const elapsed = minutesSince(session.opened_at, now)
  const billMinutes = minutesSince(session.bill_requested_at, now)

  return (
    <div
      className="cmd"
      data-picker={pickerOpen && !closed ? 'open' : 'closed'}
      data-closed={closed ? '' : undefined}
      data-live={alive ? '' : undefined}
      data-testid="order-screen"
    >
      <PosTopbar account={account}>
        <Link href={`/${slug}/salon/mapa`} className="cmd-back" aria-label="Volver al salón">
          <ChevronLeft aria-hidden strokeWidth={2.4} />
        </Link>
        <h1 className="cmd-title">{title}</h1>
        {session.is_practice ? <span className="cmd-practice">Prueba</span> : null}
        <button
          type="button"
          className="cmd-people"
          onClick={() => setPartyOpen(true)}
          disabled={closed}
          aria-label={`${session.party_size ?? 'Sin'} ${session.party_size === 1 ? 'persona' : 'personas'}. Cambiar cuántos son`}
          data-testid="order-people"
        >
          <span>×{session.party_size ?? '?'}</span>
        </button>
        <span className="cmd-name">{name ? <span>{name}</span> : null}</span>
        <span className="pos-top-meta">
          {table?.area ? `${table.area} · ` : ''}
          <b>{clockAt(new Date(now).toISOString(), timeZone)}</b>
        </span>
      </PosTopbar>

      <section className="cmd-main" aria-label={`Comanda de ${title}`}>
        {offline ? (
          <p className="cmd-offline" role="status" data-testid="order-offline">
            <WifiOff aria-hidden />
            Sin conexión. Podés seguir cargando: lo que mandes sale solo cuando vuelva.
          </p>
        ) : null}

        <div className="cmd-scroll" ref={scrollRef}>
          <div className="cmd-flow">
            <InfoStrip detail={view} live={live} elapsed={elapsed} billMinutes={billMinutes} />
            <ServiceAlerts detail={view} />

            {empty ? (
              <div className="cmd-empty" data-testid="order-empty">
                <h2>{closed ? 'Esta mesa no tuvo pedidos' : 'Todavía no pidieron nada'}</h2>
                {closed ? null : (
                  <p>
                    Tocá <b>Agregar</b> y cargá la primera tanda. Lo que elijas queda acá, sin
                    enviar, hasta que lo mandes a cocina.
                  </p>
                )}
              </div>
            ) : null}

            {view.tickets.map((ticket, i) => (
              <SentTicket
                key={ticket.id}
                ticket={ticket}
                number={numbers[i] ?? i + 1}
                display={ticketDisplay(ticket, now)}
                clock={clockAt(ticket.fired_at ?? ticket.submitted_at, timeZone)}
                firing={firing.includes(ticket.id)}
                fireInBar={primary.kind === 'fire' && primary.ticketId === ticket.id}
                readOnly={closed}
                onLine={(item) =>
                  setLineTarget({
                    item,
                    tanda: numbers[i] ?? i + 1,
                    fired: ticket.fired_at !== null,
                  })
                }
                onFire={() => fire(ticket.id)}
              />
            ))}

            {pending.map((entry, i) => {
              const isConfirmed = i < confirmed.length
              return (
                <PendingTicket
                  key={entry.key}
                  entry={entry}
                  number={numbers[view.tickets.length + i] ?? view.tickets.length + i + 1}
                  status={isConfirmed ? 'confirmed' : entryStatus(entry, online)}
                  canRetry={online && local.flying !== entry.key}
                  onRetry={local.retry}
                />
              )
            })}

            {tableTotal > 0 ? (
              <p className="cmd-grand" data-testid="order-total">
                <span>Total de la mesa</span>
                <i className="cmd-dots" aria-hidden />
                <b>{formatCentsShort(tableTotal)}</b>
              </p>
            ) : null}

            {totals.lines.length > 0 ? (
              <DraftTicket
                totals={totals}
                number={draftNumber}
                onEdit={editLine}
                onInc={(lineKey) => {
                  dispatch({ type: 'inc', lineKey })
                  buzz(8)
                }}
                onDec={(lineKey) => {
                  dispatch({ type: 'dec', lineKey })
                  buzz(6)
                }}
              />
            ) : null}
          </div>
        </div>

        {closed ? (
          <div className="cmd-closed">
            <span>Esta mesa ya se cerró.</span>
            <Link href={`/${slug}/salon/mapa`} className="cmd-go">
              Volver al salón
            </Link>
          </div>
        ) : (
          <ActionBar
            primary={primary}
            fireNumber={fireNumber}
            readyLabel={summary.readyLabel}
            blocked={totals.blocked}
            billOn={session.bill_requested_at !== null}
            billBusy={billBusy}
            addRef={addRef}
            onAdd={openPicker}
            onBill={toggleBill}
            onSend={() => send(true)}
            onHold={() => send(false)}
            onServe={serveReady}
            onShowReady={showReady}
            onFire={() => primary.kind === 'fire' && fire(primary.ticketId)}
          />
        )}
      </section>

      {closed ? null : (
        <ProductPicker
          index={index}
          quantities={quantities}
          round={round}
          tableTitle={title}
          offline={offline}
          searchRef={searchRef}
          onAdd={addItem}
          onDec={decItem}
          onMenu={setStockItem}
          onRepeat={repeatRound}
          onClose={closePicker}
          tray={
            totals.units > 0 ? (
              <div className="cmd-tray" data-testid="picker-tray">
                <button
                  type="button"
                  className="cmd-tray-sum"
                  onClick={closePicker}
                  aria-label={`Ver el pedido: ${totals.units} ${totals.units === 1 ? 'producto' : 'productos'}, ${formatCentsShort(totals.total_cents)}`}
                  data-testid="picker-review"
                >
                  <span className="cmd-badge cmd-bump" key={totals.units}>
                    {totals.units}
                  </span>
                  <span className="cmd-tray-text">
                    {[...totals.lines]
                      .reverse()
                      .map((l) => `${l.line.quantity} ${l.name}`)
                      .join(' · ')}
                  </span>
                  <b>{formatCentsShort(totals.total_cents)}</b>
                  <ChevronRight aria-hidden />
                </button>
                {totals.blocked ? <BlockedNote /> : null}
                <SendRow
                  units={totals.units}
                  blocked={totals.blocked}
                  onSend={() => send(true)}
                  onHold={() => send(false)}
                />
              </div>
            ) : null
          }
        />
      )}

      <OptionsSheet
        target={options}
        index={index}
        onClose={() => setOptions(null)}
        onAdd={addChosen}
        onSave={(lineKey, choice) => dispatch({ type: 'edit', lineKey, ...choice })}
      />
      <LineSheet
        target={lineTarget}
        slug={slug}
        onClose={() => setLineTarget(null)}
        onServe={serveLine}
        onCancelled={(item, reason) => {
          void reloadSession()
          if (reason !== REASON_SOLD_OUT) return
          const product = index.items.get(item.menu_item_id)
          if (!product || product.sold_out) return
          toast(`¿${product.name} se terminó?`, {
            description: 'Marcalo agotado y nadie más lo va a poder pedir hoy.',
            duration: 9000,
            action: { label: 'Marcar agotado', onClick: () => toggleStock(product, true) },
          })
        }}
      />
      <PartySheet
        open={partyOpen}
        title={title}
        capacity={table?.capacity ?? null}
        partySize={session.party_size}
        alias={session.alias}
        onClose={() => setPartyOpen(false)}
        onSave={saveParty}
        onMove={
          session.status === 'open'
            ? () => router.push(`/${slug}/salon/mapa?mover=${session.id}`)
            : undefined
        }
      />
      <StockSheet item={stockItem} onClose={() => setStockItem(null)} onToggle={toggleStock} />
      {/* Lo que haya quedado sin enviar de OTRAS mesas sale desde acá también. */}
      <PosOutboxRunner slug={slug} />
    </div>
  )
}
