'use client'

import { BadgePercent, ChevronLeft, Send, Undo2, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type ApprovalsApi, liveApprovalsApi } from '@/components/pos/approvals/approvals-api'
import { ApprovalsBell } from '@/components/pos/approvals/approvals-bell'
import type { ApprovalRow } from '@/components/pos/approvals/approvals-sheet'
import { useApprovalActs } from '@/components/pos/approvals/use-approval-acts'
import { buzz } from '@/components/pos/order/haptics'
import { newId, readStoredOrder } from '@/components/pos/order/order-storage'
import { PosOutboxRunner } from '@/components/pos/order/outbox-runner'
import { useNow } from '@/components/pos/order/use-now'
import { useOnline } from '@/components/pos/order/use-online'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import {
  type Bill,
  type BillDiscount,
  type BillLine,
  type InboxApproval,
  METHOD_LABEL,
  type PayMethod,
  type Payment,
  type PayResult,
  type PointsAwarded,
} from '@/lib/pos/cash/types'
import { clockAt } from '@/lib/pos/order/clock'
import {
  type ChargeInput,
  composeCharge,
  payFailureKind,
  type Tender,
  type Tip,
  toChargeInput,
} from '@/lib/pos/pay/charge'
import { groupLines, type LineGroup, setChosen, tapChosen } from '@/lib/pos/pay/lines'
import { billMode, billName, billPeople, billTitle } from '@/lib/pos/pay/mode'
import { initialSplit, portionOf, reconcileSplit, type Split } from '@/lib/pos/pay/split'
import { useLiveReload } from '@/lib/pos/use-live-reload'
import { usePosPoke } from '@/lib/pos/use-poke'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { BillPaper } from './bill-paper'
import { Falta } from './falta'
import {
  BillLineSheet,
  type DiscountChoice,
  DiscountInfoSheet,
  DiscountSheet,
  PaymentSheet,
} from './pay-sheets'
import {
  ClosedState,
  EmptyState,
  GoneState,
  NoShiftState,
  OverpaidState,
  SettledState,
} from './pay-states'
import { PayStub, type Receipt, type StubStep, type Unsent } from './pay-stub'
import { attempt, money, type PayActions } from './pay-types'
import './pay.css'
import './pay-toast.css'

/**
 * La cuenta de una mesa: lo que falta, la cuenta de papel y el talón para cobrarla.
 *
 * Arriba, la mesa en una fila. Lo que falta cobrar, siempre a la vista y grande. En el medio, la
 * cuenta como la escribe el bar. Abajo (al lado, con ancho), el talón: una pregunta por vez.
 *
 * La base manda: cada cobro vuelve con la cuenta nueva, y la pantalla se pone al día sola cuando
 * otro celular cobra, cuando se aprueba un descuento o cuando se abre la caja. Un cobro nunca se
 * encola: si no hay señal se dice, y se reintenta con la misma clave, que no cobra dos veces.
 */

type Props = {
  slug: string
  initial: Bill
  /** Las acciones de verdad, conectadas por la página. */
  actions: PayActions
  timeZone: string
  /** El membrete de la cuenta: el bar y, si tiene más de una, la sucursal. */
  place: string
  /** La sucursal de la mesa: la caja y el salón a los que se vuelve son los de ESTA mesa. */
  branchSlug: string
  /** Si esta persona puede abrir la caja (lo resuelve la página con el mismo criterio que Caja). */
  canOpenShift: boolean
  /** El botón de la cuenta de quien trabaja, armado en la página. */
  account?: React.ReactNode
  /** De dónde salen los pedidos de descuento y de baja. Sin dato, las acciones de verdad. */
  approvals?: ApprovalsApi
}

type OpenSheet =
  | { kind: 'discount' }
  | { kind: 'discount-info'; discount: BillDiscount }
  | { kind: 'line'; group: LineGroup }
  | { kind: 'payment'; payment: Payment }
  | null

/** Cuánto se queda a la vista un pedido recién contestado dentro de la cuenta. */
const SETTLED_MS = 6000

export function PayScreen({
  slug,
  initial,
  actions,
  timeZone,
  place,
  branchSlug,
  canOpenShift,
  account,
  approvals,
}: Props) {
  const sessionId = initial.session.id
  const branchId = initial.session.branch_id
  const router = useRouter()

  const [bill, setBill] = useState(initial)
  const [split, setSplit] = useState<Split>(() => initialSplit(initial))
  const [step, setStep] = useState<StubStep>('method')
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [tender, setTender] = useState<Tender>({ kind: 'exact' })
  const [tip, setTip] = useState<Tip>({ kind: 'none' })
  const [invoice, setInvoice] = useState<boolean | null>(null)
  const [reference, setReference] = useState('')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [unsent, setUnsent] = useState<(Unsent & { input: ChargeInput }) | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [closedNow, setClosedNow] = useState<{
    points: PointsAwarded | null
    payment: Payment | null
  } | null>(null)
  const [closing, setClosing] = useState(false)
  const [sheet, setSheet] = useState<OpenSheet>(null)
  const [approvalsTick, setApprovalsTick] = useState(0)
  const [alive, setAlive] = useState(false)
  const [unsentOrder, setUnsentOrder] = useState({ outbox: 0, draft: 0 })

  /** La última cuenta que llegó: para comparar con la que sigue sin esperar a que se dibuje. */
  const billRef = useRef(initial)
  /** Los cobros que hizo esta pantalla: los de los demás se avisan. */
  const ownPayments = useRef(new Set<string>())
  /** La clave del cobro en curso. Se repite en cada reintento y cambia recién con una respuesta. */
  const payKey = useRef<string | null>(null)
  const sendingRef = useRef(false)

  useEffect(() => setAlive(true), [])

  // Los avisos suben justo por encima del talón (ver pay-toast.css): hay que saber cuánto mide.
  const dockRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const dock = dockRef.current
    if (!dock || typeof ResizeObserver === 'undefined') return
    const publish = () =>
      document.body.style.setProperty('--pay-dock-h', `${Math.round(dock.offsetHeight)}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(dock)
    return () => {
      observer.disconnect()
      document.body.style.removeProperty('--pay-dock-h')
    }
  }, [])

  // ── La cuenta que llega (de una lectura, de un aviso en vivo o de la respuesta de una acción) ──
  const land = useCallback((next: Bill) => {
    const previous = billRef.current
    billRef.current = next
    setBill(next)
    const groups = groupLines(next.lines)
    setSplit((current) => reconcileSplit(current, next, groups))
    if (next.bill.remaining_cents !== previous.bill.remaining_cents) setTender({ kind: 'exact' })

    // Otro celular cobró esta mesa: se dice, con lo que queda. (Con un cobro propio viajando no se
    // anuncia nada: lo nuevo que aparezca puede ser ese mismo cobro, que todavía no contestó.)
    if (sendingRef.current) return
    const known = new Set(previous.payments.map((payment) => payment.id))
    for (const payment of next.payments) {
      if (payment.status !== 'ok' || known.has(payment.id)) continue
      if (ownPayments.current.has(payment.id)) continue
      ownPayments.current.add(payment.id)
      toast(`${payment.created_by_name} cobró ${money(payment.amount_cents)} de esta mesa`, {
        description:
          next.session.status === 'open'
            ? `${METHOD_LABEL[payment.method]}. Ahora faltan ${money(next.bill.remaining_cents)}.`
            : `${METHOD_LABEL[payment.method]}. Con eso la mesa quedó cobrada.`,
      })
    }
  }, [])

  // Si la página se vuelve a leer entera (al volver a la app), manda lo nuevo.
  useEffect(() => land(initial), [initial, land])

  const read = useCallback(async () => {
    const result = await attempt(() => actions.refresh())
    if (result.ok) land(result.data)
  }, [actions, land])
  // No pierde un aviso que llega durante una lectura y nunca lee de más (ver `lib/pos/live-reload.ts`).
  const { poke, now: reload } = useLiveReload(read)

  const live = usePosPoke(branchId, (what, pokedSession) => {
    // Un pedido nuevo o contestado (o la vuelta del canal): la bandeja vuelve a leer.
    if (what === 'approvals' || (what === 'floor' && pokedSession === null)) {
      setApprovalsTick((n) => n + 1)
    }
    if (what === 'menu') return
    // De esta mesa (un cobro, una baja, un descuento), o de toda la sucursal (se abrió la caja,
    // volvió el canal): la cuenta se vuelve a leer.
    if (pokedSession === sessionId || pokedSession === null) poke()
  })
  // Red de seguridad: si un aviso en vivo se pierde, igual se pone al día.
  useVisibleInterval(reload, 40_000)

  const online = useOnline()
  const offline = !online || live === 'offline'
  const wasOnline = useRef(true)
  useEffect(() => {
    if (online && !wasOnline.current) poke()
    wasOnline.current = online
  }, [online, poke])

  // ── Lo que esta mesa tiene sin enviar en este celular: todavía no está en la cuenta ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: se vuelve a mirar con cada cuenta nueva
  useEffect(() => {
    const check = () => {
      const stored = readStoredOrder(sessionId)
      setUnsentOrder({
        outbox: stored.outbox.length,
        draft: stored.draft.lines.reduce((sum, line) => sum + line.quantity, 0),
      })
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [sessionId, bill])

  // ── Lo que se ve ──
  const now = useNow(bill.now)
  const groups = useMemo(() => groupLines(bill.lines), [bill.lines])
  const mode = useMemo(() => billMode(bill), [bill])
  const portion = useMemo(() => portionOf(split, bill, groups), [split, bill, groups])
  const people = billPeople(bill)
  const title = billTitle(bill.session)
  const name = billName(bill)
  const open = bill.session.status === 'open'
  const charging = mode.kind === 'charging'
  const charge = useMemo(
    () =>
      method === null
        ? null
        : composeCharge({
            method,
            portion,
            tip,
            tender,
            invoice,
            settings: bill.settings,
            remainingCents: bill.bill.remaining_cents,
          }),
    [method, portion, tip, tender, invoice, bill.settings, bill.bill.remaining_cents],
  )
  // Sin nada elegido para cobrar (por producto, o un monto en blanco) la única pregunta posible es
  // cómo se divide.
  const shownStep: StubStep = portion.amountCents <= 0 ? 'split' : step
  const picking = charging && split.kind === 'items' && shownStep === 'split' && !unsent
  const orderHref = `/${slug}/salon/mesa/${sessionId}`
  // Con la sucursal de la mesa: un dispositivo que estaba en la otra (o que nunca eligió) vuelve al
  // salón de esta mesa y abre la caja de esta mesa, no la de la otra.
  const branchQuery = `?sucursal=${encodeURIComponent(branchSlug)}`
  const mapHref = `/${slug}/salon/mapa${branchQuery}`
  const cashHref = `/${slug}/salon/caja${branchQuery}`

  // ── Los pedidos de esta mesa: se contestan con las mismas reglas que en la bandeja ──
  const approvalsApi = useMemo(
    () => approvals ?? liveApprovalsApi(slug, branchId),
    [approvals, slug, branchId],
  )
  const acts = useApprovalActs(approvalsApi, () => {
    setApprovalsTick((n) => n + 1)
    poke()
  })
  const approvalRows = useMemo<ApprovalRow[]>(() => {
    const here: InboxApproval[] = bill.pending_approvals.map((approval) => ({
      ...approval,
      status: 'pending',
      session_id: sessionId,
      table_label: bill.session.table_label,
      alias: bill.session.alias,
    }))
    const byId = new Map<string, ApprovalRow>()
    for (const approval of here) {
      byId.set(approval.id, { approval, act: acts.acts[approval.id]?.act ?? null })
    }
    for (const [id, entry] of Object.entries(acts.acts)) {
      if (!byId.has(id)) byId.set(id, { approval: entry.approval, act: entry.act })
    }
    return [...byId.values()].sort((a, b) =>
      a.approval.requested_at.localeCompare(b.approval.requested_at),
    )
  }, [bill.pending_approvals, bill.session.table_label, bill.session.alias, sessionId, acts.acts])
  // Lo recién contestado se queda un momento a la vista (para poder deshacerlo) y después se va.
  const { forgetSettled } = acts
  useEffect(() => {
    const settled = Object.values(acts.acts).some(
      (entry) => entry.act.kind === 'done' || entry.act.kind === 'undone',
    )
    if (!settled) return
    const timer = window.setTimeout(forgetSettled, SETTLED_MS)
    return () => window.clearTimeout(timer)
  }, [acts.acts, forgetSettled])

  // ── El talón ──
  const resetStub = () => {
    setMethod(null)
    setStep('method')
    setTender({ kind: 'exact' })
    setTip({ kind: 'none' })
    setInvoice(null)
    setReference('')
  }

  const chooseMethod = (next: PayMethod) => {
    buzz(8)
    setMethod(next)
    setStep('detail')
    setTender({ kind: 'exact' })
    setInvoice(null)
    setReceipt(null)
  }

  const changeSplit = (next: Split) => {
    setSplit(next)
    setTender({ kind: 'exact' })
  }

  const changeTip = (next: Tip) => {
    setTip(next)
    // Con propina cambia lo que tiene que entregar: los billetes sugeridos también.
    setTender({ kind: 'exact' })
  }

  const paid = (data: PayResult) => {
    ownPayments.current.add(data.payment.id)
    payKey.current = null
    setUnsent(null)
    buzz(data.closed ? [30, 60, 120] : 14)

    const previous = billRef.current
    const known = previous.payments.some((payment) => payment.id === data.payment.id)
    land({
      ...previous,
      bill: data.bill,
      payments: known
        ? previous.payments.map((payment) =>
            payment.id === data.payment.id ? data.payment : payment,
          )
        : [...previous.payments, data.payment],
      session: data.closed
        ? { ...previous.session, status: 'paid', paid_at: data.payment.created_at }
        : previous.session,
    })

    if (data.closed) {
      setClosedNow({ points: data.points, payment: data.payment })
      setReceipt(null)
    } else {
      setReceipt({ payment: data.payment, duplicate: data.duplicate })
    }
    resetStub()
    // Lo que sigue se vuelve a elegir: otros productos, u otro monto.
    setSplit((current) =>
      current.kind === 'items'
        ? { kind: 'items', chosen: {} }
        : current.kind === 'amount'
          ? { kind: 'all' }
          : current,
    )
    void reload()
  }

  const send = async (input: ChargeInput) => {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    const result = await attempt(() => actions.pay(input))
    sendingRef.current = false
    setSending(false)
    if (result.ok) {
      paid(result.data)
      return
    }
    const failure = payFailureKind(result.code)
    if (failure === 'retry') {
      // No se sabe si llegó: se reintenta con la misma clave. Mientras tanto no se toca nada.
      setUnsent({
        input,
        offline: result.code === 'network',
        message: result.message,
        method: input.method,
        amountCents: input.amountCents,
      })
      return
    }
    // La base dijo que no: no se anotó nada. El próximo intento es otro cobro, con otra clave.
    payKey.current = null
    setUnsent(null)
    toast.error(result.message)
    if (failure === 'refresh') {
      await reload()
      setStep('method')
    }
  }

  const confirm = () => {
    if (!charge || !charging) return
    payKey.current ??= newId()
    void send(
      toChargeInput(sessionId, charge, {
        key: payKey.current,
        portion,
        reference: charge.method === 'other' ? reference : null,
        shiftId: bill.shifts.length > 1 ? shiftId : null,
      }),
    )
  }

  /** «No cobrar» después de un intento sin respuesta: primero hay que saber si entró. */
  const giveUp = async () => {
    if (!unsent || sendingRef.current) return
    const known = new Set(billRef.current.payments.map((payment) => payment.id))
    sendingRef.current = true
    setSending(true)
    const result = await attempt(() => actions.refresh())
    sendingRef.current = false
    setSending(false)
    if (!result.ok) {
      toast.error('Sigue sin señal: todavía no se puede saber si el cobro entró.')
      return
    }
    const landed = result.data.payments.find(
      (payment) =>
        payment.status === 'ok' &&
        !known.has(payment.id) &&
        payment.method === unsent.input.method &&
        payment.amount_cents === unsent.input.amountCents,
    )
    if (landed) ownPayments.current.add(landed.id)
    land(result.data)
    payKey.current = null
    setUnsent(null)
    resetStub()
    if (landed) toast.success('El cobro sí había entrado: quedó anotado una sola vez.')
    else toast('No se cobró nada.')
  }

  const closeTable = async () => {
    if (closing) return
    setClosing(true)
    const result = await attempt(() => actions.closeTable())
    setClosing(false)
    if (!result.ok) {
      toast.error(result.message)
      void reload()
      return
    }
    buzz([30, 60, 120])
    const previous = billRef.current
    land({
      ...previous,
      bill: result.data.bill,
      session: { ...previous.session, status: 'paid' },
    })
    setClosedNow({ points: result.data.points, payment: null })
    void reload()
  }

  // ── Descuentos, bajas y anulaciones ──
  const undoDiscount = async (discountId: string) => {
    const result = await attempt(() => actions.removeDiscount(discountId))
    if (!result.ok) toast.error(result.message)
    else toast('Descuento quitado')
    void reload()
  }

  const submitDiscount = async (choice: DiscountChoice): Promise<string | null> => {
    const result = await attempt(() => actions.addDiscount({ sessionId, ...choice }))
    if (!result.ok) return result.message
    land({ ...billRef.current, bill: result.data.bill })
    await reload()
    const discountId = result.data.discount_id
    if (result.data.applied) {
      toast.success('Descuento aplicado', {
        action: discountId
          ? { label: 'Deshacer', onClick: () => void undoDiscount(discountId) }
          : undefined,
      })
    } else {
      setApprovalsTick((n) => n + 1)
      toast('Pedido enviado', {
        description: 'El encargado lo ve en su celular. Hasta que conteste, el total no cambia.',
      })
    }
    return null
  }

  const removeDiscount = async (discount: BillDiscount): Promise<string | null> => {
    const result = await attempt(() => actions.removeDiscount(discount.id))
    if (!result.ok) return result.message
    const previous = billRef.current
    land({
      ...previous,
      bill: result.data.bill,
      discounts: previous.discounts.filter((item) => item.id !== discount.id),
    })
    void reload()
    toast('Descuento quitado')
    return null
  }

  const requestVoid = async (line: BillLine, reason: string): Promise<string | null> => {
    const result = await attempt(() => actions.requestVoid(line.id, reason))
    if (!result.ok) return result.message
    await reload()
    if (result.data.applied) {
      toast.success(`${line.quantity} × ${line.name}: dado de baja`)
    } else {
      setApprovalsTick((n) => n + 1)
      toast('Baja pedida', {
        description: 'El encargado la ve en su celular. Hasta que conteste, sigue en la cuenta.',
      })
    }
    return null
  }

  const voidPayment = async (payment: Payment, reason: string): Promise<string | null> => {
    const result = await attempt(() => actions.voidPayment(payment.id, reason))
    if (!result.ok) return result.message
    const previous = billRef.current
    land({
      ...previous,
      bill: result.data.bill,
      payments: previous.payments.map((item) =>
        item.id === payment.id ? result.data.payment : item,
      ),
    })
    setReceipt(null)
    void reload()
    toast('Cobro anulado', {
      description: `Vuelven a faltar ${money(result.data.bill.remaining_cents)}.`,
    })
    return null
  }

  const [unrequesting, setUnrequesting] = useState(false)
  const unrequest = async () => {
    if (unrequesting) return
    setUnrequesting(true)
    const result = await attempt(() => actions.unrequestBill())
    if (!result.ok) {
      setUnrequesting(false)
      toast.error(result.message)
      return
    }
    router.push(orderHref)
  }

  const hasLivePayment = bill.payments.some((payment) => payment.status === 'ok')
  const canUnrequest = open && bill.session.bill_requested_at !== null && !hasLivePayment
  const canDiscount = open && bill.bill.remaining_cents > 0

  return (
    <div
      className="pay"
      data-mode={mode.kind}
      data-live={alive ? '' : undefined}
      data-testid="pay-screen"
    >
      <PosTopbar account={account}>
        <Link
          href={open ? orderHref : mapHref}
          className="pay-back"
          aria-label={open ? 'Volver a la comanda' : 'Volver al salón'}
          data-testid="pay-back"
        >
          <ChevronLeft aria-hidden strokeWidth={2.4} />
        </Link>
        <h1 className="pay-title">{title}</h1>
        {bill.session.is_practice ? <span className="pay-practice">Prueba</span> : null}
        {people ? (
          <span className="pay-people">
            ×{people}
            <span className="sr-only"> {people === 1 ? 'persona' : 'personas'}</span>
          </span>
        ) : null}
        <span className="pay-name">{name ? <span>{name}</span> : null}</span>
        <span className="pos-top-meta">
          Cuenta · <b>{clockAt(new Date(now).toISOString(), timeZone)}</b>
        </span>
        <ApprovalsBell
          slug={slug}
          branchId={branchId}
          timeZone={timeZone}
          signal={approvalsTick}
          api={approvalsApi}
          hereSessionId={sessionId}
        />
      </PosTopbar>

      <div className="pay-body">
        <Falta bill={bill} mode={mode} split={split} people={people} />

        <section className="pay-main" aria-label={`Cuenta de ${title}`}>
          {offline ? (
            <p className="pay-offline" role="status" data-testid="pay-offline">
              <WifiOff aria-hidden />
              Sin conexión. No se puede cobrar hasta que vuelva, y lo que ves puede estar viejo.
            </p>
          ) : null}

          <div className="pay-scroll">
            <div className="pay-flow">
              {open && (unsentOrder.outbox > 0 || unsentOrder.draft > 0) ? (
                <p className="pay-heads-up" role="status" data-testid="pay-unsent-order">
                  <Send aria-hidden strokeWidth={2.4} />
                  <span>
                    {unsentOrder.outbox > 0
                      ? 'Hay una tanda de esta mesa que todavía no llegó a cocina: no está en la cuenta.'
                      : `Quedó un pedido sin enviar en la comanda (${unsentOrder.draft} ${unsentOrder.draft === 1 ? 'producto' : 'productos'}): no está en la cuenta.`}
                  </span>
                  <Link href={orderHref}>Ver la comanda</Link>
                </p>
              ) : null}

              <BillPaper
                bill={bill}
                groups={groups}
                mode={mode}
                place={place}
                timeZone={timeZone}
                nowMs={now}
                picking={picking}
                chosen={charging && split.kind === 'items' ? split.chosen : null}
                approvals={{
                  rows: approvalRows,
                  onApprove: acts.approve,
                  onReject: (approval) => acts.reject(approval, bill.can.approve),
                  onUndo: (approval) => void acts.undo(approval),
                  onBack: acts.back,
                }}
                freshStamp={closedNow !== null}
                onPick={(group) => {
                  if (split.kind !== 'items') return
                  buzz(8)
                  changeSplit({ kind: 'items', chosen: tapChosen(group, split.chosen) })
                }}
                onLess={(group) => {
                  if (split.kind !== 'items') return
                  buzz(6)
                  const current = split.chosen[group.key] ?? 0
                  changeSplit({
                    kind: 'items',
                    chosen: setChosen(group, split.chosen, current - 1),
                  })
                }}
                onLine={(group) => setSheet({ kind: 'line', group })}
                onDiscount={(discount) => setSheet({ kind: 'discount-info', discount })}
                onPayment={(payment) => setSheet({ kind: 'payment', payment })}
              />

              {open && (canDiscount || canUnrequest) ? (
                <div className="pay-acts">
                  {canDiscount ? (
                    <button
                      type="button"
                      className="pay-act"
                      onClick={() => setSheet({ kind: 'discount' })}
                      data-testid="pay-discount-open"
                    >
                      <BadgePercent aria-hidden strokeWidth={2.2} />
                      {bill.can.discount_direct ? 'Descuento' : 'Pedir un descuento'}
                    </button>
                  ) : null}
                  {canUnrequest ? (
                    <button
                      type="button"
                      className="pay-act"
                      onClick={() => void unrequest()}
                      disabled={unrequesting}
                      data-testid="pay-unrequest"
                    >
                      <Undo2 aria-hidden strokeWidth={2.2} />
                      Todavía no la pidieron
                    </button>
                  ) : null}
                </div>
              ) : null}
              {open && !picking && groups.length > 0 ? (
                <p className="pay-foot-hint">
                  Tocá un producto de la cuenta para darlo de baja
                  {bill.can.void_direct ? '.' : ': lo aprueba el encargado.'}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="pay-dock-edge" aria-hidden />
        <section className="pay-dock" aria-label="Cobrar" ref={dockRef} data-testid="pay-dock">
          {mode.kind === 'charging' ? (
            <PayStub
              bill={bill}
              groups={groups}
              people={people}
              step={shownStep}
              split={split}
              portion={portion}
              method={method}
              charge={charge}
              tender={tender}
              tip={tip}
              reference={reference}
              shiftId={shiftId}
              sending={sending}
              unsent={unsent}
              receipt={receipt}
              onStep={setStep}
              onSplit={changeSplit}
              onMethod={chooseMethod}
              onTender={setTender}
              onTip={changeTip}
              onInvoice={setInvoice}
              onReference={setReference}
              onShift={setShiftId}
              onConfirm={confirm}
              onRetry={() => unsent && void send(unsent.input)}
              onGiveUp={() => void giveUp()}
              onReceiptDone={() => setReceipt(null)}
            />
          ) : mode.kind === 'no_shift' ? (
            <NoShiftState canOpenShift={canOpenShift} cashHref={cashHref} />
          ) : mode.kind === 'settled' ? (
            <SettledState
              mode={mode}
              bill={bill}
              busy={closing}
              onClose={() => void closeTable()}
            />
          ) : mode.kind === 'overpaid' ? (
            <OverpaidState mode={mode} />
          ) : mode.kind === 'empty' ? (
            <EmptyState orderHref={orderHref} />
          ) : mode.kind === 'closed' ? (
            <ClosedState
              bill={bill}
              awarded={
                closedNow?.points ??
                (bill.closed && bill.customer && !bill.session.is_practice
                  ? {
                      customer_id: bill.customer.id,
                      first_name: bill.customer.first_name,
                      awarded: bill.closed.points_awarded,
                      balance: bill.customer.points_balance,
                      failed: bill.closed.points_failed,
                    }
                  : null)
              }
              lastPayment={closedNow?.payment ?? null}
              timeZone={timeZone}
              mapHref={mapHref}
            />
          ) : (
            <GoneState mapHref={mapHref} />
          )}
        </section>
      </div>

      <DiscountSheet
        open={sheet?.kind === 'discount'}
        bill={bill}
        onClose={() => setSheet(null)}
        onSubmit={submitDiscount}
      />
      <DiscountInfoSheet
        discount={sheet?.kind === 'discount-info' ? sheet.discount : null}
        onClose={() => setSheet(null)}
        onRemove={removeDiscount}
      />
      <BillLineSheet
        target={sheet?.kind === 'line' ? sheet.group : null}
        bill={bill}
        onClose={() => setSheet(null)}
        onRequest={requestVoid}
      />
      <PaymentSheet
        payment={sheet?.kind === 'payment' ? sheet.payment : null}
        bill={bill}
        timeZone={timeZone}
        onClose={() => setSheet(null)}
        onVoid={voidPayment}
      />
      {/* Lo que haya quedado sin enviar (de esta mesa o de otra) sale desde acá también. */}
      <PosOutboxRunner slug={slug} />
    </div>
  )
}
