'use client'

import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  ClockPlus,
  HandCoins,
  LoaderCircle,
  type LucideIcon,
  PencilLine,
  RotateCw,
  Search,
  Truck,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import {
  type CashPurpose,
  type CashTargets,
  CHOICE_COPY,
  findExactTarget,
  isStaffPurpose,
  MOVE_CHOICES,
  type MoveChoice,
  type MoveTarget,
  type PeriodRange,
  type PeriodShortcut,
  periodShortcuts,
  periodWords,
  purposeReason,
  readPeriod,
  searchTargets,
  targetFields,
  typedSupplierName,
} from '@/lib/pos/cash/targets'
import type { ShiftSummary } from '@/lib/pos/cash/types'
import { cn } from '@/lib/utils'
import { attempt, type CashApi, newKey } from './api'
import { MoveForm } from './move-form'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * «Sacar plata» cuando el bar usa Administración: primero para qué sale (un proveedor, un adelanto,
 * horas extra, el sueldo, u otro motivo), después a quién, y recién ahí cuánto. Un paso por pantalla
 * y casi todo se elige con un toque: lo único que se escribe es el monto.
 *
 * Quien atiende la caja ve NOMBRES y nada más (ni sueldos, ni saldos, ni lo que se le debe a un
 * proveedor): eso es de los socios, en Administración. El retiro queda anotado con su destino y ellos
 * lo levantan desde ahí.
 */

// ─── Las listas ──────────────────────────────────────────────────────────────

export type TargetsState = {
  status: 'loading' | 'ready' | 'error'
  data: CashTargets | null
  /** Por qué no llegó la lista (cuando no llegó). */
  message: string | null
  retry: () => void
}

/**
 * A quién se le puede pagar desde el cajón. Se pide cada vez que se abre la hoja; mientras llega la
 * lista nueva se sigue viendo la anterior (un proveedor recién cargado aparece al volver a abrir).
 */
export function useCashTargets(
  api: Pick<CashApi, 'targets'>,
  branchId: string,
  wanted: boolean,
): TargetsState {
  const [state, setState] = useState<Omit<TargetsState, 'retry'>>({
    status: 'loading',
    data: null,
    message: null,
  })
  const ticket = useRef(0)

  const load = useCallback(async () => {
    ticket.current += 1
    const mine = ticket.current
    setState((prev) => ({
      status: prev.data ? 'ready' : 'loading',
      data: prev.data,
      message: null,
    }))
    const result = await attempt(() => api.targets(branchId))
    // Llegó tarde: ya se pidió otra vez.
    if (ticket.current !== mine) return
    if (result.ok) {
      setState({ status: 'ready', data: result.data, message: null })
      return
    }
    setState((prev) => ({
      status: prev.data ? 'ready' : 'error',
      data: prev.data,
      message: result.message,
    }))
  }, [api, branchId])

  useEffect(() => {
    if (wanted) void load()
  }, [wanted, load])

  return { ...state, retry: () => void load() }
}

// ─── El recorrido ────────────────────────────────────────────────────────────

const CHOICE_ICON: Readonly<Record<MoveChoice, LucideIcon>> = {
  supplier: Truck,
  advance: HandCoins,
  overtime: ClockPlus,
  salary: Wallet,
  other: PencilLine,
}

export type Saved = {
  target: MoveTarget
  cents: number
  note: string
  period: PeriodRange | null
  movementId: string
  /** Lo que tiene que quedar en el cajón después de este retiro. */
  expectedAfterCents: number
}

type Step =
  | { at: 'choice' }
  | { at: 'who'; purpose: CashPurpose }
  | { at: 'amount'; target: MoveTarget }
  | { at: 'other' }
  | { at: 'done'; saved: Saved }

export function MoveOutFlow({
  shiftId,
  live,
  blind,
  practice,
  today,
  targets,
  purchaseHref,
  api,
  onClose,
  onDone,
  onSaved,
}: {
  shiftId: string
  live: ShiftSummary
  /** Quien anota no ve cuánto tiene que haber en el cajón. */
  blind: boolean
  /** El turno es de práctica: nada de esto llega a Administración. */
  practice: boolean
  /** El día del bar (`yyyy-MM-dd`), para los atajos de fechas. */
  today: string | null
  targets: TargetsState
  /** A dónde se carga la compra de un retiro; `null` si quien está no carga compras. */
  purchaseHref: ((movementId: string) => string) | null
  api: Pick<CashApi, 'move'>
  onClose: () => void
  /** El retiro con motivo escrito avisa con un cartel, como siempre. */
  onDone: (message: string) => void
  /** Se anotó un retiro con destino: la cinta se vuelve a leer (la hoja ya lo dice). */
  onSaved: () => void
}) {
  const [step, setStep] = useState<Step>({ at: 'choice' })
  // La misma clave mientras la hoja esté abierta: reintentar sin señal no anota dos veces.
  const [key] = useState(newKey)

  if (step.at === 'other') {
    return (
      <MoveForm
        kind="out"
        shiftId={shiftId}
        live={live}
        blind={blind}
        api={api}
        onBack={() => setStep({ at: 'choice' })}
        onClose={onClose}
        onDone={onDone}
      />
    )
  }
  if (step.at === 'choice') {
    return (
      <ChoiceStep
        onPick={(choice) =>
          setStep(choice === 'other' ? { at: 'other' } : { at: 'who', purpose: choice })
        }
      />
    )
  }
  if (step.at === 'who') {
    return (
      <WhoStep
        purpose={step.purpose}
        targets={targets}
        onBack={() => setStep({ at: 'choice' })}
        onOther={() => setStep({ at: 'other' })}
        onPick={(target) => setStep({ at: 'amount', target })}
      />
    )
  }
  if (step.at === 'amount') {
    const { target } = step
    return (
      <AmountStep
        target={target}
        shiftId={shiftId}
        live={live}
        blind={blind}
        today={today}
        idempotencyKey={key}
        api={api}
        onBack={() => setStep({ at: 'who', purpose: target.purpose })}
        onSaved={(saved) => {
          onSaved()
          setStep({ at: 'done', saved })
        }}
      />
    )
  }
  return (
    <DoneStep
      saved={step.saved}
      blind={blind}
      practice={practice}
      href={practice || !purchaseHref ? null : purchaseHref(step.saved.movementId)}
      onClose={onClose}
    />
  )
}

/** Al entrar a un paso, el foco va a su título: quien usa lector de pantalla escucha dónde está. */
function useStepFocus() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return ref
}

// ─── 1. Para qué sale ────────────────────────────────────────────────────────
// Los pasos se exportan para poder dibujarlos sueltos en las pruebas (`pos-cash-move-render`).

export function ChoiceStep({ onPick }: { onPick: (choice: MoveChoice) => void }) {
  return (
    <div className="pos-sheet-body caja-sheet-body" data-testid="retiro-destinos">
      <div className="caja-sheet-head">
        <SheetTitle className="pos-sheet-title caja-sheet-title">
          ¿Para qué sale la plata?
        </SheetTitle>
        <SheetDescription className="caja-sheet-sub is-ink">
          Queda anotado con tu nombre.
        </SheetDescription>
      </div>
      <div className="caja-purposes">
        {MOVE_CHOICES.map((choice) => {
          const Icon = CHOICE_ICON[choice]
          const copy = CHOICE_COPY[choice]
          return (
            <button
              key={choice}
              type="button"
              className={cn('caja-purpose', choice === 'other' && 'is-wide')}
              onClick={() => onPick(choice)}
              data-testid={`retiro-para-${choice}`}
            >
              <span className="caja-purpose-icon" aria-hidden>
                <Icon strokeWidth={2.2} />
              </span>
              <span className="caja-purpose-text">
                <b>{copy.label}</b>
                <small>{copy.hint}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── 2. A quién ──────────────────────────────────────────────────────────────

/** Con hasta esta cantidad de personas, la lista entra de un vistazo: sin buscador. */
const SEARCH_FROM = 7

export function WhoStep({
  purpose,
  targets,
  onBack,
  onOther,
  onPick,
}: {
  purpose: CashPurpose
  targets: TargetsState
  onBack: () => void
  onOther: () => void
  onPick: (target: MoveTarget) => void
}) {
  const [query, setQuery] = useState('')
  const head = useStepFocus()
  const copy = CHOICE_COPY[purpose]
  const staff = isStaffPurpose(purpose)
  const data = targets.data
  const list = useMemo(() => (data ? (staff ? data.employees : data.suppliers) : []), [data, staff])
  const results = useMemo(() => searchTargets(list, query), [list, query])
  const typed = staff ? null : typedSupplierName(query)
  // Lo escrito no es nadie de la lista: se puede anotar igual, con ese nombre.
  const typedName = typed !== null && findExactTarget(list, query) === null ? typed : null
  const searching = query.trim() !== ''
  const showSearch = !staff || list.length >= SEARCH_FROM
  const loading = targets.status === 'loading'
  const failed = targets.status === 'error'
  // Sin buscar, el equipo se lee en dos tandas: los de esta sucursal y el resto.
  const split =
    staff && !searching && data ? data.employees.findIndex((employee) => !employee.here) : -1

  const pick = (id: string, name: string) => {
    if (purpose === 'supplier') onPick({ purpose, partyId: id, name })
    else onPick({ purpose, employeeId: id, name })
  }
  const pickTyped = () => {
    if (typedName !== null) onPick({ purpose: 'supplier', partyId: null, name: typedName })
  }

  return (
    <form
      // Con buscador la hoja es alta y no cambia de alto mientras se escribe; una lista corta mide lo suyo.
      className={cn('pos-sheet-body caja-sheet-body caja-who', showSearch && 'has-search')}
      data-testid="retiro-a-quien"
      onSubmit={(event) => {
        // «Buscar» en el teclado: si quedó uno solo, es ese.
        event.preventDefault()
        const only = results.length === 1 ? results[0] : undefined
        if (only) pick(only.id, only.name)
        else if (results.length === 0) pickTyped()
      }}
    >
      <div className="caja-sheet-head" ref={head} tabIndex={-1}>
        <button type="button" className="caja-step-back" onClick={onBack}>
          <ChevronLeft aria-hidden strokeWidth={2.6} />
          {copy.label}
        </button>
        <SheetTitle className="pos-sheet-title caja-sheet-title">{copy.who}</SheetTitle>
        <SheetDescription className="sr-only">
          Elegí de la lista{staff ? '' : ' o escribí el nombre'}.
        </SheetDescription>
      </div>

      {showSearch ? (
        // Pegado arriba mientras la lista pasa por debajo: con muchos proveedores se sigue viendo.
        <div className="caja-search-dock">
          <div className="caja-search">
            <Search aria-hidden strokeWidth={2.4} />
            <input
              type="search"
              value={query}
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              data-testid="retiro-buscar"
            />
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className="caja-error" role="alert">
          <p>{targets.message ?? 'No pude traer la lista.'}</p>
          <div className="caja-error-acts">
            <button type="button" className="caja-opt" onClick={targets.retry}>
              <RotateCw aria-hidden />
              Reintentar
            </button>
            {staff ? (
              <button type="button" className="caja-opt" onClick={onOther}>
                Anotarlo con otro motivo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? (
        <ul className="caja-pick" aria-busy="true" aria-label="Trayendo la lista">
          {['a', 'b', 'c', 'd'].map((slot) => (
            <li key={slot} className="caja-pick-skel" />
          ))}
        </ul>
      ) : null}

      {!loading && !failed && list.length === 0 ? (
        <p className="caja-pick-empty">
          {staff
            ? 'Todavía no hay nadie del equipo cargado en Sueldos. Pedile a un socio que lo cargue; mientras tanto, anotalo con otro motivo.'
            : 'Todavía no hay proveedores cargados en Administración. Escribí el nombre arriba y queda anotado igual.'}
        </p>
      ) : null}
      {!loading && !failed && staff && list.length === 0 ? (
        <button type="button" className="pos-btn pos-btn-quiet" onClick={onOther}>
          Anotarlo con otro motivo
        </button>
      ) : null}

      {results.length > 0 ? (
        <ul className="caja-pick" aria-label={staff ? 'El equipo' : 'Proveedores'}>
          {results.map((item, index) => (
            <li key={item.id}>
              {split > 0 && index === split ? (
                <p className="caja-pick-sep">De otra sucursal</p>
              ) : null}
              <button
                type="button"
                className="caja-pick-row"
                onClick={() => pick(item.id, item.name)}
                data-testid="retiro-elegir"
              >
                <span>{item.name}</span>
                <ChevronRight aria-hidden strokeWidth={2.4} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {typedName !== null && results.length === 0 ? (
        <button
          type="button"
          className="caja-pick-row is-typed"
          onClick={pickTyped}
          data-testid="retiro-a-mano"
        >
          <span>
            Usar «{typedName}»<small>No está en la lista</small>
          </span>
          <ChevronRight aria-hidden strokeWidth={2.4} />
        </button>
      ) : null}
      {typedName !== null && results.length > 0 ? (
        <button
          type="button"
          className="caja-pick-alt"
          onClick={pickTyped}
          data-testid="retiro-a-mano"
        >
          ¿No es ninguno? Usar «{typedName}»
        </button>
      ) : null}

      {!loading && searching && results.length === 0 && typedName === null ? (
        <p className="caja-pick-empty" aria-live="polite">
          {staff
            ? 'No hay nadie con ese nombre. Probá con otra parte del nombre.'
            : 'Seguí escribiendo el nombre.'}
        </p>
      ) : null}
      {!staff && !searching && list.length > 0 ? (
        <p className="caja-pick-hint">¿No está en la lista? Escribí el nombre arriba.</p>
      ) : null}
    </form>
  )
}

// ─── 3. Cuánto ───────────────────────────────────────────────────────────────

type PeriodPick = { pick: PeriodShortcut['id'] | 'custom' | null; from: string; to: string }

export function AmountStep({
  target,
  shiftId,
  live,
  blind,
  today,
  idempotencyKey,
  api,
  onBack,
  onSaved,
}: {
  target: MoveTarget
  shiftId: string
  live: ShiftSummary
  blind: boolean
  today: string | null
  idempotencyKey: string
  api: Pick<CashApi, 'move'>
  onBack: () => void
  onSaved: (saved: Saved) => void
}) {
  const amount = useTypedAmount()
  const [note, setNote] = useState('')
  const [period, setPeriod] = useState<PeriodPick>({ pick: null, from: '', to: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  // Ya se sabe para qué y a quién: lo que falta es el monto.
  useEffect(() => {
    field.current?.focus({ preventScroll: true })
  }, [])

  const copy = CHOICE_COPY[target.purpose]
  const Icon = CHOICE_ICON[target.purpose]
  const supplier = target.purpose === 'supplier'
  const typedSupplier = target.purpose === 'supplier' && target.partyId === null
  // Solo el pago de un sueldo dice qué fechas cubre: un adelanto o unas horas extra son el monto y listo.
  const dated = target.purpose === 'salary'
  const expected = live.expected_cash_cents
  // A ciegas no hay con qué comparar: «es más de lo que hay» sería decir cuánto hay.
  const check = amount.check(blind ? {} : { capCents: expected })
  const cents = amount.cents

  const shortcuts = useMemo(() => (dated && today ? periodShortcuts(today) : []), [dated, today])
  const range: PeriodRange | null =
    period.pick === null
      ? null
      : period.pick === 'custom'
        ? readPeriod(period.from, period.to)
        : (shortcuts.find((shortcut) => shortcut.id === period.pick) ?? null)
  const badRange =
    period.pick === 'custom' && (period.from !== '' || period.to !== '') && range === null
  const ready = cents !== null && cents > 0 && check.kind === 'ok' && !badRange

  const submit = async () => {
    if (!ready || busy || cents === null) return
    setBusy(true)
    setError(null)
    const result = await attempt(() =>
      api.move({
        shiftId,
        kind: 'out',
        amountCents: cents,
        ...targetFields(target, note, range),
        idempotencyKey,
      }),
    )
    if (!result.ok) {
      setBusy(false)
      setError(result.message)
      return
    }
    onSaved({
      target,
      cents,
      note: supplier && !typedSupplier ? note.trim() : '',
      period: dated ? range : null,
      movementId: result.data.movement_id,
      expectedAfterCents: expected - cents,
    })
  }

  const label =
    cents === null || cents <= 0
      ? 'Escribí el monto'
      : check.kind === 'ask'
        ? 'Elegí cuál es el monto'
        : badRange
          ? 'Revisá las fechas'
          : `Anotar retiro de ${formatCentsShort(cents)}`

  return (
    <>
      <form
        className="pos-sheet-body caja-sheet-body has-foot"
        data-testid="retiro-cuanto"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="caja-sheet-head">
          <button type="button" className="caja-step-back" onClick={onBack} disabled={busy}>
            <ChevronLeft aria-hidden strokeWidth={2.6} />
            {supplier ? 'Otro proveedor' : 'Otra persona'}
          </button>
          <SheetTitle className="pos-sheet-title caja-sheet-title">{target.name}</SheetTitle>
          <SheetDescription className="caja-stub">
            <Icon aria-hidden strokeWidth={2.3} />
            {copy.label}
            {typedSupplier ? ' · no está en la lista' : ''}
          </SheetDescription>
        </div>

        {error ? (
          <p className="caja-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="caja-field">
          <label htmlFor="caja-out-amount">¿Cuánto?</label>
          <div className="caja-pesos">
            <span aria-hidden>$</span>
            <PesosInput
              ref={field}
              id="caja-out-amount"
              value={amount.text}
              onChange={amount.setText}
              disabled={busy}
              data-testid="retiro-monto"
            />
          </div>
        </div>

        {check.kind === 'ask' ? (
          <TypedGuard
            ask={check}
            why={
              check.why === 'over'
                ? `En el cajón tiene que haber ${formatCentsShort(expected)}: es más de lo que hay.`
                : null
            }
            onPick={amount.set}
          />
        ) : null}

        {supplier && !typedSupplier ? (
          <div className="caja-field">
            <label htmlFor="caja-out-note">
              N.º de factura o remito <small>· si lo tenés</small>
            </label>
            <input
              id="caja-out-note"
              className="caja-input"
              type="text"
              value={note}
              maxLength={60}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Por ejemplo: Remito 0012"
              autoComplete="off"
              enterKeyHint="done"
              disabled={busy}
              data-testid="retiro-nota"
            />
          </div>
        ) : null}

        {dated ? (
          <fieldset className="caja-group" disabled={busy}>
            <legend>
              <span className="pos-sheet-q">¿Qué fechas cubre?</span>
              <small>Si lo sabés</small>
            </legend>
            <div className="caja-opts">
              {shortcuts.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  className="caja-opt"
                  aria-pressed={period.pick === shortcut.id}
                  onClick={() =>
                    setPeriod((prev) => ({
                      ...prev,
                      pick: prev.pick === shortcut.id ? null : shortcut.id,
                    }))
                  }
                >
                  {shortcut.label}
                </button>
              ))}
              <button
                type="button"
                className="caja-opt"
                aria-pressed={period.pick === 'custom'}
                onClick={() =>
                  setPeriod((prev) => ({ ...prev, pick: prev.pick === 'custom' ? null : 'custom' }))
                }
              >
                Otras fechas
              </button>
            </div>
            {period.pick === 'custom' ? (
              <div className="caja-dates">
                <label>
                  <span>Desde</span>
                  <input
                    className="caja-input"
                    type="date"
                    value={period.from}
                    max={period.to || undefined}
                    onChange={(event) =>
                      setPeriod((prev) => ({ ...prev, from: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Hasta</span>
                  <input
                    className="caja-input"
                    type="date"
                    value={period.to}
                    min={period.from || undefined}
                    onChange={(event) => setPeriod((prev) => ({ ...prev, to: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}
            {badRange ? (
              <p className="caja-period-says is-bad" role="alert">
                La primera fecha tiene que ser anterior a la segunda.
              </p>
            ) : range ? (
              <p className="caja-period-says" aria-live="polite">
                {periodWords(range)}
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </form>

      <div className="caja-sheet-foot">
        <button
          type="button"
          className="pos-btn pos-btn-primary"
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid="retiro-anotar"
        >
          {busy ? <LoaderCircle className="caja-spin size-5" aria-hidden /> : null}
          {label}
        </button>
      </div>
    </>
  )
}

// ─── 4. Anotado ──────────────────────────────────────────────────────────────

export function DoneStep({
  saved,
  blind,
  practice,
  href,
  onClose,
}: {
  saved: Saved
  blind: boolean
  practice: boolean
  /** La compra se puede cargar ya (quien está tiene ese acceso). */
  href: string | null
  onClose: () => void
}) {
  const head = useStepFocus()
  const { target } = saved
  const supplier = target.purpose === 'supplier'
  const typedSupplier = target.purpose === 'supplier' && target.partyId === null
  // El renglón se lee como queda en la cinta: para qué, a quién y, si se dijo, el comprobante o las fechas.
  const reason = purposeReason(
    target.purpose,
    target.name,
    [saved.note, saved.period ? periodWords(saved.period) : ''].filter(Boolean).join(' · '),
  )
  const says = practice
    ? 'Es un turno de práctica: no va a Administración.'
    : supplier && href
      ? 'Quedó anotado para Administración. Podés cargar la compra ahora o más tarde.'
      : supplier
        ? 'Quedó anotado para Administración: quien carga las compras lo ve ahí.'
        : CHOICE_COPY[target.purpose].done

  return (
    <>
      <div className="pos-sheet-body caja-sheet-body has-foot" data-testid="retiro-anotado">
        <div className="caja-done" ref={head} tabIndex={-1}>
          <span className="caja-stamp is-big is-noted">
            <BadgeCheck aria-hidden strokeWidth={2.6} />
            Anotado
          </span>
          <SheetTitle className="pos-sheet-title caja-sheet-title">
            − {formatCentsShort(saved.cents)}
          </SheetTitle>
          <SheetDescription className="caja-sheet-sub">
            {reason}
            {typedSupplier ? ' (no está en la lista)' : ''}
          </SheetDescription>
          <p className="caja-done-says" role="status">
            {says}
          </p>
          {blind ? null : (
            <p className="caja-sheet-sub is-ink">
              En el cajón tiene que haber {formatCentsShort(saved.expectedAfterCents)}.
            </p>
          )}
        </div>
      </div>

      <div className="caja-sheet-foot">
        {supplier && href ? (
          <>
            <button
              type="button"
              className="pos-btn pos-btn-quiet is-side"
              onClick={onClose}
              data-testid="retiro-listo"
            >
              Listo
            </button>
            <Link
              className="pos-btn pos-btn-primary"
              href={href}
              data-testid="retiro-cargar-compra"
            >
              Cargar la compra ahora
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="pos-btn pos-btn-primary"
            onClick={onClose}
            data-testid="retiro-listo"
          >
            Listo
          </button>
        )}
      </div>
    </>
  )
}
