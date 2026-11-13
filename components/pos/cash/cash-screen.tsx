'use client'

import {
  AlarmClock,
  BanknoteArrowDown,
  BanknoteArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  GraduationCap,
  History,
  LoaderCircle,
  LockKeyhole,
  ReceiptText,
  Send,
  WifiOff,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOnline } from '@/components/pos/order/use-online'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import { buildShiftReport, shiftPlace, shiftShareText } from '@/lib/pos/cash/report'
import {
  cashPhase,
  dayLabel,
  drawerSentence,
  liveSentence,
  movementAccess,
  openShiftIds,
  paymentAccess,
  pickRegister,
  shiftTitle,
  staleWords,
} from '@/lib/pos/cash/screen'
import { buildTape, type TapeFilter } from '@/lib/pos/cash/tape'
import {
  type CashMovement,
  type DayPayment,
  METHOD_LABEL,
  PAY_METHODS,
  type Shift,
  type ShiftRow,
  type ShiftSnapshot,
  type ShiftSummary,
} from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import type { PosBranch } from '@/lib/pos/types'
import { useLiveReload } from '@/lib/pos/use-live-reload'
import { usePosPoke } from '@/lib/pos/use-poke'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { cn } from '@/lib/utils'
import { attempt, type CashApi, type Failure } from './api'
import { CloseFlow, type CloseInput } from './close-flow'
import { METHOD_ICON } from './method'
import { MovementSheet, MoveSheet } from './movement-sheets'
import { notify } from './notify'
import { type OpenInput, OpenShift } from './open-shift'
import { PaymentSheet } from './payment-sheet'
import { ShiftReportSlip } from './shift-report'
import { ShiftsSheet } from './shifts-sheet'
import { Tape, type TapeMark } from './tape'
import './cash.css'

/**
 * La caja de una sucursal: la registradora entera en una pantalla.
 *
 * Arriba, una barra fina (la sucursal con su color, el turno). Después el visor: cuánto entró, en
 * una oración, y las teclas de los medios de pago, que cuentan y filtran. En el medio, la cinta: se
 * escribe sola con cada cobro, lo último arriba. Abajo, el cajón: cuánto efectivo tiene que haber
 * y lo que se hace con él (sacar, guardar, contar y cerrar).
 *
 * La pantalla no decide permisos ni recalcula plata: muestra lo que devuelve la base
 * (`ShiftSnapshot`) y vuelve a leer cuando otra pantalla mueve la caja.
 */

type Props = {
  api: CashApi
  initial: ShiftSnapshot
  /** La sucursal en la que trabaja este dispositivo, con su color. */
  branch: PosBranch
  branches: ReadonlyArray<PosBranch>
  /** Turnos anteriores: los dueños, los de cualquier fecha; la caja, los de hoy. */
  shifts: ReadonlyArray<ShiftRow>
  timeZone: string
  /** El botón de la cuenta de quien trabaja, armado en la página. */
  account?: React.ReactNode
}

/** Qué se le pide a la base: el carril (de verdad o práctica) y, si no es el de siempre, qué turno. */
type Lane = { practice: boolean; shiftId: string | null }
type Mode = 'main' | 'closing' | 'summary'

/** El monto sin el signo de pesos, que en el número grande va aparte y más chico. */
function digitsOf(cents: number): string {
  return formatCentsShort(cents, { currency: false })
}

export function CashScreen({ api, initial, branch, branches, shifts, timeZone, account }: Props) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState(initial)
  const [lane, setLane] = useState<Lane>({ practice: initial.practice, shiftId: null })
  const [mode, setMode] = useState<Mode>('main')
  const [registerId, setRegisterId] = useState<string | null>(null)
  const [filter, setFilter] = useState<TapeFilter>('all')
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [movementId, setMovementId] = useState<string | null>(null)
  const [moveKind, setMoveKind] = useState<'in' | 'out' | null>(null)
  const [shiftsOpen, setShiftsOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [branchMenu, setBranchMenu] = useState(false)
  const [busy, setBusy] = useState<'open' | 'lane' | 'branch' | null>(null)
  const [mark, setMark] = useState<TapeMark>(null)
  const [closingFrom, setClosingFrom] = useState(initial.now)
  const scrollRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef(lane)
  /** Cambia cada vez que se pide otro turno u otro carril: una lectura vieja que llega tarde no pisa. */
  const readTicket = useRef(0)
  const closedHere = useRef(false)
  const openedHere = useRef(false)

  // Si la página se vuelve a leer entera (al volver a la app), manda lo nuevo, salvo que se esté
  // mirando otro turno o el carril de práctica: eso se lee desde acá.
  useEffect(() => {
    if (laneRef.current.shiftId === null && laneRef.current.practice === initial.practice) {
      setSnapshot(initial)
    }
  }, [initial])

  // ── Lecturas ──
  const read = useCallback(async () => {
    const ticket = readTicket.current
    const result = await attempt(() => api.refresh(branch.id, laneRef.current))
    // Mientras viajaba se pidió otro turno: esta respuesta ya es vieja.
    if (!result.ok || readTicket.current !== ticket) return
    setSnapshot(result.data)
  }, [api, branch.id])
  // No pierde un aviso que llega durante una lectura (un cobro que entra mientras se relee tiene
  // que verse) y nunca lee más de una vez cada 900 ms: las reglas de `lib/pos/live-reload.ts`.
  const { poke, now: reload } = useLiveReload(read)
  const loadLane = async (next: Lane, quiet = false): Promise<ShiftSnapshot | null> => {
    readTicket.current += 1
    const ticket = readTicket.current
    const result = await attempt(() => api.refresh(branch.id, next))
    if (!result.ok) {
      if (!quiet) notify.error(result.message)
      return null
    }
    if (readTicket.current !== ticket) return null
    laneRef.current = next
    setLane(next)
    setSnapshot(result.data)
    return result.data
  }
  // Otro celular cobró, anotó un retiro o cerró el turno: la base avisa y se vuelve a leer. Lo del
  // salón también (una mesa que pide más cambia lo pendiente). La cocina y la carta no mueven la caja.
  const live = usePosPoke(branch.id, (what) => {
    if (what !== 'kitchen' && what !== 'menu') poke()
  })
  // Red de seguridad: si un aviso en vivo se pierde, igual se pone al día.
  useVisibleInterval(reload, 40_000)
  const online = useOnline()
  const offline = !online || live === 'offline'

  // ── En qué momento está la caja ──
  const register = pickRegister(snapshot, registerId)
  const phase = cashPhase(snapshot, register, timeZone)
  const shift = snapshot.shift
  const openIds = useMemo(() => openShiftIds(snapshot), [snapshot])
  const manyRegisters = snapshot.registers.length > 1
  const practice = snapshot.practice

  // La caja elegida tiene un turno abierto que no es el que se leyó: se pide ese.
  const wantedShift = phase.kind === 'loading' ? phase.shiftId : null
  useEffect(() => {
    if (!wantedShift) return
    void (async () => {
      readTicket.current += 1
      const ticket = readTicket.current
      const next = { practice: laneRef.current.practice, shiftId: wantedShift }
      const result = await attempt(() => api.refresh(branch.id, next))
      if (!result.ok || readTicket.current !== ticket) return
      laneRef.current = next
      setLane(next)
      setSnapshot(result.data)
    })()
  }, [wantedShift, api, branch.id])

  // Otro dispositivo cerró el turno mientras acá se contaba: se sale del arqueo y se muestra cómo quedó.
  const closingButClosed = mode === 'closing' && phase.kind !== 'open'
  useEffect(() => {
    if (!closingButClosed) return
    setMode(shift?.status === 'closed' ? 'summary' : 'main')
    if (!closedHere.current) notify.info('Este turno se cerró desde otro dispositivo.')
    closedHere.current = false
  }, [closingButClosed, shift?.status])
  // Otro dispositivo abrió el turno mientras acá se estaba por abrir: se dice quién fue. Solo cuenta
  // si es la misma caja y el mismo carril (pasar de una caja a otra no es que alguien abrió).
  const phaseKind = phase.kind
  const watched = `${practice ? 'practica' : 'real'}:${register?.id ?? ''}`
  const lastPhase = useRef({ kind: phaseKind, watched })
  const openedBy = phase.kind === 'open' ? phase.shift.opened_by_name : null
  useEffect(() => {
    const before = lastPhase.current
    lastPhase.current = { kind: phaseKind, watched }
    const sameBox = before.watched === watched || before.watched.endsWith(':')
    const wasShut = before.kind === 'closed' || before.kind === 'first'
    if (phaseKind !== 'open' || !wasShut || !sameBox) return
    if (!openedHere.current && openedBy) {
      notify.info(`${openedBy} abrió el turno desde otro dispositivo.`)
    }
    openedHere.current = false
  }, [phaseKind, watched, openedBy])

  const view: Mode =
    mode === 'summary' && shift?.status !== 'closed'
      ? 'main'
      : closingButClosed
        ? shift?.status === 'closed'
          ? 'summary'
          : 'main'
        : mode

  // ── La cinta ──
  const tape = useMemo(
    () =>
      buildTape({
        shift: snapshot.shift,
        payments: snapshot.payments,
        movements: snapshot.live?.movements ?? [],
      }),
    [snapshot],
  )
  const payment = paymentId
    ? (snapshot.payments.find((candidate) => candidate.id === paymentId) ?? null)
    : null
  const movement = movementId
    ? (snapshot.live?.movements.find((candidate) => candidate.id === movementId) ?? null)
    : null
  const openPayment = useCallback((target: DayPayment) => setPaymentId(target.id), [])
  const openMovement = useCallback((target: CashMovement) => setMovementId(target.id), [])
  const chooseFilter = (next: TapeFilter) => {
    setFilter(next)
    // La cinta filtrada arranca desde arriba: ahí está la suma.
    if (next !== 'all') scrollRef.current?.scrollTo({ top: 0 })
  }
  const changed = (message: string) => {
    notify.ok(message)
    void reload()
  }

  // ── Acciones ──
  const open = async (input: OpenInput) => {
    if (busy) return
    setBusy('open')
    openedHere.current = true
    const result = await attempt(() =>
      api.open({
        branchId: branch.id,
        openingFloatCents: input.openingFloatCents,
        label: input.label,
        note: input.note,
        registerId: register?.id ?? null,
        practice: lane.practice,
      }),
    )
    if (!result.ok) {
      openedHere.current = false
      setBusy(null)
      notify.error(result.message)
      return
    }
    setRegisterId(result.data.register_id)
    setFilter('all')
    setMode('main')
    await loadLane({
      practice: lane.practice,
      shiftId: manyRegisters ? result.data.shift_id : null,
    })
    setBusy(null)
    if (result.data.already_open) {
      notify.info('Ese turno ya estaba abierto: lo abrieron desde otro dispositivo.')
    }
  }

  const close = async (input: CloseInput): Promise<Failure | null> => {
    if (phase.kind !== 'open') {
      return { ok: false, message: 'Ese turno ya se cerró.', code: 'shift_not_open' }
    }
    const closing = phase.shift
    closedHere.current = true
    const result = await attempt(() =>
      api.close({
        shiftId: closing.id,
        countedCents: input.countedCents,
        breakdown: input.breakdown,
        leaveFloatCents: input.leaveFloatCents,
        note: input.note,
      }),
    )
    if (!result.ok) {
      closedHere.current = false
      return result
    }
    // El turno ya cerró: si no se puede volver a leer no es un error para mostrar.
    const fresh = await loadLane({ practice: lane.practice, shiftId: closing.id }, true)
    if (!fresh) {
      // Se cerró pero no se pudo volver a leer: se arma con lo que contestó el cierre.
      const data = result.data
      setSnapshot((current) => ({
        ...current,
        shift: {
          ...closing,
          status: 'closed',
          closed_at: data.summary.closed_at ?? current.now,
          counted_cash_cents: data.counted_cash_cents,
          count_breakdown: input.breakdown,
          expected_cash_cents: data.expected_cash_cents,
          difference_cents: data.difference_cents,
          leave_float_cents: data.leave_float_cents,
          closing_note: input.note,
          summary: data.summary,
        },
        live: data.summary,
        registers: current.registers.map((candidate) =>
          candidate.id === closing.register_id ? { ...candidate, open_shift_id: null } : candidate,
        ),
      }))
    }
    setFilter('all')
    setMode('summary')
    return null
  }

  const startClose = () => {
    notify.clear()
    setClosingFrom(snapshot.now)
    setFilter('all')
    setMode('closing')
  }

  const viewShift = async (shiftId: string, registerOf: string | null) => {
    if (busy) return
    setBusy('lane')
    const fresh = await loadLane({ practice: lane.practice, shiftId })
    setBusy(null)
    if (!fresh) return
    setFilter('all')
    if (registerOf) setRegisterId(registerOf)
    setMode(fresh.shift?.status === 'closed' ? 'summary' : 'main')
  }

  const leaveSummary = async () => {
    if (busy) return
    if (lane.shiftId !== null) {
      setBusy('lane')
      const fresh = await loadLane({ practice: lane.practice, shiftId: null })
      setBusy(null)
      if (!fresh) return
    }
    setFilter('all')
    setMode('main')
  }

  const togglePractice = async () => {
    if (busy) return
    setShiftsOpen(false)
    setBusy('lane')
    const fresh = await loadLane({ practice: !lane.practice, shiftId: null })
    setBusy(null)
    if (!fresh) return
    setRegisterId(null)
    setFilter('all')
    setMode('main')
  }

  const switchBranch = async (next: PosBranch) => {
    setBranchMenu(false)
    if (next.id === branch.id || busy) return
    setBusy('branch')
    const result = await attempt(() => api.setBranch(next.id))
    if (!result.ok) {
      setBusy(null)
      notify.error(result.message)
      return
    }
    router.refresh()
  }

  const pickRegisterTab = (id: string) => {
    setRegisterId(id)
    setFilter('all')
    setMode('main')
    const target = snapshot.registers.find((candidate) => candidate.id === id)
    // Si esa caja tiene su turno abierto, se pide solo (la pantalla lo nota y lo lee). Si está
    // cerrada y se venía mirando un turno puntual, se vuelve a la lectura de siempre.
    if (!target?.open_shift_id && lane.shiftId !== null) {
      void loadLane({ practice: lane.practice, shiftId: null })
    }
  }

  // ── El resumen (turno cerrado) y el detalle (turno abierto) ──
  const report = useMemo(() => {
    if (!shift) return null
    const summary = shift.status === 'closed' ? (shift.summary ?? snapshot.live) : snapshot.live
    if (!summary) return null
    return buildShiftReport({
      branchName: snapshot.branch.name,
      shift,
      summary,
      timeZone,
      registersCount: snapshot.registers.length,
      liveAfter: shift.status === 'closed' ? snapshot.live : null,
    })
  }, [shift, snapshot.live, snapshot.branch.name, snapshot.registers.length, timeZone])

  const copySummary = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(shiftShareText(report))
      notify.ok('Resumen copiado. Pegalo donde quieras.')
    } catch {
      notify.error('No se pudo copiar. Probá mandarlo por WhatsApp.')
    }
  }

  // ── La barra de arriba ──
  const branchPill = (
    <div className="pos-top-branch-wrap">
      <button
        type="button"
        className="pos-top-branch"
        onClick={() => branches.length > 1 && setBranchMenu((value) => !value)}
        aria-haspopup={branches.length > 1 ? 'true' : undefined}
        aria-expanded={branches.length > 1 ? branchMenu : undefined}
        disabled={busy === 'branch'}
      >
        <span
          className={cn('pos-top-dot', live === 'live' && 'is-live', offline && 'is-off')}
          aria-hidden
        />
        <span className="truncate">{branch.short_name ?? branch.name}</span>
        {branches.length > 1 ? (
          <ChevronDown className="size-4 shrink-0 opacity-80" aria-hidden />
        ) : null}
        <span className="sr-only">
          {offline ? ', sin conexión' : live === 'live' ? ', en vivo' : ', conectando'}
        </span>
      </button>
      {branchMenu ? (
        <ul className="pos-branch-menu" aria-label="Sucursal">
          {branches.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                aria-current={option.id === branch.id ? 'true' : undefined}
                onClick={() => void switchBranch(option)}
                style={{ ['--branch' as string]: option.color }}
              >
                <span className="pos-band-swatch" aria-hidden />
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
  const shiftsButton = (
    <button
      type="button"
      className="caja-top-btn"
      onClick={() => setShiftsOpen(true)}
      aria-label="Turnos anteriores"
      data-testid="caja-turnos"
    >
      {busy === 'lane' ? (
        <LoaderCircle className="caja-spin" aria-hidden />
      ) : (
        <History aria-hidden strokeWidth={2.2} />
      )}
      <span>Turnos</span>
    </button>
  )
  const clock = clockAt(snapshot.now, timeZone)

  // ── Avisos ──
  const notices = (
    <div className="caja-notes">
      {offline ? (
        <p className="caja-notice is-off" role="status">
          <WifiOff aria-hidden />
          <span>
            <b>Sin conexión.</b> Lo que ves es de las {clock}; se pone al día solo cuando vuelva.
          </span>
        </p>
      ) : null}
      {practice ? (
        <p className="caja-notice" role="status">
          <GraduationCap aria-hidden />
          <span>
            <b>Turno de práctica.</b> Nada de esto entra en los números ni en el cajón de verdad.
          </span>
          <button
            type="button"
            className="caja-notice-btn"
            onClick={() => void togglePractice()}
            data-testid="practica-salir"
          >
            Salir
          </button>
        </p>
      ) : null}
      {view === 'main' && phase.kind === 'open' && phase.staleDays > 0 ? (
        <p className="caja-notice" role="status">
          <AlarmClock aria-hidden />
          <span>
            <b>
              Este turno es {staleWords(phase.staleDays, phase.shift.service_day)} y sigue abierto.
            </b>{' '}
            Lo que se cobre ahora entra acá.
          </span>
          <button type="button" className="caja-notice-btn" onClick={startClose}>
            Cerrarlo
          </button>
        </p>
      ) : null}
    </div>
  )

  const sheets = (
    <>
      <PaymentSheet
        payment={payment}
        access={payment ? paymentAccess(payment, snapshot.role, openIds) : null}
        settings={snapshot.settings}
        timeZone={timeZone}
        api={api}
        onClose={() => setPaymentId(null)}
        onChanged={changed}
      />
      <MovementSheet
        movement={movement}
        access={movement ? movementAccess(movement, snapshot.role, shift?.status === 'open') : null}
        timeZone={timeZone}
        api={api}
        onClose={() => setMovementId(null)}
        onChanged={changed}
      />
      <ShiftsSheet
        open={shiftsOpen}
        shifts={shifts}
        registers={snapshot.registers}
        currentId={shift?.id ?? null}
        ownerView={snapshot.role === 'owner'}
        practice={practice}
        timeZone={timeZone}
        onClose={() => setShiftsOpen(false)}
        onPick={(row) => {
          setShiftsOpen(false)
          void viewShift(row.id, row.register_id)
        }}
        onPractice={() => void togglePractice()}
      />
    </>
  )

  const shell = (children: React.ReactNode) => (
    <div
      className="caja"
      style={{ ['--branch' as string]: branch.color }}
      data-view={view}
      data-phase={phase.kind}
      data-practice={practice ? '' : undefined}
      data-testid="caja"
    >
      {children}
      {sheets}
    </div>
  )

  // ── Cerrar el turno ──
  if (view === 'closing' && phase.kind === 'open' && snapshot.live) {
    return shell(
      <CloseFlow
        key={phase.shift.id}
        shift={phase.shift}
        live={snapshot.live}
        payments={snapshot.payments}
        denominations={snapshot.settings.bill_denominations}
        pendingApprovals={snapshot.pending_approvals.length}
        now={closingFrom}
        timeZone={timeZone}
        account={account}
        notices={notices}
        onCancel={() => setMode('main')}
        onClose={close}
        onPayment={setPaymentId}
        onMovement={setMovementId}
        onMark={setMark}
      >
        <section className="caja-roll" aria-label="La cinta del turno">
          <div className="caja-slot" aria-hidden />
          <Tape
            key={phase.shift.id}
            tape={tape}
            filter={filter}
            onFilter={chooseFilter}
            live={snapshot.live}
            invoiceByMethod={snapshot.settings.invoice_by_method}
            timeZone={timeZone}
            practice={practice}
            variant="roll"
            mark={mark}
            onPayment={openPayment}
            onMovement={openMovement}
          />
        </section>
      </CloseFlow>,
    )
  }

  // ── El turno resumido ──
  if (view === 'summary' && shift && report) {
    const place = shiftPlace(snapshot.branch.name, shift, snapshot.registers.length)
    const lastOfRegister = snapshot.registers.find(
      (candidate) => candidate.id === shift.register_id,
    )
    const canOpenNext =
      lastOfRegister?.open_shift_id === null && lastOfRegister.last_closed?.shift_id === shift.id
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(shiftShareText(report, { bold: true }))}`
    return shell(
      <>
        <PosTopbar account={account}>
          <button
            type="button"
            className="caja-back"
            onClick={() => void leaveSummary()}
            aria-label="Volver a la caja"
            data-testid="resumen-volver"
          >
            <ChevronLeft strokeWidth={2.4} aria-hidden />
          </button>
          <div className="caja-title">
            <b>{shift.label ?? 'Turno'}</b>
            <span>
              {manyRegisters ? `${shift.register} · ` : ''}
              {dayLabel(shift.service_day)}
            </span>
          </div>
          {practice ? <span className="caja-tag">Práctica</span> : null}
          {shiftsButton}
        </PosTopbar>
        {notices}
        <div className="caja-scroll" ref={scrollRef}>
          <section className="caja-desk" aria-label="El turno resumido">
            <div className="caja-display">
              <h1 className="caja-hero" data-testid="resumen-numero">
                <i>$</i>
                {digitsOf(report.hero.cents)}
              </h1>
              <p className="caja-say">{report.hero.sentence}</p>
              {report.difference ? (
                <p className="caja-say">
                  {report.difference.kind === 'exact' ? (
                    <>
                      El cajón <b>cuadró</b>.
                    </>
                  ) : (
                    <>
                      En el cajón <b>{report.difference.text.toLowerCase()}</b>.
                    </>
                  )}
                </p>
              ) : null}
            </div>
            {canOpenNext ? (
              <div className="caja-links">
                <button type="button" className="caja-link" onClick={() => void leaveSummary()}>
                  <ChevronRight aria-hidden />
                  Abrir el turno que sigue
                </button>
              </div>
            ) : null}
          </section>
          <section className="caja-roll" aria-label="El resumen y la cinta del turno">
            <ShiftReportSlip report={report} title={capitalize(place)} practice={practice} />
            <Tape
              key={shift.id}
              tape={tape}
              filter={filter}
              onFilter={chooseFilter}
              live={snapshot.live}
              invoiceByMethod={snapshot.settings.invoice_by_method}
              timeZone={timeZone}
              practice={practice}
              variant="loose"
              title="La cinta del turno"
              subtitle={
                snapshot.role === 'owner'
                  ? 'Tocá un cobro para corregirlo: queda anotado.'
                  : 'Con el turno cerrado, los cobros los corrige un dueño.'
              }
              onPayment={openPayment}
              onMovement={openMovement}
            />
          </section>
        </div>
        <footer className="caja-bar">
          <div className="caja-actions">
            <button
              type="button"
              className="caja-go is-quiet"
              onClick={() => void copySummary()}
              data-testid="resumen-copiar"
            >
              <Copy aria-hidden strokeWidth={2.3} />
              Copiar
            </button>
            <a
              className="caja-go"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="resumen-whatsapp"
            >
              <Send aria-hidden strokeWidth={2.3} />
              Mandar por WhatsApp
            </a>
          </div>
        </footer>
      </>,
    )
  }

  // ── La barra de arriba de siempre ──
  const topbar = (
    <PosTopbar account={account}>
      {branchPill}
      {manyRegisters ? (
        <div className="pos-top-tabs" role="tablist" aria-label="Cajas">
          {snapshot.registers.map((option) => {
            const selected = option.id === register?.id
            const isOpen = option.open_shift_id !== null
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn('pos-top-tab caja-reg', selected && 'is-active', isOpen && 'is-open')}
                onClick={() => pickRegisterTab(option.id)}
              >
                <i aria-hidden />
                {option.name}
                <small aria-hidden>{isOpen ? 'abierta' : 'cerrada'}</small>
                <span className="sr-only">{isOpen ? ', abierta' : ', cerrada'}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="caja-title">
          <b>Caja</b>
          <span>
            {phase.kind === 'open'
              ? shiftTitle(phase.shift, 1)
              : phase.kind === 'loading'
                ? ''
                : 'cerrada'}
          </span>
        </div>
      )}
      {practice ? <span className="caja-tag">Práctica</span> : null}
      {phase.kind === 'open' ? (
        <span className="pos-top-meta caja-top-meta">
          abrió {phase.shift.opened_by_name} {clockAt(phase.shift.opened_at, timeZone)} ·{' '}
          <b>{clock}</b>
        </span>
      ) : null}
      {shiftsButton}
    </PosTopbar>
  )

  // ── Sin turno abierto: abrir ──
  if (phase.kind === 'first' || phase.kind === 'closed') {
    const lastIsShown = phase.kind === 'closed' && shift?.id === phase.last.shift_id
    return shell(
      <>
        {topbar}
        {notices}
        <OpenShift
          key={`${register?.id ?? 'nueva'}:${practice}`}
          phase={phase}
          now={snapshot.now}
          timeZone={timeZone}
          practice={practice}
          manyRegisters={manyRegisters}
          busy={busy === 'open'}
          onOpen={(input) => void open(input)}
          onSeeLast={
            phase.kind === 'closed'
              ? () => {
                  if (lastIsShown) setMode('summary')
                  else void viewShift(phase.last.shift_id, phase.register.id)
                }
              : undefined
          }
          onPractice={() => void togglePractice()}
        >
          <section className="caja-roll" aria-label="La cinta del turno anterior">
            {lastIsShown && shift ? (
              <Tape
                key={shift.id}
                tape={tape}
                filter="all"
                onFilter={chooseFilter}
                live={snapshot.live}
                invoiceByMethod={snapshot.settings.invoice_by_method}
                timeZone={timeZone}
                practice={practice}
                variant="loose"
                title="La cinta del turno anterior"
                subtitle={`${shift.label ? `${shift.label} · ` : ''}${dayLabel(shift.service_day)}`}
                onPayment={openPayment}
                onMovement={openMovement}
              />
            ) : (
              <div className="caja-tape is-loose">
                <p className="caja-tape-empty">
                  La cinta empieza cuando se abre el turno: cada cobro se escribe solo, con la hora,
                  la mesa, el medio y quién cobró.
                </p>
              </div>
            )}
          </section>
        </OpenShift>
      </>,
    )
  }

  // ── Se está leyendo el turno de la otra caja ──
  if (phase.kind === 'loading' || !snapshot.live) {
    return shell(
      <>
        {topbar}
        {notices}
        <div className="caja-scroll" aria-busy="true">
          <section className="caja-desk" aria-hidden>
            <div className="caja-display">
              <div className="caja-ghost-num" />
              <div className="caja-ghost-say" />
            </div>
          </section>
          <section className="caja-roll" aria-hidden>
            <div className="caja-slot" />
            <div className="caja-tape caja-ghost" />
          </section>
          <p className="sr-only" role="status">
            Leyendo la caja…
          </p>
        </div>
      </>,
    )
  }

  // ── El turno abierto ──
  const liveNow = snapshot.live
  return shell(
    <>
      {topbar}
      {notices}
      <div className="caja-scroll" ref={scrollRef}>
        <LiveDesk
          live={liveNow}
          filter={filter}
          onFilter={chooseFilter}
          onDetail={() => setDetailOpen(true)}
        />
        <section className="caja-roll" aria-label="La cinta del turno">
          <div className="caja-slot" aria-hidden />
          <Tape
            key={phase.shift.id}
            tape={tape}
            filter={filter}
            onFilter={chooseFilter}
            live={liveNow}
            invoiceByMethod={snapshot.settings.invoice_by_method}
            timeZone={timeZone}
            practice={practice}
            variant="roll"
            onPayment={openPayment}
            onMovement={openMovement}
          />
        </section>
      </div>

      <footer className="caja-drawer">
        <button
          type="button"
          className="caja-drawer-sum"
          aria-pressed={filter === 'cash'}
          onClick={() => chooseFilter(filter === 'cash' ? 'all' : 'cash')}
          data-testid="cajon"
        >
          <span>En el cajón tiene que haber</span>
          <b data-testid="cajon-esperado">{formatCentsShort(liveNow.expected_cash_cents)}</b>
          <ChevronUp aria-hidden />
          <span className="sr-only">
            {filter === 'cash' ? 'Volver a ver todo' : 'Ver la cuenta del cajón en la cinta'}
          </span>
        </button>
        <p className="caja-drawer-math">{drawerSentence(liveNow)}</p>
        <div className="caja-actions">
          <button
            type="button"
            className="caja-util"
            onClick={() => setMoveKind('out')}
            data-testid="caja-sacar"
          >
            <BanknoteArrowUp aria-hidden strokeWidth={2.1} />
            Sacar plata
          </button>
          <button
            type="button"
            className="caja-util"
            onClick={() => setMoveKind('in')}
            data-testid="caja-entro"
          >
            <BanknoteArrowDown aria-hidden strokeWidth={2.1} />
            Entró plata
          </button>
          <button type="button" className="caja-go" onClick={startClose} data-testid="caja-cerrar">
            <LockKeyhole aria-hidden strokeWidth={2.4} />
            Cerrar el turno
          </button>
        </div>
      </footer>

      <MoveSheet
        kind={moveKind}
        shiftId={phase.shift.id}
        live={liveNow}
        api={api}
        onClose={() => setMoveKind(null)}
        onDone={changed}
      />
      <DetailSheet
        open={detailOpen}
        shift={phase.shift}
        report={report}
        practice={practice}
        onClose={() => setDetailOpen(false)}
      />
    </>,
  )
}

/** El visor: el número grande, la oración que lo explica y las teclas de los medios de pago. */
function LiveDesk({
  live,
  filter,
  onFilter,
  onDetail,
}: {
  live: ShiftSummary
  filter: TapeFilter
  onFilter: (filter: TapeFilter) => void
  onDetail: () => void
}) {
  const byMethod = new Map(live.by_method.map((row) => [row.method, row]))
  const hasPerPerson = live.per_person_cents !== null && live.people > 0
  const facts = [
    live.tip_cents > 0 ? (
      <span key="tips">
        Propinas <b>{formatCentsShort(live.tip_cents)}</b>
      </span>
    ) : null,
    hasPerPerson ? (
      <span key="pp">
        <b>{formatCentsShort(live.per_person_cents)}</b> por persona
      </span>
    ) : null,
  ].filter(Boolean)

  return (
    <section className="caja-desk" aria-label="Los números del turno">
      <div className="caja-display">
        <h1 className="caja-hero" data-testid="caja-total">
          <span className="sr-only">Entró en este turno: </span>
          <i>$</i>
          {digitsOf(live.collected_cents)}
        </h1>
        <p className="caja-say">{liveSentence(live)}</p>
      </div>

      <fieldset className="caja-keys">
        <legend className="sr-only">
          Lo que entró por cada medio. Tocá uno para ver solo esos cobros en la cinta.
        </legend>
        {PAY_METHODS.map((method) => {
          const row = byMethod.get(method)
          const Icon = METHOD_ICON[method]
          return (
            <button
              key={method}
              type="button"
              className="caja-key"
              aria-pressed={filter === method}
              // El efectivo siempre se puede mirar: aunque no haya cobros, están el cambio y los retiros.
              disabled={!row && method !== 'cash'}
              onClick={() => onFilter(filter === method ? 'all' : method)}
              data-testid={`tecla-${method}`}
            >
              <span className="caja-key-name">
                <Icon aria-hidden strokeWidth={2.2} />
                {METHOD_LABEL[method]}
              </span>
              <b>{row ? formatCentsShort(row.total_cents) : '—'}</b>
              {row ? null : <span className="sr-only">sin cobros</span>}
            </button>
          )
        })}
      </fieldset>

      <button type="button" className="caja-facts" onClick={onDetail} data-testid="caja-detalle">
        <span>
          {facts.length > 0
            ? facts.flatMap((fact, index) => (index === 0 ? [fact] : [' · ', fact]))
            : 'El turno en detalle'}
        </span>
        <ChevronRight aria-hidden />
        <span className="sr-only">Ver el turno en detalle</span>
      </button>

      <div className="caja-facts-list">
        <dl className="caja-sum">
          {live.tip_cents > 0 ? (
            <div>
              <dt>Propinas, que van aparte</dt>
              <dd>{formatCentsShort(live.tip_cents)}</dd>
            </div>
          ) : null}
          {live.surcharge_cents > 0 ? (
            <div>
              <dt>Recargo de crédito</dt>
              <dd>{formatCentsShort(live.surcharge_cents)}</dd>
            </div>
          ) : null}
          {hasPerPerson ? (
            <div>
              <dt>
                Por persona ({live.people} en {live.tables} {live.tables === 1 ? 'mesa' : 'mesas'})
              </dt>
              <dd>{formatCentsShort(live.per_person_cents)}</dd>
            </div>
          ) : null}
          {live.discount_cents > 0 ? (
            <div>
              <dt>Descuentos</dt>
              <dd>{formatCentsShort(live.discount_cents)}</dd>
            </div>
          ) : null}
        </dl>
        <button type="button" className="caja-link" onClick={onDetail}>
          <ReceiptText aria-hidden />
          Ver el turno en detalle
        </button>
      </div>
    </section>
  )
}

/** Así viene el turno: el mismo papel que queda al cerrar, con los números de ahora. */
function DetailSheet({
  open,
  shift,
  report,
  practice,
  onClose,
}: {
  open: boolean
  shift: Shift
  report: ReturnType<typeof buildShiftReport> | null
  practice: boolean
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="detalle-hoja"
      >
        <SheetGrabber />
        <div className="pos-sheet-body caja-sheet-body has-foot">
          <div className="caja-sheet-head">
            <SheetTitle className="pos-sheet-title caja-sheet-title">Así viene el turno</SheetTitle>
            <SheetDescription className="caja-sheet-sub is-ink">
              {shift.label ? `${shift.label} · ` : ''}
              {report?.meta ?? ''}
            </SheetDescription>
          </div>
          {report ? (
            <ShiftReportSlip report={report} title="Así viene el turno" practice={practice} bare />
          ) : null}
        </div>
        <div className="caja-sheet-foot">
          <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
