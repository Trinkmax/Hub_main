'use client'

import { Info, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { describedBy, Field, GroupLabel } from '@/components/administracion/cajas-ventas/field'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { QuickPartyDialog } from '@/components/administracion/cajas-ventas/quick-party-dialog'
import { useDocumentPreview } from '@/components/administracion/cajas-ventas/sheet-frame'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { type TreasuryOption, TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { postSalesInvoice } from '@/lib/accounting/actions/documents'
import { netFromGross, vatFromNet } from '@/lib/accounting/iva'
import { CHANNEL_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import { fetchOpenItems } from '@/lib/accounting/queries/read-actions'
import type { SalesInvoiceValues } from '@/lib/accounting/server/document-types'
import type { Channel, IvaCondition, PostingContext, VatRateBp } from '@/lib/accounting/types'
import { addDays, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { parseVoucherNumber } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'

export type InvoiceCustomer = {
  id: string
  name: string
  tradeName: string | null
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  active: boolean
}

export type InvoiceSalesPoint = { number: number; label: string; defaultChannel: Channel }

type DocKind = 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note'
type VoucherType = SalesInvoiceValues['voucherType']
type AmountMode = 'total' | 'detail'
type AliquotRow = { key: number; rate: VatRateBp; net: number | null }
type RelatedOption = { documentId: string; label: string; entryDate: string; openCents: number }

const VOUCHERS: Readonly<Record<DocKind, ReadonlyArray<{ value: VoucherType; label: string }>>> = {
  sales_invoice: [
    { value: 'factura_a', label: 'Factura A' },
    { value: 'factura_b', label: 'Factura B' },
    { value: 'tique_factura_a', label: 'Tique factura A' },
    { value: 'tique_factura_b', label: 'Tique factura B' },
  ],
  sales_credit_note: [
    { value: 'nota_credito_a', label: 'Nota de crédito A' },
    { value: 'nota_credito_b', label: 'Nota de crédito B' },
  ],
  sales_debit_note: [
    { value: 'nota_debito_a', label: 'Nota de débito A' },
    { value: 'nota_debito_b', label: 'Nota de débito B' },
  ],
}

const RATES: readonly VatRateBp[] = [2100, 1050, 2700, 500, 250, 0]
const CHANNELS: readonly Channel[] = ['events', 'salon', 'delivery']

const KNOWN_FIELDS = new Set([
  'docKind',
  'partyId',
  'voucherType',
  'pointOfSale',
  'number',
  'issueDate',
  'dueDate',
  'channel',
  'aliquots',
  'nonTaxedCents',
  'exemptCents',
  'relatedDocumentId',
  'collectNow',
  'collectNow.treasuryAccountId',
  'collectNow.amountCents',
  'notes',
])

/** La letra que corresponde al cliente: A a un responsable inscripto, B al resto. */
function letterFor(condition: IvaCondition | undefined): 'a' | 'b' {
  return condition === 'responsable_inscripto' ? 'a' : 'b'
}

function voucherFor(kind: DocKind, letter: 'a' | 'b'): VoucherType {
  const list = VOUCHERS[kind]
  return (list.find((v) => v.value.endsWith(`_${letter}`)) ?? list[0])?.value ?? 'factura_b'
}

function displayName(p: Pick<InvoiceCustomer, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

/**
 * Factura, nota de crédito o de débito de venta suelta (E.5.9): lo que no pasa
 * por el cierre del día (eventos facturados aparte, catering, sponsoreo). Con
 * «Ya la cobraste» se guarda junto con el cobro.
 */
export function SalesInvoiceForm({
  tenantSlug,
  ctx,
  firstOpenDate,
  minDate,
  today,
  customers,
  salesPoints,
  treasuries,
  prefill,
}: {
  tenantSlug: string
  ctx: PostingContext
  firstOpenDate: string | null
  minDate: string
  today: string
  customers: InvoiceCustomer[]
  salesPoints: InvoiceSalesPoint[]
  treasuries: TreasuryOption[]
  prefill: { docKind: DocKind; partyId: string | null; relatedDocumentId: string | null }
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const base = `/${tenantSlug}/administracion`
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const defaultPoint =
    salesPoints.find((p) => p.defaultChannel === 'events') ?? salesPoints[0] ?? null

  const [docKind, setDocKind] = useState<DocKind>(prefill.docKind)
  const [partyId, setPartyId] = useState<string | null>(prefill.partyId)
  const [voucherType, setVoucherType] = useState<VoucherType>(() =>
    voucherFor(
      prefill.docKind,
      letterFor(prefill.partyId ? byId.get(prefill.partyId)?.ivaCondition : undefined),
    ),
  )
  const [pointOfSale, setPointOfSale] = useState<number | null>(defaultPoint?.number ?? null)
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState<string | null>(today)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [channel, setChannel] = useState<Channel>('events')
  const [mode, setMode] = useState<AmountMode>('total')
  const [rate, setRate] = useState<VatRateBp>(2100)
  const [total, setTotal] = useState<number | null>(null)
  const [rows, setRows] = useState<AliquotRow[]>([{ key: 0, rate: 2100, net: null }])
  const [nonTaxed, setNonTaxed] = useState<number | null>(null)
  const [exempt, setExempt] = useState<number | null>(null)
  const [relatedId, setRelatedId] = useState<string | null>(prefill.relatedDocumentId)
  const [related, setRelated] = useState<RelatedOption[]>([])
  const [collectNow, setCollectNow] = useState(false)
  const [collectTreasury, setCollectTreasury] = useState<string | null>(
    treasuries.find((t) => t.kind === 'bank')?.id ?? treasuries[0]?.id ?? null,
  )
  const [collectAmount, setCollectAmount] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const nextKey = useRef(1)

  const party = partyId ? byId.get(partyId) : undefined
  const isCredit = docKind === 'sales_credit_note'
  const isLetterA = voucherType.endsWith('_a')

  // Las facturas pendientes del cliente: para que la NC o la ND digan cuál corrigen.
  useEffect(() => {
    if (!partyId || docKind === 'sales_invoice') {
      setRelated([])
      return
    }
    let alive = true
    fetchOpenItems(tenantSlug, { partyId, side: 'debt' })
      .then((result) => {
        if (!alive || !result.ok) return
        setRelated(
          result.data
            .filter(
              (i) => i.documentKind === 'sales_invoice' || i.documentKind === 'sales_debit_note',
            )
            .map((i) => ({
              documentId: i.documentId,
              label: i.documentLabel,
              entryDate: i.entryDate,
              openCents: i.openCents,
            })),
        )
      })
      .catch(() => {
        // Sin la lista no se puede elegir la factura: la NC se guarda igual y se imputa después.
      })
    return () => {
      alive = false
    }
  }, [partyId, docKind, tenantSlug])

  // ── Importes ──
  const aliquots = useMemo(() => {
    if (mode === 'total') {
      if (total === null) return []
      if (rate === 0) return [{ vatRateBp: rate, netCents: total, vatAdjustCents: 0 }]
      const net = netFromGross(total, rate)
      const adjust = total - net - vatFromNet(net, rate)
      return [{ vatRateBp: rate, netCents: net, vatAdjustCents: adjust }]
    }
    return rows
      .filter((r) => r.net !== null)
      .map((r) => ({ vatRateBp: r.rate, netCents: r.net, vatAdjustCents: 0 }))
  }, [mode, total, rate, rows])
  const computedTotal = useMemo(() => {
    let sum = mode === 'detail' ? (nonTaxed ?? 0) + (exempt ?? 0) : 0
    for (const a of aliquots) {
      const net = a.netCents ?? 0
      sum += net + (a.vatRateBp === 0 ? 0 : vatFromNet(net, a.vatRateBp) + a.vatAdjustCents)
    }
    return sum
  }, [aliquots, mode, nonTaxed, exempt])
  const engineDue =
    !isCredit && issueDate && party ? addDays(issueDate, Math.max(0, party.paymentTermDays)) : null

  const values = useMemo(() => {
    const parsedNumber = number.trim() === '' ? null : Number(number)
    return {
      docKind,
      partyId: partyId ?? '',
      voucherType,
      pointOfSale,
      number: parsedNumber,
      issueDate: issueDate ?? '',
      dueDate: isCredit ? null : dueDate,
      channel,
      aliquots,
      nonTaxedCents: mode === 'detail' ? (nonTaxed ?? 0) : 0,
      exemptCents: mode === 'detail' ? (exempt ?? 0) : 0,
      relatedDocumentId: isCredit || docKind === 'sales_debit_note' ? relatedId : null,
      collectNow:
        collectNow && !isCredit
          ? {
              treasuryAccountId: collectTreasury ?? '',
              amountCents: collectAmount,
              date: issueDate,
              reference: null,
            }
          : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    }
  }, [
    docKind,
    partyId,
    voucherType,
    pointOfSale,
    number,
    issueDate,
    isCredit,
    dueDate,
    channel,
    aliquots,
    mode,
    nonTaxed,
    exempt,
    relatedId,
    collectNow,
    collectTreasury,
    collectAmount,
    notes,
  ])
  const preview = useDocumentPreview('sales_invoice', values, ctx, firstOpenDate)

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<SalesInvoiceValues>({
    tenantSlug,
    action: postSalesInvoice,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key) || key.startsWith('aliquots.'),
    onSaved: (saved) => {
      undoToast(saved.message, saved)
      router.push(`${base}/ventas?tab=facturas`)
    },
  })

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  const amountsError =
    errorOf('aliquots') ??
    Object.entries({ ...localErrors, ...posting.fieldErrors }).find(([k]) =>
      k.startsWith('aliquots.'),
    )?.[1] ??
    null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  function chooseKind(next: DocKind) {
    setDocKind(next)
    setVoucherType(voucherFor(next, isLetterA ? 'a' : 'b'))
    if (next === 'sales_credit_note') setCollectNow(false)
    posting.clearFieldError('voucherType')
  }

  function chooseParty(next: string | null) {
    setPartyId(next)
    setRelatedId(null)
    posting.clearFieldError('partyId')
    const customer = next ? byId.get(next) : undefined
    if (customer) setVoucherType(voucherFor(docKind, letterFor(customer.ivaCondition)))
  }

  // Pegar «0003-00000088» en el número separa el punto de venta.
  function onNumberPaste(event: ClipboardEvent<HTMLInputElement>) {
    const parsed = parseVoucherNumber(event.clipboardData.getData('text'))
    if (!parsed) return
    event.preventDefault()
    setNumber(String(parsed.number))
    if (salesPoints.some((p) => p.number === parsed.pointOfSale)) setPointOfSale(parsed.pointOfSale)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  const customerOptions = useMemo(
    (): PartyOption[] =>
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        tradeName: c.tradeName,
        taxId: c.taxId,
        active: c.active,
      })),
    [customers],
  )
  const kindOptions: ChoiceChip<DocKind>[] = [
    { value: 'sales_invoice', label: 'Factura' },
    { value: 'sales_credit_note', label: 'Nota de crédito' },
    { value: 'sales_debit_note', label: 'Nota de débito' },
  ]
  const noun =
    docKind === 'sales_credit_note'
      ? 'nota de crédito'
      : docKind === 'sales_debit_note'
        ? 'nota de débito'
        : 'factura'
  const submitLabel = posting.pending
    ? 'Guardando…'
    : collectNow && !isCredit
      ? `Guardar y cobrar${computedTotal > 0 ? ` · ${moneyLabel(computedTotal)}` : ''}`
      : `Guardar ${noun}${computedTotal > 0 ? ` · ${moneyLabel(computedTotal)}` : ''}`

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={handleFormKeyDown}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
      >
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p className="text-pretty">
              Si esta venta ya está en el cierre del día, no la cargues de nuevo: acá van las que se
              facturan aparte (eventos, catering, sponsoreo).
            </p>
          </div>

          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div className="grid gap-2">
              <GroupLabel id={`${id}-kind`}>¿Qué vas a cargar?</GroupLabel>
              <ChoiceChips<DocKind>
                labelledBy={`${id}-kind`}
                value={docKind}
                onChange={chooseKind}
                options={kindOptions}
              />
            </div>

            <Field id={`${id}-party`} label="Cliente" required error={errorOf('partyId')}>
              <PartyCombobox
                id={`${id}-party`}
                value={partyId}
                onValueChange={(next) => chooseParty(next)}
                parties={customerOptions}
                placeholder="Elegí el cliente"
                onCreate={(name) => setCreating(name)}
                invalid={Boolean(errorOf('partyId'))}
                aria-describedby={describedBy(`${id}-party`, { error: errorOf('partyId') })}
              />
            </Field>
            {party && isLetterA && !party.taxId ? (
              <p role="status" className="-mt-3 text-xs text-warning-text">
                {displayName(party)} no tiene CUIT cargado: una {noun} A lo necesita. Completalo en
                Ajustes › Partícipes o elegí la letra B.
              </p>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-3">
              <Field id={`${id}-type`} label="Comprobante" required error={errorOf('voucherType')}>
                <Select value={voucherType} onValueChange={(v) => setVoucherType(v as VoucherType)}>
                  <SelectTrigger
                    id={`${id}-type`}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOUCHERS[docKind].map((v) => (
                      <SelectItem key={v.value} value={v.value} className="min-h-11 md:min-h-8">
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id={`${id}-pos`}
                label="Punto de venta"
                required
                error={errorOf('pointOfSale')}
                hint={
                  salesPoints.length === 0 ? 'Cargá los puntos de venta en Ajustes.' : undefined
                }
              >
                <Select
                  value={pointOfSale === null ? '' : String(pointOfSale)}
                  onValueChange={(v) => {
                    setPointOfSale(Number(v))
                    posting.clearFieldError('pointOfSale')
                  }}
                >
                  <SelectTrigger
                    id={`${id}-pos`}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    aria-invalid={errorOf('pointOfSale') ? true : undefined}
                  >
                    <SelectValue placeholder="Elegí" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesPoints.map((p) => (
                      <SelectItem
                        key={p.number}
                        value={String(p.number)}
                        className="min-h-11 md:min-h-8"
                      >
                        {String(p.number).padStart(4, '0')} · {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`${id}-number`} label="Número" required error={errorOf('number')}>
                <Input
                  id={`${id}-number`}
                  value={number}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={13}
                  placeholder="00000088"
                  className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                  aria-invalid={errorOf('number') ? true : undefined}
                  aria-describedby={describedBy(`${id}-number`, { error: errorOf('number') })}
                  onPaste={onNumberPaste}
                  onChange={(e) => {
                    setNumber(e.target.value.replace(/\D/g, '').slice(0, 8))
                    posting.clearFieldError('number')
                  }}
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <DateField
                label="Fecha"
                required
                value={issueDate}
                onValueChange={(next) => {
                  setIssueDate(next)
                  posting.clearFieldError('issueDate')
                }}
                min={minDate}
                max={today}
                today={today}
                error={errorOf('issueDate')}
              />
              {isCredit ? null : (
                <DateField
                  label="Vence"
                  optional
                  value={dueDate}
                  onValueChange={(next) => {
                    setDueDate(next)
                    posting.clearFieldError('dueDate')
                  }}
                  min={issueDate ?? undefined}
                  shortcuts={false}
                  hint={
                    dueDate === null && engineDue
                      ? `Si lo dejás vacío: ${formatIsoDay(engineDue)} (plazo del cliente).`
                      : undefined
                  }
                  error={errorOf('dueDate')}
                />
              )}
              <Field id={`${id}-channel`} label="Canal" error={errorOf('channel')}>
                <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                  <SelectTrigger
                    id={`${id}-channel`}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c} className="min-h-11 md:min-h-8">
                        {CHANNEL_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {(isCredit || docKind === 'sales_debit_note') && related.length > 0 ? (
              <Field
                id={`${id}-related`}
                label={isCredit ? '¿Qué factura corrige?' : '¿Sobre qué factura?'}
                optional
                hint={isCredit ? 'Se descuenta sola de lo que te debe por esa factura.' : undefined}
                error={errorOf('relatedDocumentId')}
              >
                <Select
                  value={relatedId ?? 'ninguna'}
                  onValueChange={(v) => setRelatedId(v === 'ninguna' ? null : v)}
                >
                  <SelectTrigger
                    id={`${id}-related`}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna" className="min-h-11 md:min-h-8">
                      Ninguna en particular
                    </SelectItem>
                    {related.map((r) => (
                      <SelectItem
                        key={r.documentId}
                        value={r.documentId}
                        className="min-h-11 md:min-h-8"
                      >
                        {r.label} · {formatDayMonth(r.entryDate)} · pendiente{' '}
                        {formatCents(r.openCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-lg font-semibold tracking-tight">Importes</h2>
              <Button
                type="button"
                variant="link"
                className="h-auto px-0 text-xs"
                onClick={() => setMode(mode === 'total' ? 'detail' : 'total')}
              >
                {mode === 'total'
                  ? 'Cargar por alícuota, no gravado o exento'
                  : 'Cargar solo el total'}
              </Button>
            </div>

            {mode === 'total' ? (
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <MoneyField
                  label="Total (con IVA)"
                  required
                  value={total}
                  onValueChange={(cents) => {
                    setTotal(cents)
                    posting.clearFieldError('aliquots')
                  }}
                  error={amountsError}
                  hint={
                    aliquots[0] && total !== null && rate !== 0
                      ? `Neto ${formatCents(aliquots[0].netCents)} · IVA ${vatRateLabel(rate)} ${formatCents(total - (aliquots[0].netCents ?? 0))}`
                      : undefined
                  }
                />
                <Field id={`${id}-rate`} label="Alícuota">
                  <Select
                    value={String(rate)}
                    onValueChange={(v) => setRate(Number(v) as VatRateBp)}
                  >
                    <SelectTrigger
                      id={`${id}-rate`}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATES.map((r) => (
                        <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                          {vatRateLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            ) : (
              <div className="grid gap-3">
                {rows.map((row, index) => {
                  const vat = row.net !== null && row.rate !== 0 ? vatFromNet(row.net, row.rate) : 0
                  return (
                    <div
                      key={row.key}
                      className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-start"
                    >
                      <Select
                        value={String(row.rate)}
                        onValueChange={(v) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key ? { ...r, rate: Number(v) as VatRateBp } : r,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                          aria-label={`Alícuota de la fila ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RATES.map((r) => (
                            <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                              {vatRateLabel(r)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="grid gap-1">
                        <MoneyInput
                          value={row.net}
                          onValueChange={(cents) => {
                            setRows((prev) =>
                              prev.map((r) => (r.key === row.key ? { ...r, net: cents } : r)),
                            )
                            posting.clearFieldError('aliquots')
                          }}
                          align="end"
                          aria-label={`Neto gravado de la fila ${index + 1}`}
                          placeholder="Neto"
                        />
                        {row.net !== null && row.rate !== 0 ? (
                          <p className="text-right text-xs text-muted-foreground">
                            IVA {vatRateLabel(row.rate)}: {formatCents(vat)}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 justify-self-end text-muted-foreground md:size-9"
                        aria-label={`Quitar la fila ${index + 1}`}
                        disabled={rows.length === 1}
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  )
                })}
                {rows.length < 6 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 w-fit gap-1.5 md:h-8"
                    onClick={() => {
                      const used = new Set(rows.map((r) => r.rate))
                      const free = RATES.find((r) => !used.has(r)) ?? 2100
                      const key = nextKey.current
                      nextKey.current += 1
                      setRows((prev) => [...prev, { key, rate: free, net: null }])
                    }}
                  >
                    <Plus className="size-4" aria-hidden />
                    Otra alícuota
                  </Button>
                ) : null}
                <div className="grid gap-5 sm:grid-cols-2">
                  <MoneyField
                    label="No gravado"
                    optional
                    value={nonTaxed}
                    onValueChange={setNonTaxed}
                    error={errorOf('nonTaxedCents')}
                  />
                  <MoneyField
                    label="Exento"
                    optional
                    value={exempt}
                    onValueChange={setExempt}
                    error={errorOf('exemptCents')}
                  />
                </div>
                {amountsError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {amountsError}
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-4">
              <span className="text-sm text-muted-foreground">Total del comprobante</span>
              <span className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                {formatCents(computedTotal)}
              </span>
            </div>
          </div>

          {isCredit ? null : (
            <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`${id}-collect`}
                  checked={collectNow}
                  onCheckedChange={(value) => setCollectNow(value === true)}
                  className="mt-0.5"
                />
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-collect`}>Ya la cobraste</Label>
                  <p className="text-xs text-muted-foreground">
                    Se guarda junto con el cobro y queda saldada.
                  </p>
                </div>
              </div>
              {collectNow ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    id={`${id}-ctreasury`}
                    label="Entró a"
                    required
                    error={errorOf('collectNow.treasuryAccountId')}
                  >
                    <TreasurySelect
                      id={`${id}-ctreasury`}
                      value={collectTreasury}
                      onValueChange={(next) => setCollectTreasury(next)}
                      treasuries={treasuries}
                      excludeCards
                      invalid={Boolean(errorOf('collectNow.treasuryAccountId'))}
                    />
                  </Field>
                  <MoneyField
                    label="¿Cuánto?"
                    optional
                    value={collectAmount}
                    onValueChange={setCollectAmount}
                    hint={
                      collectAmount === null && computedTotal > 0
                        ? `Vacío: el total (${formatCents(computedTotal)}).`
                        : undefined
                    }
                    error={errorOf('collectNow.amountCents')}
                  />
                </div>
              ) : null}
            </div>
          )}

          <div className="card-hairline rounded-xl border bg-card p-6">
            <Field id={`${id}-notes`} label="Nota" optional error={errorOf('notes')}>
              <Textarea
                id={`${id}-notes`}
                value={notes}
                rows={2}
                maxLength={1000}
                placeholder="Por ejemplo: evento de fin de año de Empresa X."
                className="text-base md:text-sm"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          <FormBanner banner={posting.banner} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`${base}/ventas?tab=facturas`}>Cancelar</Link>
            </Button>
            <Button type="submit" className="h-11 min-w-[200px] md:h-9" disabled={posting.pending}>
              {submitLabel}
            </Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20">
          <EntryPreview entries={shown} />
        </aside>
      </form>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
      <QuickPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        kind="customer"
        initialName={creating ?? ''}
        requireCuit={isLetterA}
        onCreated={(created) => {
          setPartyId(created.id)
          setVoucherType(voucherFor(docKind, letterFor(created.ivaCondition)))
          posting.clearFieldError('partyId')
          // El cliente nuevo tiene que estar en el contexto de la vista previa.
          router.refresh()
        }}
      />
    </>
  )
}
