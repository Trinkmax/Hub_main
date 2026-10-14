'use client'

import { ChevronDown, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import {
  markTreasuryChecked,
  postTreasuryAdjustment,
  postWalletCheck,
} from '@/lib/accounting/actions/documents'
import type {
  TreasuryAdjustmentValues,
  WalletCheckValues,
} from '@/lib/accounting/server/document-types'
import { formatDayMonth } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
} from '../action-sheet'
import { Amount } from '../amount'
import { loadCajasVentasCatalog, loadTreasuryCheck } from '../cajas-ventas/data'
import { FormBanner, SheetLoadError, WarningsDialog } from '../cajas-ventas/feedback'
import { hrefWith } from '../cajas-ventas/periods'
import {
  firstLoadableDay,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
  withOpenItems,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog } from '../cajas-ventas/types'
import { type SavedState, usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { ChoiceCard, StatusPill, Term } from '../kit'
import { MoneyField, MoneyInput } from '../money-input'
import { TreasuryPicker } from '../treasury-picker'
import { BillCounter, Verdict } from './ajustar-piezas'
import {
  COUNT_PICK_LABEL,
  type CountMode,
  type CountPlan,
  type CountReason,
  countModeOf,
  countQuestion,
  countSavedNote,
  countSubmitLabel,
  countVerdict,
  exactMoney,
  idleVerdict,
  leftToCount,
  reasonOptions as reasonOptionsFor,
  VERDICT_PICK,
  walletToExplain,
  walletUndetailedNote,
} from './ajustar-vista'
import { SavedNote } from './gasto-piezas'
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  SHEET_QUESTION_BLOCK,
  SheetQuestion,
  TEXT_LINK,
} from './sheet-parts'
import type { ActionSheetProps } from './types'

/**
 * El encabezado de la hoja pregunta lo que la persona vino a contestar. La
 * acción se llama «Contar la caja» (`ACTION_TITLES.ajustar`): así la nombran
 * ⌘K, los botones de Cajas, el Resumen y «Cómo arrancar».
 */
const TITLE = '¿Coincide la caja?'
const DESCRIPTION = 'Contá lo que hay de verdad y lo comparamos con el sistema.'

/**
 * Hoja «¿Coincide la caja?» (H.11, E.5.8, E.5.13): contar una caja, un banco,
 * una billetera o la tarjeta de la empresa. Es una cuenta de tres renglones:
 * lo que dice el sistema, lo que contaste, y el resultado en grande
 * («Coincide», «Faltan $ 1.257»).
 *
 * Las cuentas, el plan (qué se guarda) y los tres envíos son los de siempre;
 * cambió el orden (primero el número, después el resto) y las palabras.
 */
export function AjustarSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  if (!load.data) {
    if (load.status === 'error') {
      return <SheetFailed title={TITLE} message={load.message} onRetry={() => load.reload()} />
    }
    return <SheetLoading title={TITLE} description={DESCRIPTION} />
  }
  return (
    <AjustarForm
      {...props}
      catalog={load.data}
      reloadCatalog={() => load.reload({ silent: true })}
    />
  )
}

type Mode = CountMode
type Reason = CountReason
type Plan = CountPlan
type BreakdownKey = 'comision' | 'iva_comision' | 'sircupa' | 'otro'
type Breakdown = Readonly<Record<BreakdownKey, number | null>>

const EMPTY_BREAKDOWN: Breakdown = { comision: null, iva_comision: null, sircupa: null, otro: null }

const BREAKDOWN_ROWS: ReadonlyArray<{ key: BreakdownKey; label: string; short: string }> = [
  { key: 'comision', label: 'Comisión', short: 'Comisión' },
  { key: 'iva_comision', label: 'IVA de la comisión', short: 'IVA' },
  { key: 'sircupa', label: 'Ingresos Brutos', short: 'Ingresos Brutos' },
  { key: 'otro', label: 'Otros cargos', short: 'Otros cargos' },
]

const KNOWN_FIELDS = new Set([
  'treasuryAccountId',
  'date',
  'countedCents',
  'expectedBookCents',
  'splits',
  'items',
  'breakdown',
])

function sum(values: ReadonlyArray<number | null>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
}

function AjustarForm({
  tenantSlug,
  params,
  close,
  setDirty,
  catalog,
  reloadCatalog,
}: ActionSheetProps & { catalog: CajasVentasCatalog; reloadCatalog: () => void }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const countedRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const { treasuries, today } = catalog
  const interestAccountId = catalog.ctx.sys.interest_income.id
  const otherFeesAccountId = catalog.ctx.sys.fees_other.id

  const initialTreasury =
    params.caja && treasuries.some((t) => t.id === params.caja)
      ? params.caja
      : treasuries.length === 1
        ? (treasuries[0]?.id ?? null)
        : null
  const [treasuryId, setTreasuryId] = useState<string | null>(initialTreasury)
  const [date, setDate] = useState<string | null>(today)
  /** Lo que se contó; en la tarjeta de la empresa, la deuda (positiva). */
  const [counted, setCounted] = useState<number | null>(null)
  const [reason, setReason] = useState<Reason | null>(null)
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const [breakdown, setBreakdown] = useState<Breakdown>(EMPTY_BREAKDOWN)
  const [breakdownTouched, setBreakdownTouched] = useState(false)
  const [sircupaCert, setSircupaCert] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [checking, startChecking] = useTransition()
  // Solo de la vista: lo plegado y «Contar otra después».
  const [billsOpen, setBillsOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [another, setAnother] = useState(false)
  /** La caja con la que arrancó la hoja (o con la que quedó después de «Contar otra»). */
  const [baseTreasury, setBaseTreasury] = useState<string | null>(initialTreasury)
  /** Las que ya se contaron con esta hoja abierta. */
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())
  const [lastSaved, setLastSaved] = useState<{ text: string; count: number } | null>(null)
  /** Al elegir una caja, el foco pasa al campo del importe cuando llega su saldo. */
  const focusCounted = useRef(false)

  const treasury = treasuries.find((t) => t.id === treasuryId)
  const mode: Mode | null = treasury ? countModeOf(treasury) : null

  const checkLoad = useSheetLoad(
    treasuryId && date ? () => loadTreasuryCheck(tenantSlug, treasuryId, date) : null,
    `${treasuryId ?? ''}:${date ?? ''}`,
  )
  // Solo lo de ESTA caja y fecha: mientras carga otra, no se muestra el saldo viejo.
  const check = checkLoad.status === 'ready' ? checkLoad.data : null

  // Billetera: el desglose arranca con lo estimado por las tasas (hasta que se toque).
  useEffect(() => {
    if (mode !== 'wallet' || !check || breakdownTouched) return
    const e = check.estimates
    setBreakdown({
      comision: e && e.commissionCents > 0 ? e.commissionCents : null,
      iva_comision: e && e.commissionVatCents > 0 ? e.commissionVatCents : null,
      sircupa: e && e.sircupaCents > 0 ? e.sircupaCents : null,
      otro: null,
    })
  }, [check, mode, breakdownTouched])

  useEffect(() => {
    if (!check || !focusCounted.current) return
    focusCounted.current = false
    countedRef.current?.focus()
  }, [check])

  const dirty =
    counted !== null ||
    treasuryId !== baseTreasury ||
    reason !== null ||
    breakdownTouched ||
    unticked.size > 0
  useEffect(() => setDirty(dirty), [dirty, setDirty])

  // ── La cuenta ──
  const book = check?.bookCents ?? null
  const countedBook = counted === null ? null : mode === 'card' ? -counted : counted
  const diff = countedBook !== null && book !== null ? countedBook - book : null
  const items = mode === 'wallet' && check ? check.walletItems : []
  const ticked = items.filter((i) => !unticked.has(i.lineId))
  const pendingAll = sum(items.map((i) => i.openCents))
  const pendingTicked = sum(ticked.map((i) => i.openCents))
  const explained = sum(BREAKDOWN_ROWS.map((r) => breakdown[r.key]))
  /** Billetera con partidas: descuentos = lo que había en camino − lo que entró. */
  const discounts = diff !== null && ticked.length > 0 ? pendingTicked - diff : null
  // Solo para decirlo en pantalla: cuánto falta explicar (con o sin ventas tildadas).
  const toExplain =
    mode === 'wallet' ? walletToExplain({ diff, ticked: ticked.length, pendingTicked }) : null
  const unexplained = toExplain !== null ? toExplain - explained : null
  const showBreakdown =
    mode === 'wallet' && check !== null && (ticked.length > 0 || (diff !== null && diff < 0))

  const reasonOptions = useMemo(() => reasonOptionsFor(mode, diff), [diff, mode])
  const activeReason =
    reason && reasonOptions.some((o) => o.value === reason)
      ? reason
      : reasonOptions.length === 0
        ? 'other'
        : null

  const plan: Plan | null =
    !treasury || diff === null
      ? null
      : diff === 0 && (mode !== 'wallet' || ticked.length === 0)
        ? 'check'
        : mode === 'wallet'
          ? 'wallet'
          : activeReason === 'bank_fees'
            ? 'bank_fees'
            : 'adjust'

  // ── Lo que se guarda ──
  const adjustValues = useMemo(
    () => ({
      treasuryAccountId: treasuryId ?? '',
      date: date ?? '',
      countedCents: countedBook,
      expectedBookCents: book,
      splits:
        activeReason === 'interest' && diff !== null && diff > 0
          ? [
              {
                accountId: interestAccountId,
                amountCents: diff,
                taxKind: 'rendimiento',
                partyId: null,
              },
            ]
          : [],
      notes: null,
    }),
    [treasuryId, date, countedBook, book, activeReason, diff, interestAccountId],
  )
  const walletValues = useMemo(() => {
    // Sin partidas y con plata de más, todo es rendimiento: no lleva desglose.
    const withBreakdown = ticked.length > 0 || (diff !== null && diff < 0)
    return {
      treasuryAccountId: treasuryId ?? '',
      partyId: null,
      date: date ?? '',
      countedCents: countedBook,
      expectedBookCents: book,
      items: ticked.map((i) => ({ lineId: i.lineId, amountCents: i.openCents })),
      breakdown: withBreakdown
        ? BREAKDOWN_ROWS.flatMap((r) => {
            const amount = breakdown[r.key]
            if (amount === null || amount <= 0) return []
            return [
              {
                taxKind: r.key,
                amountCents: amount,
                accountId: r.key === 'otro' ? otherFeesAccountId : null,
                certificateNumber:
                  r.key === 'sircupa' && sircupaCert.trim() !== '' ? sircupaCert.trim() : null,
                salesMethodId: null,
              },
            ]
          })
        : [],
    }
  }, [
    treasuryId,
    date,
    countedBook,
    book,
    ticked,
    diff,
    breakdown,
    sircupaCert,
    otherFeesAccountId,
  ])
  const walletCtx = useMemo(() => withOpenItems(catalog.ctx, items), [catalog.ctx, items])
  const adjustPreview = useDocumentPreview(
    'treasury_adjustment',
    adjustValues,
    catalog.ctx,
    catalog.firstOpenDate,
  )
  const walletPreview = useDocumentPreview(
    'wallet_check',
    walletValues,
    walletCtx,
    catalog.firstOpenDate,
  )

  /**
   * Después de guardar. Sin «Contar otra después» (o si ya no queda ninguna),
   * la hoja se cierra como siempre. Con el tilde, se vacía y sigue abierta en
   * la primera caja que falta: arriba queda dicho cómo salió la que se contó.
   */
  function afterSaved(outcome: 'matched' | 'adjusted' | 'arrived', cents: number | null) {
    router.refresh()
    const doneNow = new Set(done)
    if (treasuryId) doneNow.add(treasuryId)
    const left = leftToCount(treasuries, today, doneNow)
    const next = left[0]
    if (!another || !next) {
      close()
      return
    }
    setDone(doneNow)
    setLastSaved((prev) => ({
      text: countSavedNote({
        name: treasury?.name ?? 'La caja',
        outcome,
        cents,
        left: left.map((t) => t.name),
      }),
      count: (prev?.count ?? 0) + 1,
    }))
    setTreasuryId(next.id)
    setBaseTreasury(next.id)
    setCounted(null)
    setReason(null)
    setUnticked(new Set())
    setBreakdown(EMPTY_BREAKDOWN)
    setBreakdownTouched(false)
    setSircupaCert('')
    setAttempted(false)
    setBillsOpen(false)
    setBreakdownOpen(false)
    // La hoja sigue abierta para otra caja: un aviso de un intento anterior ya no corresponde.
    adjust.setBanner(null)
    wallet.setBanner(null)
    // Los saldos y los conteos cambiaron: el catálogo se vuelve a traer sin tapar la hoja.
    reloadCatalog()
    requestAnimationFrame(() => {
      formRef.current?.querySelector('[data-slot="action-sheet-body"]')?.scrollTo({ top: 0 })
    })
  }

  const undoToast = useUndoToast(tenantSlug)
  const onSaved = (saved: SavedState) => {
    undoToast(saved.message, saved)
    if (plan === 'wallet' && ticked.length > 0) afterSaved('arrived', diff)
    else afterSaved('adjusted', counted)
  }
  // Si alguien cargó algo en el medio, el saldo de libro cambió: se vuelve a leer.
  const onFailure = (state: { code: string }) => {
    if (state.code === 'stale') checkLoad.reload({ silent: true })
  }
  const adjust = usePosting<TreasuryAdjustmentValues>({
    tenantSlug,
    action: postTreasuryAdjustment,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved,
    onFailure,
  })
  const wallet = usePosting<WalletCheckValues>({
    tenantSlug,
    action: postWalletCheck,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved,
    onFailure,
  })
  const posting = plan === 'wallet' ? wallet : adjust
  const preview = plan === 'wallet' ? walletPreview : adjustPreview

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  const treasuryError =
    errorOf('treasuryAccountId') ?? (attempted && !treasuryId ? 'Elegí la caja o cuenta.' : null)
  const reasonError =
    attempted && reasonOptions.length > 0 && activeReason === null
      ? 'Elegí por qué hay diferencia.'
      : null
  const name = treasury?.name ?? 'la caja'
  const breakdownError =
    discounts !== null && discounts >= 0 && explained > discounts
      ? `Repartiste más de lo que se quedó ${name} (${formatCents(discounts)}).`
      : null
  /** Billetera: con partidas tildadas, la plata no puede haber bajado (no hay nada que haya entrado). */
  const walletShrank = mode === 'wallet' && ticked.length > 0 && diff !== null && diff < 0
  const countedError =
    errorOf('countedCents') ??
    (attempted && counted === null ? 'Escribí cuánto hay.' : null) ??
    (attempted && walletShrank
      ? 'Hay menos plata que antes: revisá el número o destildá lo que todavía no te entró.'
      : null)
  const pendingSince = items.reduce<string | null>(
    (min, i) => (min === null || i.entryDate < min ? i.entryDate : min),
    null,
  )

  const shown =
    plan === 'adjust' || plan === 'wallet'
      ? (posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : []))
      : []

  function selectTreasury(next: string) {
    setTreasuryId(next)
    setReason(null)
    setUnticked(new Set())
    setBreakdown(EMPTY_BREAKDOWN)
    setBreakdownTouched(false)
    setSircupaCert('')
    setBillsOpen(false)
    setBreakdownOpen(false)
    adjust.setBanner(null)
    wallet.setBanner(null)
    focusCounted.current = true
  }

  function setRow(key: BreakdownKey, cents: number | null) {
    setBreakdownTouched(true)
    setBreakdown((prev) => ({ ...prev, [key]: cents }))
    wallet.clearFieldError('breakdown')
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
  }

  function confirmMatches() {
    if (!treasuryId || !date || countedBook === null || book === null) return
    startChecking(async () => {
      try {
        const result = await markTreasuryChecked(tenantSlug, {
          treasuryAccountId: treasuryId,
          countedCents: countedBook,
          expectedBookCents: book,
          asOf: date,
        })
        if (!result.ok) {
          if (result.code === 'stale') checkLoad.reload({ silent: true })
          adjust.setBanner({ tone: 'error', message: result.message })
          return
        }
        toast.success(result.message)
        afterSaved('matched', null)
      } catch {
        adjust.setBanner({
          tone: 'error',
          message: ACC_UNREACHABLE.offline,
          action: { label: ACC_UNREACHABLE.retryLabel, run: confirmMatches },
        })
      }
    })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!treasuryId || !date || plan === null) {
      adjust.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      focusFirstError()
      return
    }
    if (plan === 'check') {
      confirmMatches()
      return
    }
    if (plan === 'bank_fees' && diff !== null) {
      // Los gastos del banco se cargan en su pantalla, con la diferencia como total debitado.
      router.push(
        hrefWith(`/${tenantSlug}/administracion/cajas/gasto-bancario`, {
          caja: treasuryId,
          fecha: date,
          total: Math.abs(diff),
        }),
      )
      return
    }
    if (reasonError || breakdownError || walletShrank || !preview.state.ok) {
      // El error de este bloque queda a la vista aunque estuviera plegado.
      if (breakdownError) setBreakdownOpen(true)
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      focusFirstError()
      return
    }
    posting.submit(plan === 'wallet' ? walletValues : adjustValues, preview.state, preview.key)
  }

  const busy = posting.pending || checking
  const submitLabel = countSubmitLabel(plan, ticked.length)
  const question = countQuestion(mode, name)
  const verdict = countVerdict({
    mode: mode ?? 'plain',
    name,
    diff,
    countedCents: counted,
    ticked: ticked.length,
    pendingTicked,
    countedOn: date && date !== today ? date : null,
  })
  const lastCounted = [treasury?.lastCheckedOn ?? null, check?.lastAdjustmentDate ?? null]
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1)
  const breakdownOpenNow =
    breakdownOpen || breakdownTouched || Boolean(breakdownError) || Boolean(errorOf('breakdown'))
  const breakdownSummary = BREAKDOWN_ROWS.flatMap((row) => {
    const amount = breakdown[row.key]
    return amount !== null && amount > 0 ? [`${row.short} ${exactMoney(amount)}`] : []
  }).join(' · ')

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          {lastSaved ? (
            // Con `key`, el tilde se vuelve a dibujar con cada caja que se cuenta.
            <SavedNote key={lastSaved.count}>{lastSaved.text}</SavedNote>
          ) : null}

          <div className={SHEET_QUESTION_BLOCK}>
            <SheetQuestion id={`${id}-caja-label`} required>
              ¿Qué caja contaste?
            </SheetQuestion>
            <TreasuryPicker
              id={`${id}-caja`}
              aria-labelledby={`${id}-caja-label`}
              value={treasuryId}
              onValueChange={(next) => selectTreasury(next)}
              treasuries={treasuries}
              invalid={Boolean(treasuryError)}
              aria-describedby={treasuryError ? `${id}-caja-error` : undefined}
            />
            {treasuryError ? (
              <p id={`${id}-caja-error`} role="alert" className="text-xs text-destructive">
                {treasuryError}
              </p>
            ) : null}
          </div>

          {!treasury ? (
            // Sin caja todavía: el recuadro del resultado ya está, en reposo, y dice qué sigue.
            <Verdict verdict={idleVerdict(VERDICT_PICK)} />
          ) : checkLoad.status === 'error' && !check ? (
            <SheetLoadError message={checkLoad.message} onRetry={() => checkLoad.reload()} />
          ) : !check ? (
            // El hueso de lo que viene: «el sistema dice», el campo grande y el resultado.
            <div className="space-y-6" aria-busy="true">
              <span className="sr-only">Cargando lo que dice el sistema…</span>
              <Skeleton className="h-20 w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-16 w-full rounded-2xl" />
              </div>
              <Skeleton className="h-[7.25rem] w-full rounded-2xl" />
            </div>
          ) : (
            <>
              {/* Renglón 1: lo que dice el sistema. */}
              <div className="rounded-xl bg-secondary/50 px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium">
                    El sistema dice{date && date !== today ? ` (al ${formatDayMonth(date)})` : ''}
                  </p>
                  <p className="ml-auto font-serif text-2xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums">
                    {mode === 'card' ? (
                      check.bookCents === 0 ? (
                        <span className="font-sans text-base font-normal text-muted-foreground">
                          Sin deuda
                        </span>
                      ) : (
                        <>
                          <span className="font-sans text-sm font-normal text-muted-foreground">
                            {check.bookCents < 0 ? 'Debés ' : 'A favor '}
                          </span>
                          {exactMoney(check.bookCents)}
                        </>
                      )
                    ) : (
                      <>
                        {check.bookCents < 0 ? (
                          <span className="font-sans text-sm font-normal text-muted-foreground">
                            Descubierto{' '}
                          </span>
                        ) : null}
                        {exactMoney(check.bookCents)}
                      </>
                    )}
                  </p>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground text-pretty">
                  Según lo cargado.{' '}
                  {lastCounted
                    ? `La contaste por última vez el ${formatDayMonth(lastCounted)}.`
                    : 'Todavía no la contaste.'}
                </p>
                {mode === 'wallet' && pendingAll > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    + {exactMoney(pendingAll)} en camino
                    {pendingSince ? ` (desde el ${formatDayMonth(pendingSince)})` : ''}
                  </p>
                ) : null}
              </div>

              {/* La primera vez, con el sistema en cero: si faltan los saldos iniciales, contarla
                  anotaría toda la plata como sobrante. Se avisa antes de que escriba (no bloquea). */}
              {!lastCounted && check.bookCents === 0 && mode !== 'card' && pendingAll === 0 ? (
                <p className="-mt-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-pretty">
                  <span className="font-medium">¿Es la primera vez?</span>{' '}
                  <span className="text-muted-foreground">
                    Si todavía no cargaste lo que había al arrancar, hacelo primero: contada ahora,
                    toda la plata quedaría como sobrante.
                  </span>{' '}
                  <Link
                    href={`/${tenantSlug}/administracion/configurar`}
                    className="inline-flex min-h-11 items-center rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                  >
                    Cargar lo que había
                  </Link>
                </p>
              ) : null}

              {/* Renglón 2: lo que contaste. */}
              <div className="grid gap-2">
                <MoneyField
                  inputRef={countedRef}
                  label={question.label}
                  fieldClassName={ACTION_SHEET_QUESTION_FIELD}
                  className={BIG_MONEY_FIELD}
                  required
                  allowNegative={mode !== 'cash'}
                  value={counted}
                  onValueChange={(cents) => {
                    setCounted(cents)
                    adjust.clearFieldError('countedCents')
                    wallet.clearFieldError('countedCents')
                  }}
                  hint={question.hint}
                  error={countedError}
                />
                {mode === 'cash' ? (
                  <>
                    {/* El mismo link abre y cierra el contador: abierto, no desaparece. */}
                    <button
                      type="button"
                      className={cn(TEXT_LINK, 'justify-self-start text-sm underline')}
                      aria-expanded={billsOpen}
                      onClick={() => setBillsOpen((open) => !open)}
                    >
                      {billsOpen ? 'Cerrar el contador' : 'Ayudame a contar los billetes'}
                    </button>
                    {billsOpen ? (
                      <BillCounter
                        onUse={(cents) => {
                          setCounted(cents)
                          setBillsOpen(false)
                          adjust.clearFieldError('countedCents')
                          countedRef.current?.focus()
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>

              {items.length > 0 ? (
                <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                  <legend className="mb-1.5 p-0 font-serif text-lg leading-snug font-semibold tracking-tight">
                    ¿Qué ventas ya entraron?
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    Destildá lo que todavía no te entró.
                  </p>
                  <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                    {items.map((item) => {
                      const checked = !unticked.has(item.lineId)
                      const inputId = `${id}-item-${item.lineId}`
                      return (
                        <li key={item.lineId}>
                          <label
                            htmlFor={inputId}
                            className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                          >
                            <Checkbox
                              id={inputId}
                              checked={checked}
                              onCheckedChange={(value) => {
                                setUnticked((prev) => {
                                  const next = new Set(prev)
                                  if (value === true) next.delete(item.lineId)
                                  else next.add(item.lineId)
                                  return next
                                })
                                wallet.clearFieldError('items')
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {item.methodName || item.label} · {formatDayMonth(item.entryDate)}
                            </span>
                            <Amount cents={item.openCents} />
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </fieldset>
              ) : null}

              {/* Renglón 3: el resultado. */}
              <div className="grid gap-2">
                <Verdict
                  verdict={verdict}
                  onUntickAll={() => {
                    setUnticked(new Set(items.map((i) => i.lineId)))
                    wallet.clearFieldError('items')
                  }}
                />
                {verdict.note ? (
                  <p className="text-xs text-muted-foreground text-pretty">{verdict.note}</p>
                ) : null}
              </div>

              {reasonOptions.length > 0 ? (
                <div className={SHEET_QUESTION_BLOCK}>
                  <SheetQuestion id={`${id}-reason`}>¿Por qué hay diferencia?</SheetQuestion>
                  <div
                    role="radiogroup"
                    aria-labelledby={`${id}-reason`}
                    aria-invalid={reasonError ? true : undefined}
                    // Con error, «ir al primer campo marcado» tiene que poder caer acá.
                    tabIndex={-1}
                    className="grid gap-2.5 outline-none"
                  >
                    {reasonOptions.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        name={`${id}-reason`}
                        value={option.value}
                        checked={activeReason === option.value}
                        onChange={() => {
                          setReason(option.value)
                          adjust.setBanner(null)
                        }}
                        title={option.title}
                        consequence={option.consequence}
                      />
                    ))}
                  </div>
                  {reasonError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {reasonError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showBreakdown ? (
                // Sin `m-0`: le ganaba al `space-y-6` de la hoja y lo de abajo quedaba pegado.
                <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 border-0 p-0">
                  {/* Una pregunta más de la hoja, con la voz de las otras. */}
                  <legend className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 p-0">
                    <SheetQuestion id={`${id}-descuentos`}>¿Qué te descontó {name}?</SheetQuestion>
                    {!breakdownTouched && explained > 0 ? (
                      <StatusPill tone="muted">Estimado</StatusPill>
                    ) : null}
                  </legend>
                  {breakdownOpenNow ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Copiá los importes del reporte de {name}.
                      </p>
                      <div className="grid gap-2">
                        {BREAKDOWN_ROWS.map((row) => {
                          const inputId = `${id}-bd-${row.key}`
                          return (
                            <div
                              key={row.key}
                              className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-3"
                            >
                              <Label htmlFor={inputId} className="font-normal">
                                {row.key === 'sircupa' ? (
                                  <Term name="SIRCUPA">{row.label}</Term>
                                ) : (
                                  row.label
                                )}
                              </Label>
                              <MoneyInput
                                id={inputId}
                                value={breakdown[row.key]}
                                onValueChange={(cents) => setRow(row.key, cents)}
                                align="end"
                                invalid={Boolean(breakdownError)}
                              />
                            </div>
                          )
                        })}
                        {(breakdown.sircupa ?? 0) > 0 ? (
                          <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-3">
                            <Label htmlFor={`${id}-cert`} className="font-normal">
                              N.º de certificado{' '}
                              <span className="text-xs text-muted-foreground">(opcional)</span>
                            </Label>
                            <Input
                              id={`${id}-cert`}
                              value={sircupaCert}
                              maxLength={40}
                              autoComplete="off"
                              className="h-11 text-base md:h-10 md:text-sm"
                              onChange={(e) => setSircupaCert(e.target.value)}
                            />
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : breakdownSummary ? (
                    // Ya hay un detalle (el estimado por las tasas): se muestra y se puede corregir.
                    <div className="grid gap-1">
                      <p className="text-sm tabular-nums text-pretty">{breakdownSummary}</p>
                      <button
                        type="button"
                        className={cn(TEXT_LINK, 'justify-self-start text-sm underline')}
                        aria-expanded={false}
                        onClick={() => setBreakdownOpen(true)}
                      >
                        Tengo el reporte: corregir los importes
                        <ChevronDown className="ml-1 size-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    // Sin detalle: qué pasa si se guarda así, y dónde decirlo.
                    <div className="grid gap-1">
                      {unexplained !== null && unexplained > 0 ? (
                        <p className="text-sm text-muted-foreground text-pretty">
                          {walletUndetailedNote(unexplained)}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className={ADD_LINK}
                        aria-expanded={false}
                        onClick={() => {
                          setBreakdownOpen(true)
                          // El botón desaparece: el foco sigue en el primer importe.
                          requestAnimationFrame(() =>
                            document.getElementById(`${id}-bd-comision`)?.focus(),
                          )
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        Decir qué te descontaron
                      </button>
                    </div>
                  )}
                  {breakdownError || errorOf('breakdown') ? (
                    <p role="alert" className="text-xs text-destructive">
                      {breakdownError ?? errorOf('breakdown')}
                    </p>
                  ) : (breakdownOpenNow || breakdownSummary) &&
                    unexplained !== null &&
                    unexplained > 0 ? (
                    <p className="text-sm text-muted-foreground text-pretty">
                      Quedan{' '}
                      <span className="font-medium text-foreground">{exactMoney(unexplained)}</span>{' '}
                      sin explicar: van aparte para que los revise la contadora.
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
            </>
          )}

          {/* Lo demás: casi nunca hace falta tocarlo. Una raya lo separa de la cuenta. Sin caja
              elegida no hay nada que fechar: aparece con la cuenta (viene puesta en hoy). */}
          {treasury ? (
            <div className="space-y-5 border-t border-border/60 pt-6">
              <DateField
                label="Fecha del conteo"
                required
                value={date}
                onValueChange={(next) => {
                  setDate(next)
                  adjust.clearFieldError('date')
                  wallet.clearFieldError('date')
                }}
                min={firstLoadableDay(catalog)}
                max={today}
                today={today}
                error={errorOf('date')}
              />
            </div>
          ) : null}

          {plan === 'adjust' || plan === 'wallet' ? (
            <EntryPreview entries={shown} label="Ver cómo queda en los libros" />
          ) : null}

          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter
          className={
            treasuries.length > 1
              ? 'flex-col items-stretch gap-1 pt-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3'
              : undefined
          }
        >
          {treasuries.length > 1 ? (
            <label
              htmlFor={`${id}-otra`}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground"
            >
              <Checkbox
                id={`${id}-otra`}
                checked={another}
                onCheckedChange={(checked) => setAnother(checked === true)}
              />
              Contar otra después
            </label>
          ) : null}
          {/* Sin caja no hay nada que guardar: el botón dice qué falta y espera apagado. */}
          <Button type="submit" disabled={busy || !treasury || !check}>
            {busy ? 'Guardando…' : treasury ? submitLabel : COUNT_PICK_LABEL}
          </Button>
        </ActionSheetFooter>
      </form>
      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </>
  )
}
