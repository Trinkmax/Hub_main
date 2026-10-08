'use client'

import { CircleCheck, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { formatDayMonth } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useAccounting } from '../accounting-provider'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { Amount } from '../amount'
import { type ChoiceChip, ChoiceChips } from '../cajas-ventas/choice-chips'
import { loadCajasVentasCatalog, loadPartyOpenItems, loadReceivables } from '../cajas-ventas/data'
import { FormBanner, SheetLoadError, WarningsDialog } from '../cajas-ventas/feedback'
import { describedBy, Field, GroupLabel } from '../cajas-ventas/field'
import { moneyLabel } from '../cajas-ventas/money'
import {
  firstLoadableDay,
  SheetCancel,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
  withOpenItems,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, ReceivableSummary, SheetParty } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { MoneyField, MoneyInput } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasurySelect } from '../treasury-select'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.cobrar
const DESCRIPTION = 'Una liquidación de tarjeta o plataforma, o lo que te pagó un cliente.'

/** Hoja «Registrar un cobro» (H.10, E.5.7): acreditación con comisión, IVA y retenciones. */
export function CobrarSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  // Quién debe qué: ordena los atajos. Si no se puede leer, queda solo el buscador.
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

type DeductionKind = (typeof DEDUCTION_KINDS)[number]
type VoucherMode = 'included' | 'later' | 'none'
type VoucherType = 'liquidacion' | 'factura_a' | 'factura_b' | 'otro_comprobante'
type DeductionRow = { amount: number | null; cert: string }
type Deductions = Readonly<Record<DeductionKind, DeductionRow>>

const RECEIVABLE_KINDS = new Set([
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
])

const DEDUCTION_LABELS: Readonly<Record<DeductionKind, string>> = {
  comision: 'Comisión',
  iva_comision: 'IVA de la comisión',
  percepcion_iva_comision: 'Percepción de IVA',
  ret_iva: 'Retención de IVA',
  ret_iibb: 'Retención de Ingresos Brutos',
  sircupa: 'SIRCUPA',
  ret_ganancias: 'Retención de Ganancias',
  otro: 'Otros cargos',
  diferencia: 'Diferencia sin explicar',
}

/** Las que llevan número de certificado (en Ganancias es obligatorio). */
const CERT_KINDS: ReadonlySet<DeductionKind> = new Set([
  'ret_iva',
  'ret_iibb',
  'sircupa',
  'ret_ganancias',
])

const VOUCHER_TYPES: ReadonlyArray<{ value: VoucherType; label: string }> = [
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'factura_a', label: 'Factura A' },
  { value: 'factura_b', label: 'Factura B' },
  { value: 'otro_comprobante', label: 'Otro comprobante' },
]

const EMPTY_ROW: DeductionRow = { amount: null, cert: '' }

function emptyDeductions(): Record<DeductionKind, DeductionRow> {
  const out = {} as Record<DeductionKind, DeductionRow>
  for (const kind of DEDUCTION_KINDS) out[kind] = EMPTY_ROW
  return out
}

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

function displayName(p: Pick<SheetParty, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

function sum(values: Iterable<number | null>): number {
  let total = 0
  for (const v of values) total += v ?? 0
  return total
}

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
  const [voucherType, setVoucherType] = useState<VoucherType>('liquidacion')
  const [voucherPos, setVoucherPos] = useState('')
  const [voucherNumber, setVoucherNumber] = useState('')
  const [deductions, setDeductions] = useState<Deductions>(emptyDeductions)
  const [visible, setVisible] = useState<ReadonlySet<DeductionKind>>(() => new Set())
  const [deductionsTouched, setDeductionsTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)

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

  // ── Lo que se guarda ──
  const values = useMemo(() => {
    const deductionList = DEDUCTION_KINDS.flatMap((kind) => {
      const row = rows[kind]
      if (row.amount === null || row.amount <= 0) return []
      return [
        {
          taxKind: kind,
          amountCents: row.amount,
          accountId: kind === 'otro' ? catalog.ctx.sys.fees_other.id : null,
          certificateNumber:
            CERT_KINDS.has(kind) && row.cert.trim() !== '' ? row.cert.trim() : null,
          salesMethodId: null,
        },
      ]
    })
    const pos = voucherPos.trim() === '' ? Number.NaN : Number(voucherPos)
    const number = voucherNumber.trim() === '' ? Number.NaN : Number(voucherNumber)
    return {
      partyId: partyId ?? '',
      date: date ?? '',
      applications: [...apps].map(([lineId, amount]) => ({ lineId, amountCents: amount })),
      creditsUsed: creditItems
        .filter((i) => credits.has(i.lineId))
        .map((i) => ({ lineId: i.lineId, amountCents: i.openCents })),
      grossCents: grossValue,
      deductions: deductionList,
      received:
        received !== null && received > 0
          ? [
              {
                treasuryAccountId: treasuryId ?? '',
                amountCents: received,
                reference: reference.trim() === '' ? null : reference.trim(),
              },
            ]
          : [],
      writeOffCents: 0,
      commissionVoucher:
        voucherMode === 'included'
          ? {
              mode: 'included',
              voucherType,
              pointOfSale: Number.isNaN(pos) ? null : pos,
              number: Number.isNaN(number) ? null : number,
              issueDate: date ?? '',
            }
          : { mode: voucherMode },
      notes: null,
    }
  }, [
    rows,
    catalog.ctx.sys.fees_other.id,
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
  ])
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
        ? `Falta asignar ${formatCents(missing)}: usá uno de los botones de abajo.`
        : `Sobran ${formatCents(-missing)}: revisá lo que entró o los descuentos.`
      : null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  // ── Atajos de «¿Quién te pagó?»: los que deben, el más atrasado primero ──
  const chips = useMemo((): ChoiceChip<string>[] => {
    const owing = receivables
      .filter((r) => r.debtCents > 0 && partiesById.get(r.partyId)?.active)
      .sort(
        (a, b) =>
          b.overdueCents - a.overdueCents ||
          (a.oldestDueDate ?? '9999').localeCompare(b.oldestDueDate ?? '9999') ||
          b.debtCents - a.debtCents,
      )
      .slice(0, 6)
    const list = owing.flatMap((r) => {
      const p = partiesById.get(r.partyId)
      return p
        ? [
            {
              value: p.id,
              label: displayName(p),
              ariaLabel: `${displayName(p)}, te debe ${formatCents(r.debtCents)}`,
            },
          ]
        : []
    })
    // Lo que vino en la URL (o se eligió en el buscador) también se ve como chip.
    if (party && !list.some((c) => c.value === party.id)) {
      list.unshift({ value: party.id, label: displayName(party), ariaLabel: displayName(party) })
    }
    return list
  }, [receivables, partiesById, party])

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

  // Mercado Pago se acredita mejor con «Ajustar saldo» (se cuenta lo que hay).
  const walletTreasury =
    party?.kind === 'payment_wallet'
      ? catalog.treasuries.find((t) => t.bankPartyId === party.id)
      : undefined

  function choose(next: string | null) {
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
      ? `se acreditaba el ${formatDayMonth(item.dueDate)}`
      : `se acredita el ${formatDayMonth(item.dueDate)}`
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
      ? `Registrar cobro · entró ${moneyLabel(received)}`
      : 'Registrar cobro'
  const treasury = treasuries.find((t) => t.id === treasuryId)
  const loadingItems = Boolean(partyId) && itemsLoad.status !== 'ready'
  const itemsFailed = itemsLoad.status === 'error' ? itemsLoad.message : null

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          <div className="grid gap-2">
            <GroupLabel id={`${id}-who`}>
              ¿Quién te pagó?
              {/* El mismo espacio que el asterisco de un <Label> (gap-2 + ml-0.5). */}
              <span aria-hidden="true" className="ml-2.5 text-destructive">
                *
              </span>
            </GroupLabel>
            {chips.length > 0 ? (
              <ChoiceChips<string>
                labelledBy={`${id}-who`}
                value={partyId}
                onChange={(next) => choose(next)}
                options={chips}
              />
            ) : null}
            <PartyCombobox
              id={`${id}-party`}
              value={partyId}
              onValueChange={(next) => choose(next)}
              parties={partyOptions}
              placeholder={chips.length > 0 ? 'Otro cliente o plataforma' : 'Elegí quién te pagó'}
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

          {walletTreasury ? (
            <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
              <div className="flex-1 space-y-2 text-pretty">
                <p>
                  Para {walletTreasury.name} es más fácil «Ajustar saldo»: contás lo que hay en la
                  app y se acredita solo.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-8"
                  onClick={() => openAction('ajustar', { caja: walletTreasury.id })}
                >
                  Ajustar saldo de {walletTreasury.name}
                </Button>
              </div>
            </div>
          ) : null}

          {!party ? null : itemsFailed && itemsLoad.status === 'error' ? (
            <SheetLoadError message={itemsFailed} onRetry={() => itemsLoad.reload()} />
          ) : loadingItems ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Cargando lo pendiente…</span>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <>
              <fieldset className="grid gap-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <legend className="text-sm font-medium leading-none">¿De qué ventas es?</legend>
                  {debtItems.length > 1 ? (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 text-xs md:h-7"
                        onClick={() =>
                          selectItems((i) => i.dueDate !== null && i.dueDate <= (date ?? today))
                        }
                      >
                        Lo vencido
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 text-xs md:h-7"
                        onClick={() => selectItems(() => true)}
                      >
                        Todas
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 text-xs md:h-7"
                        onClick={() => selectItems(() => false)}
                      >
                        Ninguna
                      </Button>
                    </div>
                  ) : null}
                </div>
                {debtItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border/80 bg-card/50 px-4 py-4 text-sm text-muted-foreground">
                    {displayName(party)} no tiene ventas pendientes de cobro. Lo que cargues queda
                    como cobro a cuenta (anticipo).
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
                            <Amount cents={item.openCents} tone="muted" />
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
                          <Amount cents={item.openCents} />
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
              ) : null}

              <MoneyField
                label="Lo liquidado (bruto)"
                optional={apps.size === 0}
                value={grossValue}
                onValueChange={(cents) => {
                  setGross(cents)
                  setGrossTouched(true)
                  posting.clearFieldError('grossCents')
                }}
                hint={apps.size > 0 && !grossTouched ? 'Lo de las ventas elegidas.' : undefined}
                error={errorOf('grossCents')}
              />

              {/* Uno abajo del otro: la caja con su saldo no entra en media hoja y
                  empujaba «¿Cuánto entró?» fuera del borde. */}
              <div className="grid gap-5">
                <Field
                  id={`${id}-caja`}
                  label="Entró a"
                  error={errorOf('received.0.treasuryAccountId')}
                >
                  <TreasurySelect
                    id={`${id}-caja`}
                    value={treasuryId}
                    onValueChange={(next) => {
                      setTreasuryId(next)
                      posting.clearFieldError('received.0.treasuryAccountId')
                    }}
                    treasuries={treasuries}
                    excludeCards
                    invalid={Boolean(errorOf('received.0.treasuryAccountId'))}
                    aria-describedby={describedBy(`${id}-caja`, {
                      error: errorOf('received.0.treasuryAccountId'),
                    })}
                  />
                </Field>
                <MoneyField
                  label="¿Cuánto entró?"
                  value={received}
                  onValueChange={(cents) => {
                    setReceived(cents)
                    posting.clearFieldError('received')
                    posting.clearFieldError('received.0.amountCents')
                  }}
                  error={errorOf('received.0.amountCents') ?? errorOf('received')}
                >
                  {received === null && expectedNet !== null && expectedNet > 0 ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto justify-start px-0 text-xs"
                      onClick={() => setReceived(expectedNet)}
                    >
                      Usar {formatCents(expectedNet)} (lo liquidado menos los descuentos)
                    </Button>
                  ) : null}
                </MoneyField>
              </div>
              <Field
                id={`${id}-ref`}
                label={isCustomer ? 'Referencia' : 'Nº de liquidación'}
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

              {isCommissionParty ? (
                <div className="grid gap-2">
                  <GroupLabel id={`${id}-vat`}>¿Tenés la factura de la comisión?</GroupLabel>
                  <ChoiceChips<VoucherMode>
                    labelledBy={`${id}-vat`}
                    value={voucherMode}
                    onChange={(next) => {
                      setVoucherMode(next)
                      posting.clearFieldError('commissionVoucher')
                    }}
                    options={[
                      { value: 'included', label: 'Viene en la liquidación' },
                      { value: 'later', label: 'Llega después' },
                      { value: 'none', label: 'No factura' },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {voucherMode === 'included'
                      ? 'El IVA de la comisión va al libro IVA compras.'
                      : voucherMode === 'later'
                        ? 'El IVA queda «a documentar» hasta que cargues la factura del mes.'
                        : 'El IVA de la comisión va al costo.'}
                    {voucherMode === 'included' && party && !party.taxId
                      ? ` Falta el CUIT de ${displayName(party)}: completalo en Ajustes › Partícipes.`
                      : ''}
                  </p>
                  {voucherMode === 'included' ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                      <Field
                        id={`${id}-vtype`}
                        label="Comprobante"
                        error={errorOf('commissionVoucher.voucherType')}
                      >
                        <Select
                          value={voucherType}
                          onValueChange={(v) => setVoucherType(v as VoucherType)}
                        >
                          <SelectTrigger
                            id={`${id}-vtype`}
                            className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
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
                          className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                          aria-invalid={errorOf('commissionVoucher.pointOfSale') ? true : undefined}
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
                          className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                          aria-invalid={errorOf('commissionVoucher.number') ? true : undefined}
                          onChange={(e) => setVoucherNumber(e.target.value.replace(/\D/g, ''))}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <fieldset className="grid gap-3">
                <legend className="mb-1 flex items-center gap-2 text-sm font-medium leading-none">
                  {isCustomer ? 'Retenciones' : 'Descuentos'}
                  {!deductionsTouched && estimated.length > 0 ? (
                    <Badge variant="outline" className="font-normal">
                      Estimado
                    </Badge>
                  ) : null}
                </legend>
                {!deductionsTouched && estimated.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Precargados con las tasas de {displayName(party)}: corregilos con la
                    liquidación.
                  </p>
                ) : isCustomer && baseVisible.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Si el cliente te retuvo algún impuesto, agregalo con su certificado.
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
                              {DEDUCTION_LABELS[kind]}
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
                          {DEDUCTION_LABELS[kind]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </fieldset>

              <MissingLine
                missing={missing}
                received={received}
                treasuryName={treasury?.name ?? null}
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

              <DateField
                label="Fecha"
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

              <EntryPreview entries={shown} />
            </>
          )}
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter>
          <SheetCancel />
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

/** «Falta asignar»: bruto − lo que entró − descuentos, con sus arreglos en un toque (H.10). */
function MissingLine({
  missing,
  received,
  treasuryName,
  error,
  onCommission,
  onOther,
  onDifference,
  onOnAccount,
}: {
  missing: number | null
  received: number | null
  treasuryName: string | null
  error: string | null
  onCommission: () => void
  onOther: () => void
  onDifference: () => void
  onOnAccount: () => void
}) {
  if (received === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Escribí cuánto entró{treasuryName ? ` a ${treasuryName}` : ''} y te mostramos si cuadra con
        lo liquidado.
      </p>
    )
  }
  if (missing === null) return null
  if (missing === 0) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-success">
        <CircleCheck className="size-4" aria-hidden />
        Falta asignar $ 0,00: cuadra con lo liquidado.
      </p>
    )
  }
  return (
    <div
      className={cn(
        'space-y-2 rounded-xl border p-4 text-sm',
        error ? 'border-destructive/30 bg-destructive/10' : 'border-warning/40 bg-warning/10',
      )}
    >
      <p
        role="status"
        className={cn('font-medium', error ? 'text-destructive' : 'text-warning-text')}
      >
        {missing > 0
          ? `Falta asignar ${formatCents(missing)}`
          : `Entró ${formatCents(-missing)} más de lo liquidado`}
      </p>
      <div className="flex flex-wrap gap-2">
        {missing > 0 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={onCommission}
            >
              Ponerlo en comisión
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={onOther}
            >
              Ponerlo en otros cargos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={onDifference}
            >
              Es una diferencia sin explicar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 md:h-8"
            onClick={onOnAccount}
          >
            Dejarlo a cuenta ({formatCents(-missing)})
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
