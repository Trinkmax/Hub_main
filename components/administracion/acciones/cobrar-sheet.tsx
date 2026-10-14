'use client'

import { ChevronDown, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { postCollection } from '@/lib/accounting/actions/documents'
import { prefillDeductions } from '@/lib/accounting/posting/collection'
import { DEDUCTION_KINDS } from '@/lib/accounting/schemas'
import type { CollectionValues } from '@/lib/accounting/server/document-types'
import type { OpenItemRef } from '@/lib/accounting/types'
import { formatDayMonth, formatWeekdayDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { useAccounting } from '../accounting-provider'
import {
  ACTION_SHEET_QUESTION,
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
} from '../action-sheet'
import { Amount } from '../amount'
import { loadCajasVentasCatalog, loadPartyOpenItems, loadReceivables } from '../cajas-ventas/data'
import { FormBanner, SheetLoadError, WarningsDialog } from '../cajas-ventas/feedback'
import { describedBy, Field, GroupLabel } from '../cajas-ventas/field'
import { moneyLabel } from '../cajas-ventas/money'
import {
  firstLoadableDay,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
  withOpenItems,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, ReceivableSummary } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { Pill, StepCard } from '../kit'
import { MoneyField, MoneyInput } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasuryPicker } from '../treasury-picker'
import {
  buildCollectionValues,
  CERT_KINDS,
  type CommissionVoucherType,
  type DeductionKind,
  type DeductionRow,
  type Deductions,
  emptyDeductions,
  payerCards,
  payerName,
  settlementSummary,
  type VoucherMode,
} from './cobrar-cuenta'
import {
  DeductionLabel,
  deductionText,
  MissingLine,
  PayerChoices,
  SettlementNumber,
  SettlementTicket,
  VOUCHER_MODE_WORDS,
  VoucherModeChoices,
} from './cobrar-piezas'
import { TreasuryAfterLine } from './gasto-piezas'
import { ADD_LINK, BIG_MONEY_FIELD, TEXT_LINK } from './sheet-parts'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.cobrar
const DESCRIPTION =
  'Te depositó una tarjeta o una app, o te pagó un cliente: anotalo y mirá cuánto te descontaron.'

/**
 * Hoja «Registrar un cobro» (H.10, E.5.7): la liquidación de una tarjeta o una
 * app, o lo que pagó un cliente, en tres pasos que se tildan solos y en el
 * orden en que el dueño lo ve: ① quién te pagó → ② cuánto te entró y a dónde
 * (lo único que se ve en el banco) → ③ de qué ventas es y qué te descontaron.
 *
 * Lo que se manda no cambió: el mismo estado, las mismas validaciones y el
 * mismo `postCollection` (los valores los arma `buildCollectionValues`).
 */
export function CobrarSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  // Quién debe qué: arma las tarjetas de «¿Quién te pagó?». Si no se puede leer, queda solo el buscador.
  const receivables = useSheetLoad(() => loadReceivables(tenantSlug), tenantSlug)
  if (!load.data) {
    if (load.status === 'error') {
      return <SheetFailed title={TITLE} message={load.message} onRetry={() => load.reload()} />
    }
    return <SheetLoading title={TITLE} description={DESCRIPTION} />
  }
  return (
    <CobrarForm
      {...props}
      catalog={load.data}
      receivables={receivables.status === 'ready' ? receivables.data : []}
    />
  )
}

const RECEIVABLE_KINDS = new Set([
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
])

const VOUCHER_TYPES: ReadonlyArray<{ value: CommissionVoucherType; label: string }> = [
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'factura_a', label: 'Factura A' },
  { value: 'factura_b', label: 'Factura B' },
  { value: 'otro_comprobante', label: 'Otro comprobante' },
]

const KNOWN_FIELDS = new Set([
  'partyId',
  'date',
  'applications',
  'creditsUsed',
  'grossCents',
  'received',
  'received.0.treasuryAccountId',
  'received.0.amountCents',
  'received.0.reference',
  'commissionVoucher',
  'commissionVoucher.pointOfSale',
  'commissionVoucher.number',
  'commissionVoucher.issueDate',
  'commissionVoucher.voucherType',
])

const LAST_TREASURY_KEY = 'hub_acc_cobro_caja_'

function rememberedTreasury(partyId: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_TREASURY_KEY}${partyId}`)
  } catch {
    return null
  }
}

function rememberTreasury(partyId: string, treasuryId: string): void {
  try {
    window.localStorage.setItem(`${LAST_TREASURY_KEY}${partyId}`, treasuryId)
  } catch {
    // Sin almacenamiento (modo privado): la próxima vez se propone el banco.
  }
}

const displayName = payerName

function sum(values: Iterable<number | null>): number {
  let total = 0
  for (const v of values) total += v ?? 0
  return total
}

/** Un paso de la hoja: el número, la pregunta y su resumen, sin tarjeta (ya está dentro de la hoja). */
const SHEET_STEP = 'border-0 bg-transparent p-0 shadow-none before:hidden sm:p-0'

function CobrarForm({
  tenantSlug,
  params,
  close,
  setDirty,
  catalog,
  receivables,
}: ActionSheetProps & { catalog: CajasVentasCatalog; receivables: ReceivableSummary[] }) {
  const router = useRouter()
  const { openAction } = useAccounting()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const { today } = catalog
  const treasuries = useMemo(
    () => catalog.treasuries.filter((t) => t.kind !== 'credit_card'),
    [catalog.treasuries],
  )
  const parties = useMemo(
    () => catalog.parties.filter((p) => RECEIVABLE_KINDS.has(p.kind)),
    [catalog.parties],
  )
  const partiesById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties])

  const initialParty = params.cliente && partiesById.has(params.cliente) ? params.cliente : null
  const [partyId, setPartyId] = useState<string | null>(initialParty)
  const [date, setDate] = useState<string | null>(today)
  /** Ventas tildadas y cuánto se cobra de cada una (por defecto, lo pendiente). */
  const [apps, setApps] = useState<ReadonlyMap<string, number | null>>(() => new Map())
  const [credits, setCredits] = useState<ReadonlySet<string>>(() => new Set())
  const [gross, setGross] = useState<number | null>(null)
  const [grossTouched, setGrossTouched] = useState(false)
  const [treasuryId, setTreasuryId] = useState<string | null>(null)
  const [received, setReceived] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  const [voucherMode, setVoucherMode] = useState<VoucherMode>('none')
  const [voucherType, setVoucherType] = useState<CommissionVoucherType>('liquidacion')
  const [voucherPos, setVoucherPos] = useState('')
  const [voucherNumber, setVoucherNumber] = useState('')
  const [deductions, setDeductions] = useState<Deductions>(emptyDeductions)
  const [visible, setVisible] = useState<ReadonlySet<DeductionKind>>(() => new Set())
  const [deductionsTouched, setDeductionsTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  // Solo de pantalla (no viajan): qué está desplegado.
  const [changingPayer, setChangingPayer] = useState(false)
  const [grossOpen, setGrossOpen] = useState(false)
  const [voucherOpen, setVoucherOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)

  const party = partyId ? partiesById.get(partyId) : undefined
  const isCustomer = party?.kind === 'customer'

  const itemsLoad = useSheetLoad(
    partyId ? () => loadPartyOpenItems(tenantSlug, partyId) : null,
    partyId ?? '',
  )
  const partyItems = useMemo(
    () => (itemsLoad.status === 'ready' ? itemsLoad.data : []),
    [itemsLoad],
  )
  const debtItems = useMemo(() => partyItems.filter((i) => i.side === 'debit'), [partyItems])
  const creditItems = useMemo(() => partyItems.filter((i) => i.side === 'credit'), [partyItems])

  // ── Al elegir quién pagó: lo vencido tildado, la caja de siempre, cómo factura la comisión ──
  const preparedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!party || itemsLoad.status !== 'ready' || preparedFor.current === party.id) return
    preparedFor.current = party.id
    const asOf = date ?? today
    const wanted = params.partida
      ? debtItems.filter((i) => i.lineId === params.partida)
      : debtItems.filter((i) => i.dueDate !== null && i.dueDate <= asOf)
    setApps(new Map(wanted.map((i) => [i.lineId, i.openCents])))
    setCredits(new Set())
    setGross(null)
    setGrossTouched(false)
    setReceived(null)
    setDeductions(emptyDeductions())
    setDeductionsTouched(false)
    setVoucherMode(
      party.commissionVatMode === 'per_settlement'
        ? 'included'
        : party.commissionVatMode === 'monthly_invoice'
          ? 'later'
          : 'none',
    )
    setVoucherType(party.kind === 'card_processor' ? 'liquidacion' : 'factura_a')
    setVoucherPos('')
    setVoucherNumber('')
    const remembered = rememberedTreasury(party.id)
    const bank = treasuries.find((t) => t.kind === 'bank')
    const cash = treasuries.find((t) => t.kind === 'cash')
    setTreasuryId(
      remembered && treasuries.some((t) => t.id === remembered)
        ? remembered
        : (bank?.id ?? cash?.id ?? treasuries[0]?.id ?? null),
    )
  }, [party, itemsLoad.status, debtItems, date, today, params.partida, treasuries])

  // ── La cuenta ──
  const applied = sum(apps.values())
  const creditUsed = sum(creditItems.filter((i) => credits.has(i.lineId)).map((i) => i.openCents))
  const defaultGross = apps.size > 0 ? Math.max(0, applied - creditUsed) : null
  const grossValue = grossTouched ? gross : defaultGross
  const isCommissionParty = party !== undefined && !isCustomer

  // Los descuentos se precargan con las tasas sobre el bruto (estimados) hasta que se tocan.
  const estimated = useMemo(
    () => (party && grossValue && grossValue > 0 ? prefillDeductions(grossValue, party.rates) : []),
    [party, grossValue],
  )
  const rows: Deductions = useMemo(() => {
    if (deductionsTouched) return deductions
    const out = emptyDeductions()
    for (const d of estimated) out[d.taxKind] = { amount: d.amountCents, cert: '' }
    return out
  }, [deductionsTouched, deductions, estimated])

  const baseVisible = useMemo((): DeductionKind[] => {
    if (!party) return []
    const base: DeductionKind[] = isCommissionParty
      ? ['comision', 'iva_comision', 'ret_iibb', 'ret_ganancias']
      : []
    const prefilled = estimated.map((d) => d.taxKind)
    return DEDUCTION_KINDS.filter(
      (k) =>
        base.includes(k) || prefilled.includes(k) || visible.has(k) || (rows[k].amount ?? 0) > 0,
    )
  }, [party, isCommissionParty, estimated, visible, rows])
  const hiddenKinds = DEDUCTION_KINDS.filter((k) => !baseVisible.includes(k) && k !== 'diferencia')

  const deductionTotal = sum(DEDUCTION_KINDS.map((k) => rows[k].amount))
  const missing =
    grossValue !== null && received !== null ? grossValue - received - deductionTotal : null
  const expectedNet = grossValue !== null ? grossValue - deductionTotal : null

  function editRow(kind: DeductionKind, patch: Partial<DeductionRow>) {
    // Al tocar un descuento, lo estimado pasa a ser lo cargado.
    const base = deductionsTouched ? deductions : rows
    setDeductions({ ...base, [kind]: { ...base[kind], ...patch } })
    setDeductionsTouched(true)
    setVisible((prev) => new Set(prev).add(kind))
  }

  function addToRow(kind: DeductionKind, cents: number) {
    editRow(kind, { amount: (rows[kind].amount ?? 0) + cents })
  }

  // ── Lo que se guarda (lo arma `buildCollectionValues`: mismas claves y valores de siempre) ──
  const feesOtherAccountId = catalog.ctx.sys.fees_other.id
  const values = useMemo(
    () =>
      buildCollectionValues({
        partyId,
        date,
        apps,
        creditItems,
        credits,
        grossValue,
        rows,
        feesOtherAccountId,
        received,
        treasuryId,
        reference,
        voucherMode,
        voucherType,
        voucherPos,
        voucherNumber,
      }),
    [
      rows,
      feesOtherAccountId,
      voucherPos,
      voucherNumber,
      partyId,
      date,
      apps,
      creditItems,
      credits,
      grossValue,
      received,
      treasuryId,
      reference,
      voucherMode,
      voucherType,
    ],
  )
  const ctx = useMemo(() => withOpenItems(catalog.ctx, partyItems), [catalog.ctx, partyItems])
  const preview = useDocumentPreview('collection', values, ctx, catalog.firstOpenDate)

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<CollectionValues>({
    tenantSlug,
    action: postCollection,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key) || key.startsWith('deductions.'),
    onSaved: (saved) => {
      if (partyId && treasuryId && received !== null && received > 0) {
        rememberTreasury(partyId, treasuryId)
      }
      close()
      undoToast(saved.message, saved)
      router.refresh()
    },
  })

  const dirty =
    partyId !== initialParty ||
    received !== null ||
    grossTouched ||
    deductionsTouched ||
    reference.trim() !== ''
  useEffect(() => setDirty(dirty), [dirty, setDirty])

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  /** El primer error de una lista (`applications.2.amountCents` → se muestra bajo la lista). */
  const firstErrorUnder = (prefix: string): string | null => {
    for (const source of [posting.fieldErrors, localErrors]) {
      const key = Object.keys(source).find((k) => k === prefix || k.startsWith(`${prefix}.`))
      if (key) return source[key] ?? null
    }
    return null
  }
  const nullApplied = attempted && [...apps.values()].some((v) => v === null)
  const appsError =
    firstErrorUnder('applications') ??
    (nullApplied ? 'Escribí cuánto cobrás de cada venta tildada (hasta lo pendiente).' : null)
  const creditsError = firstErrorUnder('creditsUsed')
  // La posición de cada descuento en lo que se manda (para ubicar sus errores).
  const deductionIndex = new Map(
    DEDUCTION_KINDS.filter((k) => (rows[k].amount ?? 0) > 0).map((k, i) => [k, i] as const),
  )
  const deductionError = (kind: DeductionKind, field: 'amountCents' | 'certificateNumber') => {
    const index = deductionIndex.get(kind)
    return index === undefined ? null : errorOf(`deductions.${index}.${field}`)
  }
  const missingError =
    attempted && missing !== null && missing !== 0
      ? missing > 0
        ? `Faltan explicar ${formatCentsShort(missing)}: elegí una de las tres opciones.`
        : `Entraron ${formatCentsShort(-missing)} más de lo que da la cuenta: dejalo a cuenta o revisá los descuentos.`
      : null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  // ── «¿Quién te pagó?»: los que más deben, el más atrasado primero ──
  const cards = useMemo(() => payerCards(receivables, partiesById), [receivables, partiesById])

  const partyOptions = useMemo(
    (): PartyOption[] =>
      parties.map((p) => ({
        id: p.id,
        name: p.name,
        tradeName: p.tradeName,
        taxId: p.taxId,
        active: p.active,
      })),
    [parties],
  )

  // Lo de Mercado Pago se anota mejor contando la caja (se escribe lo que hay en la app).
  const walletTreasury =
    party?.kind === 'payment_wallet'
      ? catalog.treasuries.find((t) => t.bankPartyId === party.id)
      : undefined

  function choose(next: string | null) {
    setChangingPayer(false)
    if (next === partyId) return
    setPartyId(next)
    preparedFor.current = null
    setApps(new Map())
    setCredits(new Set())
    posting.setBanner(null)
    posting.clearFieldError('partyId')
    setAttempted(false)
  }

  function toggleItem(item: OpenItemRef, on: boolean) {
    setApps((prev) => {
      const next = new Map(prev)
      if (on) next.set(item.lineId, item.openCents)
      else next.delete(item.lineId)
      return next
    })
    posting.clearFieldError('applications')
  }

  function selectItems(filter: (i: OpenItemRef) => boolean) {
    setApps(new Map(debtItems.filter(filter).map((i) => [i.lineId, i.openCents])))
    posting.clearFieldError('applications')
  }

  // Qué atajo de «Tildar:» coincide con lo que está tildado (para dibujarlo relleno).
  const selectionShortcut = ((): 'late' | 'all' | 'none' | null => {
    if (apps.size === 0) return 'none'
    const picked = (filter: (i: OpenItemRef) => boolean) => {
      const ids = debtItems.filter(filter).map((i) => i.lineId)
      return ids.length === apps.size && ids.every((lineId) => apps.has(lineId))
    }
    if (picked(() => true)) return 'all'
    if (picked((i) => i.dueDate !== null && i.dueDate <= (date ?? today))) return 'late'
    return null
  })()

  function itemLabel(item: OpenItemRef): string {
    const method = item.salesMethodId ? catalog.ctx.methods.get(item.salesMethodId)?.name : null
    return `${method ?? item.label} · ${formatDayMonth(item.entryDate)}`
  }

  function dueText(item: OpenItemRef): string | null {
    if (!item.dueDate) return null
    const asOf = date ?? today
    if (isCustomer) {
      return item.dueDate < asOf
        ? `venció el ${formatDayMonth(item.dueDate)}`
        : `vence el ${formatDayMonth(item.dueDate)}`
    }
    return item.dueDate < asOf
      ? `tenía que llegar el ${formatDayMonth(item.dueDate)}`
      : `llega el ${formatDayMonth(item.dueDate)}`
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok || missingError) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  const submitLabel =
    received !== null && received > 0
      ? `Anotar el cobro · entraron ${moneyLabel(received)}`
      : 'Anotar el cobro'
  const treasury = treasuries.find((t) => t.id === treasuryId)
  const loadingItems = Boolean(partyId) && itemsLoad.status !== 'ready'
  const itemsFailed = itemsLoad.status === 'error' ? itemsLoad.message : null
  const ready = Boolean(party) && !loadingItems && !itemsFailed

  // ── Lo que dice cada paso ──
  const debt = party ? (receivables.find((r) => r.partyId === party.id)?.debtCents ?? 0) : 0
  const pickingPayer = !party || changingPayer
  const hasBank = treasuries.some((t) => t.kind === 'bank')
  const stepTwoDone = received !== null && received > 0 && Boolean(treasury)
  const summary = settlementSummary({ grossCents: grossValue, receivedCents: received })
  const stillEstimated = !deductionsTouched && estimated.length > 0
  const grossError = errorOf('grossCents')
  const voucherError =
    errorOf('commissionVoucher') ??
    errorOf('commissionVoucher.voucherType') ??
    errorOf('commissionVoucher.pointOfSale') ??
    errorOf('commissionVoucher.number')
  const showVoucher = voucherOpen || Boolean(voucherError)
  const referenceLabel = isCustomer ? 'Referencia' : 'N.º de liquidación'

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          {/* ① ¿Quién te pagó? */}
          <StepCard
            open
            n={1}
            state={party ? 'done' : 'current'}
            className={SHEET_STEP}
            title={<span id={`${id}-who`}>¿Quién te pagó?</span>}
            summary={
              party && !pickingPayer
                ? `${displayName(party)}${debt > 0 ? ` · te debe ${formatCentsShort(debt)}` : ''}`
                : 'Una tarjeta, una app de delivery o un cliente.'
            }
            action={
              party && !pickingPayer ? (
                <button
                  type="button"
                  className={`${TEXT_LINK} -my-2.5`}
                  onClick={() => setChangingPayer(true)}
                >
                  <span className="text-sm font-medium">Cambiar</span>
                </button>
              ) : undefined
            }
          >
            {pickingPayer ? (
              <div className="grid gap-3">
                <PayerChoices
                  name={`${id}-payer`}
                  labelledBy={`${id}-who`}
                  cards={cards}
                  value={partyId}
                  onPick={(next) => choose(next)}
                />
                <PartyCombobox
                  id={`${id}-party`}
                  value={partyId}
                  onValueChange={(next) => choose(next)}
                  parties={partyOptions}
                  placeholder={
                    cards.length > 0 ? 'Otro cliente o plataforma' : 'Elegí quién te pagó'
                  }
                  searchPlaceholder="Nombre o CUIT"
                  invalid={Boolean(errorOf('partyId'))}
                  aria-labelledby={`${id}-who`}
                  aria-describedby={describedBy(`${id}-party`, { error: errorOf('partyId') })}
                />
                {errorOf('partyId') ? (
                  <p id={`${id}-party-error`} role="alert" className="text-xs text-destructive">
                    {errorOf('partyId')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {walletTreasury ? (
              <div className="mt-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm first:mt-0">
                <div className="space-y-2 text-pretty">
                  <p>
                    Para {walletTreasury.name} es más fácil contar la caja: mirás lo que hay en la
                    app y queda anotado solo.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 md:h-9"
                    onClick={() => openAction('ajustar', { caja: walletTreasury.id })}
                  >
                    Contar {walletTreasury.name}
                  </Button>
                </div>
              </div>
            ) : null}
          </StepCard>

          {itemsFailed && itemsLoad.status === 'error' ? (
            <SheetLoadError message={itemsFailed} onRetry={() => itemsLoad.reload()} />
          ) : null}
          {party && loadingItems ? (
            <div className="space-y-3 border-t border-border/60 pt-5" aria-busy="true">
              <span className="sr-only">Cargando lo pendiente…</span>
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : null}

          {/* ② ¿Cuánto te entró y a dónde? */}
          <div className="border-t border-border/60 pt-5">
            <StepCard
              open
              n={2}
              state={stepTwoDone ? 'done' : ready ? 'current' : 'todo'}
              className={SHEET_STEP}
              title="¿Cuánto te entró y a dónde?"
              summary={
                stepTwoDone && treasury
                  ? `${moneyLabel(received ?? 0)} a ${treasury.name}${date ? ` · ${formatWeekdayDayMonth(date)}` : ''}`
                  : 'Lo que ves en el banco o en la caja.'
              }
            >
              {ready ? (
                <div className="grid gap-5">
                  <MoneyField
                    label="¿Cuánto te entró?"
                    fieldClassName={ACTION_SHEET_QUESTION_FIELD}
                    className={BIG_MONEY_FIELD}
                    autoFocus={Boolean(initialParty)}
                    value={received}
                    onValueChange={(cents) => {
                      setReceived(cents)
                      posting.clearFieldError('received')
                      posting.clearFieldError('received.0.amountCents')
                    }}
                    hint="Lo que ves en el banco o en la caja, ya con los descuentos."
                    error={errorOf('received.0.amountCents') ?? errorOf('received')}
                  >
                    {received === null && expectedNet !== null && expectedNet > 0 && party ? (
                      <p className="text-xs text-muted-foreground text-pretty">
                        ¿No tenés el número a mano?{' '}
                        {estimated.length > 0
                          ? `Con lo que suele descontarte ${displayName(party)}, serían unos ${formatCentsShort(expectedNet)}.`
                          : `Lo de las ventas elegidas son ${formatCentsShort(expectedNet)}.`}{' '}
                        <button
                          type="button"
                          className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setReceived(expectedNet)}
                        >
                          Usar ese importe
                        </button>
                      </p>
                    ) : null}
                  </MoneyField>

                  <div className="grid gap-2">
                    <GroupLabel id={`${id}-caja-label`} className={ACTION_SHEET_QUESTION}>
                      ¿A dónde entró?
                    </GroupLabel>
                    <TreasuryPicker
                      id={`${id}-caja`}
                      value={treasuryId}
                      onValueChange={(next) => {
                        setTreasuryId(next)
                        posting.clearFieldError('received.0.treasuryAccountId')
                      }}
                      treasuries={treasuries}
                      excludeCards
                      invalid={Boolean(errorOf('received.0.treasuryAccountId'))}
                      aria-labelledby={`${id}-caja-label`}
                      aria-describedby={describedBy(`${id}-caja`, {
                        error: errorOf('received.0.treasuryAccountId'),
                      })}
                    />
                    {errorOf('received.0.treasuryAccountId') ? (
                      <p id={`${id}-caja-error`} role="alert" className="text-xs text-destructive">
                        {errorOf('received.0.treasuryAccountId')}
                      </p>
                    ) : null}
                    {treasury ? (
                      <TreasuryAfterLine
                        treasury={treasury}
                        amountCents={received}
                        direction="in"
                      />
                    ) : null}
                    {hasBank ? null : (
                      <p className="text-xs text-muted-foreground text-pretty">
                        No tenés un banco cargado. Si te depositan ahí, agregalo en Ajustes › Cajas
                        y cuentas.
                      </p>
                    )}
                  </div>

                  <DateField
                    label="¿Qué día entró?"
                    required
                    value={date}
                    onValueChange={(next) => {
                      setDate(next)
                      posting.clearFieldError('date')
                    }}
                    min={firstLoadableDay(catalog)}
                    max={today}
                    today={today}
                    error={errorOf('date')}
                  />

                  {referenceOpen || reference !== '' || errorOf('received.0.reference') ? (
                    <Field
                      id={`${id}-ref`}
                      label={referenceLabel}
                      optional
                      error={errorOf('received.0.reference')}
                    >
                      <Input
                        id={`${id}-ref`}
                        value={reference}
                        maxLength={60}
                        autoComplete="off"
                        className="h-11 text-base md:h-10 md:text-sm"
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </Field>
                  ) : (
                    <button
                      type="button"
                      className={ADD_LINK}
                      onClick={() => setReferenceOpen(true)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Agregar el {isCustomer ? 'número de referencia' : 'n.º de liquidación'}
                    </button>
                  )}
                </div>
              ) : null}
            </StepCard>
          </div>

          {/* ③ ¿De qué ventas es y qué te descontaron? */}
          <div className="border-t border-border/60 pt-5">
            <StepCard
              open
              n={3}
              state={ready ? (stepTwoDone && missing === 0 ? 'done' : 'current') : 'todo'}
              className={SHEET_STEP}
              title={
                isCustomer
                  ? '¿De qué ventas es y qué te retuvieron?'
                  : '¿De qué ventas es y qué te descontaron?'
              }
              summary={
                ready
                  ? 'Las que ya tenían que llegar vienen tildadas.'
                  : 'Aparecen cuando elegís quién te pagó.'
              }
            >
              {ready && party ? (
                <div className="grid gap-5">
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium leading-none">Ventas pendientes</legend>
                    {debtItems.length > 1 ? (
                      // Los atajos con forma de control: «Tildar:» y tres píldoras; la que
                      // coincide con lo tildado va rellena.
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-0.5 text-xs text-muted-foreground">Tildar:</span>
                        {(
                          [
                            {
                              key: 'late',
                              label: 'Lo atrasado',
                              pick: (i: OpenItemRef) =>
                                i.dueDate !== null && i.dueDate <= (date ?? today),
                            },
                            { key: 'all', label: 'Todas', pick: () => true },
                            { key: 'none', label: 'Ninguna', pick: () => false },
                          ] as const
                        ).map((shortcut) => (
                          <Pill
                            key={shortcut.key}
                            size="touch"
                            active={selectionShortcut === shortcut.key}
                            className="md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
                            onClick={() => selectItems(shortcut.pick)}
                          >
                            {shortcut.label}
                          </Pill>
                        ))}
                      </div>
                    ) : null}
                    {debtItems.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border/80 bg-card/50 px-4 py-4 text-sm text-muted-foreground">
                        {displayName(party)} no tiene ventas pendientes de cobro. Lo que cargues
                        queda como cobro a cuenta (anticipo).
                      </p>
                    ) : (
                      <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                        {debtItems.map((item) => {
                          const checked = apps.has(item.lineId)
                          const inputId = `${id}-app-${item.lineId}`
                          const due = dueText(item)
                          return (
                            <li
                              key={item.lineId}
                              className="flex min-h-11 items-center gap-3 px-3 py-2"
                            >
                              <Checkbox
                                id={inputId}
                                checked={checked}
                                onCheckedChange={(value) => toggleItem(item, value === true)}
                              />
                              <Label
                                htmlFor={inputId}
                                className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal"
                              >
                                <span className="truncate">{itemLabel(item)}</span>
                                {due ? (
                                  <span className="text-xs text-muted-foreground">{due}</span>
                                ) : null}
                              </Label>
                              {checked ? (
                                <MoneyInput
                                  aria-label={`Cuánto cobrás de ${itemLabel(item)}`}
                                  value={apps.get(item.lineId) ?? null}
                                  onValueChange={(cents) =>
                                    setApps((prev) => new Map(prev).set(item.lineId, cents))
                                  }
                                  maxCents={item.openCents}
                                  align="end"
                                  size="sm"
                                  invalid={attempted && apps.get(item.lineId) === null}
                                  className="w-36 shrink-0"
                                />
                              ) : (
                                <Amount cents={item.openCents} decimals={0} tone="muted" />
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {appsError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {appsError}
                      </p>
                    ) : null}
                  </fieldset>

                  {creditItems.length > 0 ? (
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-sm font-medium leading-none">
                        {isCustomer ? 'Usar saldo a favor' : 'Descontar lo que le debemos'}
                      </legend>
                      <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                        {creditItems.map((item) => {
                          const inputId = `${id}-cr-${item.lineId}`
                          return (
                            <li
                              key={item.lineId}
                              className="flex min-h-11 items-center gap-3 px-3 py-2"
                            >
                              <Checkbox
                                id={inputId}
                                checked={credits.has(item.lineId)}
                                onCheckedChange={(value) => {
                                  setCredits((prev) => {
                                    const next = new Set(prev)
                                    if (value === true) next.add(item.lineId)
                                    else next.delete(item.lineId)
                                    return next
                                  })
                                  posting.clearFieldError('creditsUsed')
                                }}
                              />
                              <Label
                                htmlFor={inputId}
                                className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                              >
                                {item.label} · {formatDayMonth(item.entryDate)}
                              </Label>
                              <Amount cents={item.openCents} decimals={0} />
                            </li>
                          )
                        })}
                      </ul>
                      {creditsError ? (
                        <p role="alert" className="text-xs text-destructive">
                          {creditsError}
                        </p>
                      ) : null}
                    </fieldset>
                  ) : null}

                  {apps.size === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin ventas elegidas: queda como cobro a cuenta (anticipo).
                    </p>
                  ) : (
                    <p className="text-sm">
                      Estas ventas suman{' '}
                      <span className="font-semibold tabular-nums">
                        {formatCentsShort(Math.max(0, applied - creditUsed))}
                      </span>
                      {creditUsed > 0 ? (
                        <span className="text-muted-foreground">
                          {' '}
                          (ya sin los {formatCentsShort(creditUsed)}{' '}
                          {isCustomer ? 'de su saldo a favor' : 'que le debíamos'})
                        </span>
                      ) : null}
                    </p>
                  )}

                  {grossOpen || grossTouched || grossError ? (
                    <MoneyField
                      label={isCustomer ? 'Total que te paga' : 'Total de la liquidación'}
                      optional={apps.size === 0}
                      value={grossValue}
                      onValueChange={(cents) => {
                        setGross(cents)
                        setGrossTouched(true)
                        posting.clearFieldError('grossCents')
                      }}
                      hint={
                        apps.size > 0 && !grossTouched
                          ? 'Lo de las ventas elegidas.'
                          : 'Lo que dice la liquidación antes de los descuentos.'
                      }
                      error={grossError}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`${ADD_LINK} -mt-3`}
                      onClick={() => setGrossOpen(true)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      El total de la liquidación es otro
                    </button>
                  )}

                  {summary && (!isCustomer || deductionTotal > 0) ? (
                    <SettlementNumber
                      summary={summary}
                      estimated={stillEstimated}
                      isCustomer={isCustomer}
                    />
                  ) : null}

                  <fieldset className="grid gap-3">
                    <legend className="mb-1 text-sm font-medium leading-none">
                      {isCustomer ? 'Retenciones' : '¿En qué te lo descontaron?'}
                    </legend>
                    {stillEstimated ? (
                      <p className="text-xs text-muted-foreground">
                        Precargados con lo que suele cobrarte {displayName(party)}: corregilos con
                        la liquidación.
                      </p>
                    ) : isCustomer && baseVisible.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Si el cliente te retuvo algún impuesto, agregalo con su certificado.
                      </p>
                    ) : !isCustomer && !deductionsTouched && estimated.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No sabemos cuánto te cobra {displayName(party)}: poné lo que te descontó.
                      </p>
                    ) : null}
                    {baseVisible.length > 0 ? (
                      <div className="grid gap-2">
                        {baseVisible.map((kind) => {
                          const inputId = `${id}-ded-${kind}`
                          const row = rows[kind]
                          const amountError = deductionError(kind, 'amountCents')
                          const certError = deductionError(kind, 'certificateNumber')
                          return (
                            <div key={kind} className="grid gap-1.5">
                              <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-3">
                                <Label htmlFor={inputId} className="font-normal">
                                  <span>
                                    <DeductionLabel kind={kind} />
                                  </span>
                                </Label>
                                <MoneyInput
                                  id={inputId}
                                  value={row.amount}
                                  onValueChange={(cents) => editRow(kind, { amount: cents })}
                                  align="end"
                                  invalid={Boolean(amountError)}
                                />
                              </div>
                              {amountError ? (
                                <p role="alert" className="text-xs text-destructive sm:text-right">
                                  {amountError}
                                </p>
                              ) : null}
                              {CERT_KINDS.has(kind) && (row.amount ?? 0) > 0 ? (
                                <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-3">
                                  <Label
                                    htmlFor={`${inputId}-cert`}
                                    className="text-xs font-normal text-muted-foreground"
                                  >
                                    Certificado
                                    {kind === 'ret_ganancias' ? (
                                      <span aria-hidden="true" className="text-destructive">
                                        *
                                      </span>
                                    ) : (
                                      ' (opcional)'
                                    )}
                                  </Label>
                                  <Input
                                    id={`${inputId}-cert`}
                                    value={row.cert}
                                    maxLength={40}
                                    autoComplete="off"
                                    placeholder="0001-00004567"
                                    className="h-11 text-base md:h-10 md:text-sm"
                                    aria-invalid={certError ? true : undefined}
                                    onChange={(e) => editRow(kind, { cert: e.target.value })}
                                  />
                                  {certError ? (
                                    <p
                                      role="alert"
                                      className="text-xs text-destructive sm:col-span-2 sm:text-right"
                                    >
                                      {certError}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                    {hiddenKinds.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-11 w-fit gap-1.5 md:h-8"
                          >
                            <Plus className="size-4" aria-hidden />
                            {isCustomer && baseVisible.length === 0
                              ? 'Agregar una retención'
                              : 'Agregar otro descuento'}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64">
                          {hiddenKinds.map((kind) => (
                            <DropdownMenuItem
                              key={kind}
                              className="min-h-11 md:min-h-8"
                              onSelect={() => setVisible((prev) => new Set(prev).add(kind))}
                            >
                              {deductionText(kind)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </fieldset>

                  <MissingLine
                    missing={missing}
                    received={received}
                    estimated={stillEstimated}
                    error={missingError}
                    onCommission={() => missing && addToRow('comision', missing)}
                    onOther={() => missing && addToRow('otro', missing)}
                    onDifference={() => missing && addToRow('diferencia', missing)}
                    onOnAccount={() => {
                      if (missing === null || missing >= 0 || grossValue === null) return
                      setGross(grossValue - missing)
                      setGrossTouched(true)
                    }}
                  />

                  {isCommissionParty ? (
                    <div className="grid gap-2 rounded-xl bg-secondary/50 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p id={`${id}-vat`} className="text-sm font-medium leading-snug">
                          La factura de la comisión
                        </p>
                        <button
                          type="button"
                          aria-expanded={showVoucher}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
                          onClick={() => setVoucherOpen((open) => !open)}
                        >
                          <span>
                            {VOUCHER_MODE_WORDS[voucherMode].title} ·{' '}
                            <span className="font-medium text-foreground">
                              {showVoucher ? 'Listo' : 'Cambiar'}
                            </span>
                          </span>
                          <ChevronDown
                            aria-hidden
                            className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${showVoucher ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </div>
                      {showVoucher ? (
                        <VoucherModeChoices
                          name={`${id}-vat-mode`}
                          labelledBy={`${id}-vat`}
                          value={voucherMode}
                          onPick={(next) => {
                            setVoucherMode(next)
                            posting.clearFieldError('commissionVoucher')
                          }}
                        />
                      ) : null}
                      {voucherMode === 'included' && !party.taxId ? (
                        <p className="text-xs text-warning-text text-pretty">
                          Falta el CUIT de {displayName(party)}: completalo en Ajustes › Medios de
                          cobro.
                        </p>
                      ) : null}
                      {errorOf('commissionVoucher') ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errorOf('commissionVoucher')}
                        </p>
                      ) : null}
                      {voucherMode === 'included' && showVoucher ? (
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                          <Field
                            id={`${id}-vtype`}
                            label="Comprobante"
                            error={errorOf('commissionVoucher.voucherType')}
                          >
                            <Select
                              value={voucherType}
                              onValueChange={(v) => setVoucherType(v as CommissionVoucherType)}
                            >
                              <SelectTrigger
                                id={`${id}-vtype`}
                                className="w-full bg-card data-[size=default]:h-11 md:data-[size=default]:h-10"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VOUCHER_TYPES.map((t) => (
                                  <SelectItem
                                    key={t.value}
                                    value={t.value}
                                    className="min-h-11 md:min-h-8"
                                  >
                                    {t.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field
                            id={`${id}-vpos`}
                            label="Punto de venta"
                            error={errorOf('commissionVoucher.pointOfSale')}
                          >
                            <Input
                              id={`${id}-vpos`}
                              value={voucherPos}
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={5}
                              className="h-11 bg-card text-base tabular-nums md:h-10 md:text-sm"
                              aria-invalid={
                                errorOf('commissionVoucher.pointOfSale') ? true : undefined
                              }
                              onChange={(e) => setVoucherPos(e.target.value.replace(/\D/g, ''))}
                            />
                          </Field>
                          <Field
                            id={`${id}-vnum`}
                            label="Número"
                            error={errorOf('commissionVoucher.number')}
                          >
                            <Input
                              id={`${id}-vnum`}
                              value={voucherNumber}
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={8}
                              className="h-11 bg-card text-base tabular-nums md:h-10 md:text-sm"
                              aria-invalid={errorOf('commissionVoucher.number') ? true : undefined}
                              onChange={(e) => setVoucherNumber(e.target.value.replace(/\D/g, ''))}
                            />
                          </Field>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <SettlementTicket
                    payer={displayName(party)}
                    appliedCents={applied}
                    creditUsedCents={creditUsed}
                    grossCents={grossValue}
                    grossEdited={grossTouched}
                    isCustomer={isCustomer}
                    rows={rows}
                    missing={missing}
                    received={received}
                    treasuryName={treasury?.name ?? null}
                    summary={summary}
                  />

                  <EntryPreview entries={shown} label="Ver cómo queda en los libros" />
                </div>
              ) : null}
            </StepCard>
          </div>
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter>
          <Button
            type="submit"
            className="h-11 sm:h-9"
            disabled={posting.pending || loadingItems || !party}
          >
            {posting.pending ? 'Guardando…' : submitLabel}
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
