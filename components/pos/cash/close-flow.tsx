'use client'

import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleAlert,
  History,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Plus,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Utensils,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatCentsShort } from '@/lib/money/format'
import {
  type CountDraft,
  cashSince,
  countedUnits,
  defaultLeaveFloat,
  differenceLevel,
  differenceWords,
  MAX_BILL_COUNT,
  restoreCountDraft,
  serializeCountDraft,
  setBillCount,
} from '@/lib/pos/cash/screen'
import { countTotal, emptyCount, probableMistakes } from '@/lib/pos/cash/shift'
import { formatPesosTyping, pesosText, readPesos } from '@/lib/pos/cash/typed-amount'
import type { CountBreakdown, DayPayment, Shift, ShiftSummary } from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import { cn } from '@/lib/utils'
import type { Failure } from './api'
import type { TapeMark } from './tape'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * Cerrar el turno, en tres pasos y un sí:
 *   1. contar el cajón billete por billete, SIN ver cuánto tenía que haber;
 *   2. comparar: si cuadra, sello; si no, qué pudo haber pasado, con el atajo para corregirlo;
 *   3. cuánto queda de cambio para el turno que sigue (el resto se retira) y una nota.
 * Cerrar no tiene vuelta: al final se confirma.
 *
 * El conteo se guarda en el dispositivo a cada toque: ir a mirar una mesa y volver no lo pierde.
 */

export type CloseInput = {
  countedCents: number
  breakdown: CountBreakdown
  leaveFloatCents: number
  note: string | null
}

type Step = 'count' | 'compare' | 'leave'
const STEP_NUMBER: Readonly<Record<Step, number>> = { count: 1, compare: 2, leave: 3 }

type Clue = {
  key: string
  message: string
  paymentId?: string
  movementId?: string
  recount?: boolean
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento (modo privado): el conteo vive mientras la pantalla esté abierta.
  }
}

export function CloseFlow({
  shift,
  live,
  payments,
  denominations,
  pendingApprovals,
  now,
  timeZone,
  account,
  notices,
  children,
  onCancel,
  onClose,
  onPayment,
  onMovement,
  onMark,
}: {
  shift: Shift
  /** Los números del turno, en vivo: si entra un cobro mientras se cuenta, la comparación cambia. */
  live: ShiftSummary
  payments: ReadonlyArray<DayPayment>
  denominations: ReadonlyArray<number>
  pendingApprovals: number
  /** La hora de la base cuando se empezó a contar. */
  now: string
  timeZone: string
  account?: React.ReactNode
  /** Los avisos de la pantalla (sin conexión, práctica), que van debajo de la barra. */
  notices?: React.ReactNode
  /** La cinta (con ancho, va a la derecha: ahí se señala el cobro sospechoso). */
  children?: React.ReactNode
  onCancel: () => void
  onClose: (input: CloseInput) => Promise<Failure | null>
  onPayment: (paymentId: string) => void
  onMovement: (movementId: string) => void
  onMark: (mark: TapeMark) => void
}) {
  const storageKey = `hub:pos:arqueo:${shift.id}`
  const [step, setStep] = useState<Step>('count')
  const [draft, setDraft] = useState<CountDraft & { resumed: boolean }>(() => {
    const saved = restoreCountDraft(readStored(storageKey), shift.id, denominations)
    if (saved && countTotal(saved.count) > 0) return { ...saved, resumed: true }
    return { shiftId: shift.id, startedAt: now, count: emptyCount(denominations), resumed: false }
  })
  const [looseText, setLooseText] = useState(() => {
    const other = draft.count.other_cents ?? 0
    return other > 0 ? pesosText(other) : ''
  })
  const [recounts, setRecounts] = useState(0)
  const leave = useTypedAmount()
  const [leaveTouched, setLeaveTouched] = useState(false)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    writeStored(storageKey, serializeCountDraft(draft))
  }, [storageKey, draft])

  // Cada paso arranca desde arriba (el anterior pudo haber quedado recorrido hasta abajo).
  const scrollRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: se dispara al cambiar de paso
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    flowRef.current?.scrollTo({ top: 0 })
  }, [step])

  const counted = countTotal(draft.count)
  const expected = live.expected_cash_cents
  const difference = counted - expected
  const level = differenceLevel(difference, expected, denominations)
  const words = differenceWords(difference)

  const setUnits = (value: number, units: number) =>
    setDraft((d) => ({ ...d, count: setBillCount(d.count, value, units) }))
  const bump = (value: number, delta: number) =>
    setDraft((d) => {
      const current = d.count.bills.find((bill) => bill.value === value)?.count ?? 0
      return { ...d, count: setBillCount(d.count, value, current + delta) }
    })
  const setLoose = (raw: string) => {
    const text = formatPesosTyping(raw)
    setLooseText(text)
    setDraft((d) => ({ ...d, count: { ...d.count, other_cents: readPesos(text) ?? 0 } }))
  }
  const startOver = () => {
    setDraft({
      shiftId: shift.id,
      startedAt: now,
      count: emptyCount(denominations),
      resumed: false,
    })
    setLooseText('')
  }

  // ── Qué pudo haber pasado ──
  const clues = useMemo<Clue[]>(() => {
    if (difference === 0) return []
    const mine = payments.filter((payment) => payment.shift_id === shift.id)
    const out: Clue[] = []
    // Lo que entró mientras se contaba: si falta justo eso, todavía no llegó al cajón.
    if (difference < 0) {
      const late = cashSince(payments, shift.id, draft.startedAt)
      const exact = late.find((payment) => payment.amount_cents === -difference)
      if (exact) {
        out.push({
          key: `late:${exact.id}`,
          message: `Mientras contabas, ${exact.created_by_name} cobró ${formatCentsShort(exact.amount_cents)} en efectivo${exact.table_label ? ` en la mesa ${exact.table_label}` : ''}: ¿ya está en el cajón?`,
          paymentId: exact.id,
        })
      } else if (late.length > 0) {
        const total = late.reduce((sum, payment) => sum + payment.amount_cents, 0)
        out.push({
          key: 'late',
          message: `Mientras contabas ${late.length === 1 ? 'entró 1 cobro' : `entraron ${late.length} cobros`} en efectivo por ${formatCentsShort(total)}: ¿ya ${late.length === 1 ? 'está' : 'están'} en el cajón?`,
          paymentId: late.length === 1 ? late[0]?.id : undefined,
        })
      }
    }
    for (const mistake of probableMistakes(difference, mine, live.movements, denominations, 4)) {
      out.push({
        key: `${mistake.kind}:${mistake.paymentId ?? mistake.movementId ?? out.length}`,
        message: mistake.message,
        paymentId: mistake.paymentId,
        movementId: mistake.movementId,
        recount: mistake.kind === 'bill_miscount',
      })
    }
    return out.slice(0, 4)
  }, [difference, payments, shift.id, draft.startedAt, live.movements, denominations])

  // Con ancho, el primer sospechoso queda señalado en la cinta.
  const topClue = step === 'compare' ? clues[0] : undefined
  const markPayment = topClue?.paymentId
  const markMovement = topClue?.movementId
  useEffect(() => {
    onMark(
      markPayment ? { paymentId: markPayment } : markMovement ? { movementId: markMovement } : null,
    )
    return () => onMark(null)
  }, [markPayment, markMovement, onMark])

  // ── Pasos ──
  const goCompare = () => setStep('compare')
  const goCount = () => {
    setRecounts((n) => n + 1)
    setStep('count')
  }
  const goLeave = () => {
    if (!leaveTouched) leave.set(defaultLeaveFloat(live.opening_float_cents, counted))
    setError(null)
    setStep('leave')
  }
  const back = () => {
    if (step === 'count') onCancel()
    else if (step === 'compare') setStep('count')
    else setStep('compare')
  }

  // ── Lo que queda de cambio ──
  const leaveCents = leave.cents
  const leaveOver = leaveCents !== null && leaveCents > counted
  const leaveCheck = leaveOver
    ? ({ kind: 'ok' } as const)
    : leave.check(live.opening_float_cents > 0 ? { referenceCents: live.opening_float_cents } : {})
  const noteNeeded = level === 'large' && note.trim() === ''
  const canClose =
    leaveCents !== null && !leaveOver && leaveCheck.kind === 'ok' && !noteNeeded && !busy

  const close = async () => {
    if (!canClose || leaveCents === null) return
    setBusy(true)
    setError(null)
    const failure = await onClose({
      countedCents: counted,
      breakdown: { bills: draft.count.bills, other_cents: draft.count.other_cents ?? 0 },
      leaveFloatCents: leaveCents,
      note: note.trim() || null,
    })
    if (failure) {
      setBusy(false)
      setError(failure.message)
      return
    }
    writeStored(storageKey, null)
  }

  const recountFirst = level === 'large' || (level === 'minor' && recounts === 0)
  const VerdictIcon = words.kind === 'short' ? TrendingDown : TrendingUp
  const openTables = live.open_tables

  return (
    <>
      <PosTopbar account={account}>
        <button
          type="button"
          className="caja-back"
          onClick={back}
          aria-label={
            step === 'count' ? 'Salir del arqueo: el conteo queda guardado' : 'Volver un paso'
          }
          data-testid="arqueo-volver"
        >
          <ChevronLeft strokeWidth={2.4} aria-hidden />
        </button>
        <div className="caja-title">
          <b>Cerrar el turno</b>
          {shift.label ? <span>{shift.label}</span> : null}
        </div>
        <span className="caja-steps">
          <span className="sr-only">Paso </span>
          {STEP_NUMBER[step]} de 3
        </span>
      </PosTopbar>
      {notices}

      <div className="caja-scroll" ref={scrollRef}>
        {step === 'count' ? (
          <section
            ref={flowRef}
            className="caja-flow"
            aria-label="Contar el cajón"
            data-testid="arqueo-contar"
          >
            <header className="caja-flow-head">
              <h1 className="caja-flow-title is-brief">Contá el cajón, billete por billete</h1>
              <p>Cuánto tenía que haber lo ves recién después de contar.</p>
            </header>

            <div className="caja-slip">
              {draft.resumed ? (
                <p className="caja-memo" role="status">
                  <History aria-hidden />
                  <span>
                    Seguís el conteo que habías empezado a las{' '}
                    <b>{clockAt(draft.startedAt, timeZone)}</b>.
                  </span>
                  <button type="button" className="caja-only-btn" onClick={startOver}>
                    <RotateCcw aria-hidden strokeWidth={2.4} />
                    Empezar de cero
                  </button>
                </p>
              ) : null}
              {openTables.count > 0 ? (
                <p className="caja-memo">
                  <Utensils aria-hidden />
                  <span>
                    {openTables.count === 1
                      ? 'Queda 1 mesa abierta'
                      : `Quedan ${openTables.count} mesas abiertas`}
                    {openTables.pending_cents > 0
                      ? ` con ${formatCentsShort(openTables.pending_cents)} sin cobrar`
                      : ''}
                    . Lo que paguen después entra al turno que sigue.
                  </span>
                </p>
              ) : null}
              {pendingApprovals > 0 ? (
                <p className="caja-memo">
                  <CircleAlert aria-hidden />
                  <span>
                    {pendingApprovals === 1
                      ? 'Hay 1 pedido de descuento o de baja sin contestar.'
                      : `Hay ${pendingApprovals} pedidos de descuento o de baja sin contestar.`}
                  </span>
                </p>
              ) : null}

              <ul>
                {draft.count.bills.map((bill, index) => (
                  <BillRow
                    key={bill.value}
                    value={bill.value}
                    units={bill.count}
                    index={index}
                    onSet={setUnits}
                    onBump={bump}
                  />
                ))}
                <li className="caja-bill">
                  <span className="caja-bill-face">
                    <label className="caja-bill-note is-loose" htmlFor="caja-monedas">
                      Monedas y otros
                    </label>
                    <span className="caja-bill-sub">Lo que no está en la lista</span>
                  </span>
                  <span className="caja-loose-wrap">
                    <span aria-hidden>$</span>
                    <PesosInput
                      id="caja-monedas"
                      className="caja-loose"
                      value={looseText}
                      onChange={setLoose}
                      data-testid="arqueo-monedas"
                    />
                  </span>
                </li>
              </ul>
            </div>
          </section>
        ) : null}

        {step === 'compare' ? (
          <section
            ref={flowRef}
            className="caja-flow"
            aria-label="Comparar"
            data-testid="arqueo-comparar"
          >
            <header className="caja-flow-head">
              <h1 className="caja-flow-title">
                {level === 'exact'
                  ? 'El cajón cuadra'
                  : level === 'rounding'
                    ? 'Casi: es redondeo'
                    : level === 'large'
                      ? 'No coincide, y es mucho'
                      : 'No coincide'}
              </h1>
            </header>

            <div className="caja-slip">
              <dl className="caja-sum">
                <div>
                  <dt>Contaste</dt>
                  <dd>{formatCentsShort(counted)}</dd>
                </div>
                <div>
                  <dt>Tenía que haber</dt>
                  <dd data-testid="arqueo-esperado">{formatCentsShort(expected)}</dd>
                </div>
              </dl>

              {words.kind === 'exact' ? (
                <div className="caja-verdict" role="status">
                  <span className="caja-stamp is-big">
                    <Check aria-hidden strokeWidth={3} />
                    Cuadra
                  </span>
                  <p>Lo que contaste es justo lo que tenía que haber.</p>
                </div>
              ) : (
                <div className={cn('caja-verdict', `is-${words.kind}`)} role="status">
                  <span className="caja-verdict-word">
                    <VerdictIcon aria-hidden strokeWidth={2.6} />
                    {words.word}
                  </span>
                  <span className="caja-verdict-sum" data-testid="arqueo-diferencia">
                    {formatCentsShort(Math.abs(difference))}
                  </span>
                  <p>
                    {level === 'rounding'
                      ? 'Es menos que el billete más chico: suele ser vuelto redondeado. Podés seguir.'
                      : level === 'large'
                        ? 'Es mucho para dejarlo pasar: contá de nuevo. Si cerrás igual, vas a tener que escribir qué pasó.'
                        : recounts > 0
                          ? 'Sigue sin coincidir. Mirá lo de abajo; si no aparece, seguí: la diferencia queda anotada.'
                          : 'Antes de seguir, mirá lo de abajo: casi siempre está ahí.'}
                  </p>
                </div>
              )}

              {clues.length > 0 ? (
                <div className="caja-clues">
                  <h2>Qué pudo haber pasado</h2>
                  {clues.map((clue, index) => (
                    <div key={clue.key} className={cn('caja-clue', index === 0 && 'is-top')}>
                      <p>{clue.message}</p>
                      {clue.paymentId ? (
                        <button
                          type="button"
                          className="caja-clue-btn"
                          onClick={() => onPayment(clue.paymentId as string)}
                          data-testid="pista-cobro"
                        >
                          <Search aria-hidden strokeWidth={2.4} />
                          Ver ese cobro
                        </button>
                      ) : clue.movementId ? (
                        <button
                          type="button"
                          className="caja-clue-btn"
                          onClick={() => onMovement(clue.movementId as string)}
                          data-testid="pista-movimiento"
                        >
                          <Search aria-hidden strokeWidth={2.4} />
                          Ver ese movimiento
                        </button>
                      ) : clue.recount ? (
                        <button type="button" className="caja-clue-btn" onClick={goCount}>
                          <RotateCcw aria-hidden strokeWidth={2.4} />
                          Contar de nuevo
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === 'leave' ? (
          <section
            ref={flowRef}
            className="caja-flow"
            aria-label="Cambio para el turno que sigue"
            data-testid="arqueo-cambio"
          >
            <header className="caja-flow-head">
              <h1 className="caja-flow-title">¿Cuánto queda de cambio?</h1>
              <p>Con eso arranca el turno que sigue. El resto se retira.</p>
            </header>

            <div className="caja-slip caja-leave">
              {error ? (
                <p className="caja-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="caja-field">
                <label htmlFor="caja-queda">Queda en el cajón</label>
                <div className="caja-pesos">
                  <span aria-hidden>$</span>
                  <PesosInput
                    id="caja-queda"
                    value={leave.text}
                    onChange={(raw) => {
                      setLeaveTouched(true)
                      leave.setText(raw)
                    }}
                    disabled={busy}
                    data-testid="arqueo-queda"
                  />
                </div>
                <div className="caja-opts">
                  {live.opening_float_cents > 0 && live.opening_float_cents <= counted ? (
                    <button
                      type="button"
                      className="caja-opt"
                      aria-pressed={leaveCents === live.opening_float_cents}
                      onClick={() => {
                        setLeaveTouched(true)
                        leave.set(live.opening_float_cents)
                      }}
                    >
                      <span>
                        {formatCentsShort(live.opening_float_cents)} <small>· como hoy</small>
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="caja-opt"
                    aria-pressed={leaveCents === 0}
                    onClick={() => {
                      setLeaveTouched(true)
                      leave.set(0)
                    }}
                  >
                    Nada
                  </button>
                  <button
                    type="button"
                    className="caja-opt"
                    aria-pressed={leaveCents === counted && counted > 0}
                    onClick={() => {
                      setLeaveTouched(true)
                      leave.set(counted)
                    }}
                  >
                    Todo
                  </button>
                </div>
              </div>

              {leaveCheck.kind === 'ask' ? (
                <TypedGuard
                  ask={leaveCheck}
                  onPick={(value) => {
                    setLeaveTouched(true)
                    leave.set(value)
                  }}
                />
              ) : null}

              {leaveOver ? (
                <p className="caja-error" role="alert">
                  No podés dejar más de lo que contaste ({formatCentsShort(counted)}).
                </p>
              ) : leaveCents !== null ? (
                <p className="caja-leave-out" data-testid="arqueo-retiro">
                  {counted - leaveCents > 0 ? (
                    <>
                      Se retiran <b>{formatCentsShort(counted - leaveCents)}</b>.
                    </>
                  ) : (
                    'No se retira nada: queda todo en el cajón.'
                  )}
                </p>
              ) : null}

              <div className="caja-field">
                <label htmlFor="caja-nota">
                  {level === 'large' ? 'Qué pasó con la diferencia' : 'Nota para los dueños'}{' '}
                  {level === 'large' ? (
                    <small className="is-need">hace falta para cerrar</small>
                  ) : (
                    <small>si querés</small>
                  )}
                </label>
                <textarea
                  id="caja-nota"
                  className="caja-input"
                  value={note}
                  maxLength={300}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    level === 'large'
                      ? 'Lo que sepas: quién estuvo en la caja, qué se revisó'
                      : 'Algo que tengan que saber mañana'
                  }
                  disabled={busy}
                  data-testid="arqueo-nota"
                />
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>

      <footer className="caja-bar">
        {step === 'count' ? (
          <>
            <p className="caja-bar-sum">
              <span>
                Llevás contado
                {countedUnits(draft.count) > 0
                  ? ` · ${countedUnits(draft.count)} ${countedUnits(draft.count) === 1 ? 'billete' : 'billetes'}`
                  : ''}
              </span>
              <b data-testid="arqueo-contado">{formatCentsShort(counted)}</b>
            </p>
            <div className="caja-actions">
              <button
                type="button"
                className="caja-go"
                onClick={goCompare}
                data-testid="arqueo-listo"
              >
                <ArrowRight aria-hidden strokeWidth={2.6} />
                Ya conté: comparar
              </button>
            </div>
          </>
        ) : null}

        {step === 'compare' ? (
          <div className="caja-actions">
            {words.kind === 'exact' ? (
              <button
                type="button"
                className="caja-go"
                onClick={goLeave}
                data-testid="arqueo-seguir"
              >
                <ArrowRight aria-hidden strokeWidth={2.6} />
                Seguir
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={cn('caja-go', !recountFirst && 'is-quiet')}
                  onClick={goCount}
                  data-testid="arqueo-recontar"
                >
                  <RotateCcw aria-hidden strokeWidth={2.4} />
                  Contar de nuevo
                </button>
                <button
                  type="button"
                  className={cn('caja-go', recountFirst && 'is-quiet')}
                  onClick={goLeave}
                  data-testid="arqueo-seguir"
                >
                  {level === 'large' ? 'Cerrar igual' : 'Seguir con la diferencia'}
                </button>
              </>
            )}
          </div>
        ) : null}

        {step === 'leave' ? (
          <div className="caja-actions">
            <button
              type="button"
              className="caja-go"
              onClick={() => setConfirming(true)}
              disabled={!canClose}
              data-testid="arqueo-cerrar"
            >
              {canClose ? <LockKeyhole aria-hidden strokeWidth={2.4} /> : null}
              {leaveCents === null
                ? 'Escribí cuánto queda'
                : leaveOver
                  ? 'Es más de lo que contaste'
                  : leaveCheck.kind === 'ask'
                    ? 'Elegí cuál es el monto'
                    : noteNeeded
                      ? 'Escribí qué pasó'
                      : 'Cerrar el turno'}
            </button>
          </div>
        ) : null}
      </footer>

      <AlertDialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <AlertDialogContent className={cn('pos caja-sheet caja-confirm', posFont.variable)}>
          <AlertDialogTitle asChild>
            <h2>¿Cerrás el turno{shift.label ? ` ${shift.label}` : ''}?</h2>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="caja-sheet-body">
              <p>
                Contaste <b>{formatCentsShort(counted)}</b>
                {words.kind === 'exact' ? (
                  ', justo lo que tenía que haber'
                ) : (
                  <>
                    : <b>{words.text.toLowerCase()}</b>
                  </>
                )}
                . Quedan <b>{formatCentsShort(leaveCents ?? 0)}</b> de cambio y se retiran{' '}
                <b>{formatCentsShort(Math.max(0, counted - (leaveCents ?? 0)))}</b>.
              </p>
              <p>
                Cerrar no tiene vuelta. Después, un cobro de este turno solo lo corrige un dueño.
              </p>
            </div>
          </AlertDialogDescription>
          {error ? (
            <p className="caja-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="caja-sheet-foot">
            <button
              type="button"
              className="pos-btn pos-btn-quiet is-side"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Todavía no
            </button>
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              onClick={() => void close()}
              disabled={busy}
              data-testid="arqueo-confirmar"
            >
              {busy ? <LoaderCircle className="caja-spin size-5" aria-hidden /> : null}
              Cerrar el turno
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Un billete: cuántos hay. Más y menos grandes para el pulgar; la cantidad también se escribe. */
function BillRow({
  value,
  units,
  index,
  onSet,
  onBump,
}: {
  value: number
  units: number
  index: number
  onSet: (value: number, units: number) => void
  onBump: (value: number, delta: number) => void
}) {
  const label = formatCentsShort(value * 100)
  const minus = useHold(() => onBump(value, -1))
  const plus = useHold(() => onBump(value, 1))
  return (
    <li className="caja-bill">
      <span className="caja-bill-face">
        <span className="caja-bill-note">{label}</span>
        <span className="caja-bill-sub" aria-live="polite">
          {units > 0 ? `= ${formatCentsShort(value * 100 * units)}` : ''}
        </span>
      </span>
      <span className="caja-stepper">
        <button
          type="button"
          className="caja-step"
          {...minus}
          disabled={units <= 0}
          aria-label={`Un billete de ${label} menos`}
        >
          <Minus aria-hidden strokeWidth={2.6} />
        </button>
        <input
          className={cn('caja-units', units === 0 && 'is-zero')}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="next"
          maxLength={4}
          value={String(units)}
          aria-label={`Billetes de ${label}`}
          data-count-index={index}
          data-testid={`billete-${value}`}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
            onSet(value, digits === '' ? 0 : Number(digits))
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const next = document.querySelector<HTMLInputElement>(
              `[data-count-index="${index + 1}"]`,
            )
            if (next) next.focus()
            else event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          className="caja-step is-plus"
          {...plus}
          disabled={units >= MAX_BILL_COUNT}
          aria-label={`Un billete de ${label} más`}
          data-testid={`billete-mas-${value}`}
        >
          <Plus aria-hidden strokeWidth={2.6} />
        </button>
      </span>
    </li>
  )
}

/**
 * Un toque suma uno; mantener apretado sigue sumando, cada vez más rápido (para el fajo de veinte).
 * Con teclado, Enter o Espacio suman de a uno.
 */
function useHold(action: () => void) {
  const latest = useRef(action)
  useEffect(() => {
    latest.current = action
  })
  const timer = useRef<number | null>(null)
  const repeated = useRef(false)
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al irse; `stop` lee una referencia
  useEffect(() => stop, [])
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      stop()
      repeated.current = false
      // Si el botón se apaga mientras está apretado (llegó a cero), el «soltar» no le llega a él.
      window.addEventListener('pointerup', stop, { once: true })
      window.addEventListener('pointercancel', stop, { once: true })
      let delay = 420
      const tick = () => {
        repeated.current = true
        latest.current()
        delay = Math.max(55, delay * 0.8)
        timer.current = window.setTimeout(tick, delay)
      }
      timer.current = window.setTimeout(tick, delay)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    onClick: () => {
      // El toque que cierra una tanda de repeticiones no suma uno más.
      if (repeated.current) {
        repeated.current = false
        return
      }
      latest.current()
    },
  }
}
