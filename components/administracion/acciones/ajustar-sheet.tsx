'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { Amount } from '../amount'
import { type ChoiceChip, ChoiceChips } from '../cajas-ventas/choice-chips'
import { loadCajasVentasCatalog, loadTreasuryCheck } from '../cajas-ventas/data'
import { FormBanner, SheetLoadError, WarningsDialog } from '../cajas-ventas/feedback'
import { describedBy, Field, GroupLabel } from '../cajas-ventas/field'
import { moneyLabel } from '../cajas-ventas/money'
import { hrefWith } from '../cajas-ventas/periods'
import {
  firstLoadableDay,
  SheetCancel,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
  withOpenItems,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, SheetTreasury } from '../cajas-ventas/types'
import { type SavedState, usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { MoneyField, MoneyInput } from '../money-input'
import { TreasurySelect } from '../treasury-select'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.ajustar
const DESCRIPTION = 'Contá lo que hay de verdad y lo comparamos con el sistema.'

/** Hoja «Ajustar saldo» (H.11, E.5.8, E.5.13): arqueo de caja, banco, billetera o tarjeta. */
export function AjustarSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  if (!load.data) {
    if (load.status === 'error') {
      return <SheetFailed title={TITLE} message={load.message} onRetry={() => load.reload()} />
    }
    return <SheetLoading title={TITLE} description={DESCRIPTION} />
  }
  return <AjustarForm {...props} catalog={load.data} />
}

/**
 * - `cash`: la diferencia va sola a faltante o sobrante de caja.
 * - `bank`: gastos del banco (abre «Gasto bancario»), intereses u otra diferencia.
 * - `wallet`: billetera con su partícipe (Mercado Pago): acredita lo que falta
 *   acreditar y explica los descuentos (E.5.8).
 * - `card`: la tarjeta de la empresa; se cuenta la DEUDA.
 * - `plain`: otra cuenta (o una billetera sin partícipe): intereses u otra diferencia.
 */
type Mode = 'cash' | 'bank' | 'wallet' | 'card' | 'plain'
type Reason = 'bank_fees' | 'interest' | 'other'
type Plan = 'check' | 'adjust' | 'wallet' | 'bank_fees'
type BreakdownKey = 'comision' | 'iva_comision' | 'sircupa' | 'otro'
type Breakdown = Readonly<Record<BreakdownKey, number | null>>

const EMPTY_BREAKDOWN: Breakdown = { comision: null, iva_comision: null, sircupa: null, otro: null }

const BREAKDOWN_ROWS: ReadonlyArray<{ key: BreakdownKey; label: string }> = [
  { key: 'comision', label: 'Comisión' },
  { key: 'iva_comision', label: 'IVA de la comisión' },
  { key: 'sircupa', label: 'SIRCUPA (Ingresos Brutos)' },
  { key: 'otro', label: 'Otros cargos' },
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

function modeOf(t: SheetTreasury): Mode {
  switch (t.kind) {
    case 'cash':
      return 'cash'
    case 'bank':
      return 'bank'
    case 'wallet':
      return t.bankPartyId ? 'wallet' : 'plain'
    case 'credit_card':
      return 'card'
    default:
      return 'plain'
  }
}

function sum(values: ReadonlyArray<number | null>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
}

function AjustarForm({
  tenantSlug,
  params,
  close,
  setDirty,
  catalog,
}: ActionSheetProps & { catalog: CajasVentasCatalog }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
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

  const treasury = treasuries.find((t) => t.id === treasuryId)
  const mode: Mode | null = treasury ? modeOf(treasury) : null

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

  const dirty =
    counted !== null ||
    treasuryId !== initialTreasury ||
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
  /** Billetera con partidas: descuentos = lo que había por acreditar − lo que entró. */
  const discounts = diff !== null && ticked.length > 0 ? pendingTicked - diff : null
  const unexplained = discounts !== null && discounts >= 0 ? discounts - explained : null
  const showBreakdown =
    mode === 'wallet' && check !== null && (ticked.length > 0 || (diff !== null && diff < 0))

  const reasonOptions = useMemo((): ChoiceChip<Reason>[] => {
    if (diff === null || diff === 0) return []
    if (mode === 'bank') {
      return diff < 0
        ? [
            { value: 'bank_fees', label: 'Es por gastos del banco' },
            { value: 'other', label: 'Es otra diferencia' },
          ]
        : [
            { value: 'interest', label: 'Son intereses o rendimientos' },
            { value: 'other', label: 'Es otra diferencia' },
          ]
    }
    if (mode === 'plain' && diff > 0) {
      return [
        { value: 'interest', label: 'Son intereses o rendimientos' },
        { value: 'other', label: 'Es otra diferencia' },
      ]
    }
    return []
  }, [diff, mode])
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

  const undoToast = useUndoToast(tenantSlug)
  const onSaved = (saved: SavedState) => {
    close()
    undoToast(saved.message, saved)
    router.refresh()
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
      ? 'Elegí qué es la diferencia.'
      : null
  const breakdownError =
    discounts !== null && discounts >= 0 && explained > discounts
      ? `El desglose suma más que los descuentos (${formatCents(discounts)}).`
      : null
  /** Billetera: con partidas tildadas, la plata no puede haber bajado (no hay qué acreditar). */
  const walletShrank = mode === 'wallet' && ticked.length > 0 && diff !== null && diff < 0
  const countedError =
    errorOf('countedCents') ??
    (attempted && counted === null ? 'Escribí cuánto hay.' : null) ??
    (attempted && walletShrank
      ? 'Hay menos plata que antes de acreditar: revisá el número o destildá lo que no entró.'
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
    adjust.setBanner(null)
    wallet.setBanner(null)
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
        close()
        toast.success(result.message)
        router.refresh()
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
      // El gasto bancario se carga en su pantalla, con la diferencia como total debitado.
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
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      focusFirstError()
      return
    }
    posting.submit(plan === 'wallet' ? walletValues : adjustValues, preview.state, preview.key)
  }

  const busy = posting.pending || checking
  const submitLabel = (() => {
    if (plan === 'check') return 'Confirmar que coincide'
    if (plan === 'bank_fees') return 'Cargar el gasto bancario'
    if (plan === 'adjust' && mode === 'cash' && diff !== null && diff !== 0) {
      return `Registrar ajuste · ${diff < 0 ? 'faltan' : 'sobran'} ${moneyLabel(Math.abs(diff))}`
    }
    return 'Registrar ajuste'
  })()

  const name = treasury?.name ?? 'la caja'
  const countedLabel =
    mode === 'bank'
      ? '¿Cuánto dice el banco?'
      : mode === 'card'
        ? `¿Cuánto debés en ${name}?`
        : `¿Cuánto hay en ${name} ahora?`
  const countedHint =
    mode === 'cash'
      ? 'Contá la plata de la caja y escribí el total.'
      : mode === 'wallet'
        ? 'Mirá la app y copiá el saldo disponible.'
        : mode === 'bank'
          ? 'El saldo del home banking o del resumen.'
          : mode === 'card'
            ? 'Lo que dice el resumen o la app de la tarjeta.'
            : 'El saldo real de la cuenta.'

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id={`${id}-caja`} label="Caja o cuenta" required error={treasuryError}>
              <TreasurySelect
                id={`${id}-caja`}
                value={treasuryId}
                onValueChange={(next) => selectTreasury(next)}
                treasuries={treasuries}
                invalid={Boolean(treasuryError)}
                aria-describedby={describedBy(`${id}-caja`, { error: treasuryError })}
              />
            </Field>
            <DateField
              label="Fecha"
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

          {!treasury ? null : checkLoad.status === 'error' && !check ? (
            <SheetLoadError message={checkLoad.message} onRetry={() => checkLoad.reload()} />
          ) : !check ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Cargando el saldo…</span>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs text-muted-foreground">
                  Según el sistema{date && date !== today ? ` al ${formatIsoDay(date)}` : ''}
                </p>
                <p className="mt-1 font-serif text-2xl font-semibold tracking-tight tabular-nums">
                  {mode === 'card' ? (
                    check.bookCents === 0 ? (
                      <span className="text-base font-normal text-muted-foreground">Sin deuda</span>
                    ) : (
                      <>
                        <span className="text-base font-normal text-muted-foreground">
                          {check.bookCents < 0 ? 'Debés ' : 'A favor '}
                        </span>
                        {formatCents(Math.abs(check.bookCents))}
                      </>
                    )
                  ) : (
                    <Amount cents={check.bookCents} balance="treasury" tone="auto" />
                  )}
                </p>
                {mode === 'wallet' && pendingAll > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    + {formatCents(pendingAll)} por acreditar
                    {pendingSince ? ` (desde el ${formatDayMonth(pendingSince)})` : ''}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {check.lastAdjustmentDate
                    ? `Último ajuste: ${formatIsoDay(check.lastAdjustmentDate)}`
                    : 'Todavía no se ajustó.'}
                </p>
              </div>

              {items.length > 0 ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium leading-none">
                    ¿Qué se acreditó?
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    Lo que estaba por acreditar en {name}. Destildá lo que todavía no entró.
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

              <MoneyField
                label={countedLabel}
                required
                allowNegative={mode !== 'cash'}
                value={counted}
                onValueChange={(cents) => {
                  setCounted(cents)
                  adjust.clearFieldError('countedCents')
                  wallet.clearFieldError('countedCents')
                }}
                hint={countedHint}
                error={countedError}
              />

              {diff !== null ? (
                <DifferenceLine
                  mode={mode ?? 'plain'}
                  diff={diff}
                  ticked={ticked.length}
                  destination={destinationNote(mode ?? 'plain', diff, activeReason, ticked.length)}
                />
              ) : null}

              {walletShrank ? (
                <p role="status" className="text-sm text-warning-text">
                  Hay menos plata que antes de acreditar: revisá el número o destildá lo que no
                  entró.
                </p>
              ) : null}

              {mode === 'wallet' && ticked.length > 0 && diff !== null && diff >= 0 ? (
                <p className="text-sm text-muted-foreground">
                  Entró <span className="font-medium text-foreground">{formatCents(diff)}</span>
                  {discounts !== null && discounts > 0 ? (
                    <>
                      {' '}
                      · descuentos{' '}
                      <span className="font-medium text-foreground">{formatCents(discounts)}</span>
                    </>
                  ) : null}
                  {discounts !== null && discounts < 0
                    ? ` · ${formatCents(-discounts)} más de lo que había por acreditar: va a Intereses y rendimientos.`
                    : null}
                </p>
              ) : null}

              {reasonOptions.length > 0 ? (
                <div className="grid gap-2">
                  <GroupLabel id={`${id}-reason`}>¿Qué es la diferencia?</GroupLabel>
                  <ChoiceChips<Reason>
                    labelledBy={`${id}-reason`}
                    value={activeReason}
                    onChange={(next) => {
                      setReason(next)
                      adjust.setBanner(null)
                    }}
                    options={reasonOptions}
                  />
                  {reasonError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {reasonError}
                    </p>
                  ) : null}
                  {activeReason === 'bank_fees' ? (
                    <p className="text-xs text-muted-foreground">
                      Te llevamos a «Gasto bancario» con {formatCents(Math.abs(diff ?? 0))} como
                      total debitado.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showBreakdown ? (
                <fieldset className="grid gap-3">
                  <legend className="mb-1 flex items-center gap-2 text-sm font-medium leading-none">
                    Descuentos
                    {!breakdownTouched && explained > 0 ? (
                      <Badge variant="outline" className="font-normal">
                        Estimado
                      </Badge>
                    ) : null}
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    {breakdownTouched
                      ? 'Lo que descontó la billetera, según su reporte.'
                      : 'Precargado con las tasas: copiá los números del reporte de la billetera.'}
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
                            {row.label}
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
                          Certificado de SIRCUPA{' '}
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
                  {breakdownError || errorOf('breakdown') ? (
                    <p role="alert" className="text-xs text-destructive">
                      {breakdownError ?? errorOf('breakdown')}
                    </p>
                  ) : unexplained !== null && unexplained > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin explicar{' '}
                      <span className="font-medium text-foreground">
                        {formatCents(unexplained)}
                      </span>{' '}
                      → queda en «Diferencias a conciliar» para la contadora.
                    </p>
                  ) : null}
                </fieldset>
              ) : null}

              {plan === 'adjust' || plan === 'wallet' ? <EntryPreview entries={shown} /> : null}
            </>
          )}

          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter>
          <SheetCancel />
          <Button
            type="submit"
            className="h-11 sm:h-9"
            disabled={busy || (Boolean(treasury) && !check)}
          >
            {busy ? 'Guardando…' : submitLabel}
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

/** A dónde va la diferencia, en palabras (la cuenta exacta está en «Ver asiento»). */
function destinationNote(
  mode: Mode,
  diff: number,
  reason: Reason | null,
  ticked: number,
): string | null {
  if (diff === 0) return null
  if (mode === 'cash') return diff < 0 ? 'Va a «Faltantes de caja».' : 'Va a «Sobrantes de caja».'
  if (mode === 'wallet') {
    if (ticked > 0) return null
    return diff > 0
      ? 'Va a «Intereses y rendimientos».'
      : 'Lo que no expliques con los descuentos va a «Diferencias a conciliar» para la contadora.'
  }
  if (reason === 'interest') return 'Va a «Intereses y rendimientos».'
  if (reason === 'other') return 'Va a «Diferencias a conciliar» para la contadora.'
  return null
}

/** «Faltan $ 2.300» · «Sobran $ 400» · «Coincide»: en vivo, sin anunciar cada tecla. */
function DifferenceLine({
  mode,
  diff,
  ticked,
  destination,
}: {
  mode: Mode
  diff: number
  ticked: number
  destination: string | null
}) {
  if (diff === 0) {
    if (mode === 'wallet' && ticked > 0) return null
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-success">
        <CircleCheck className="size-4" aria-hidden />
        Coincide con el sistema.
      </p>
    )
  }
  if (mode === 'wallet' && ticked > 0) return null
  const amount = formatCents(Math.abs(diff))
  const text =
    mode === 'cash'
      ? diff < 0
        ? `Faltan ${amount}`
        : `Sobran ${amount}`
      : mode === 'card'
        ? diff < 0
          ? `Debés ${amount} más de lo que dice el sistema`
          : `Debés ${amount} menos de lo que dice el sistema`
        : diff < 0
          ? `Hay ${amount} menos que en el sistema`
          : `Hay ${amount} más que en el sistema`
  return (
    <div role="status" className="space-y-0.5">
      <p
        className={cn(
          'flex items-center gap-2 text-sm font-medium',
          diff < 0 && mode !== 'card' ? 'text-destructive' : 'text-warning-text',
        )}
      >
        <CircleAlert className="size-4" aria-hidden />
        {text}
      </p>
      {destination ? <p className="text-xs text-muted-foreground">{destination}</p> : null}
    </div>
  )
}
