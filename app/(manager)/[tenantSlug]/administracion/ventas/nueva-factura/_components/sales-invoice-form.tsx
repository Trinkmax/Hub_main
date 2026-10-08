'use client'

import { BookPlus, Info, Plus, Printer, RefreshCw, X } from 'lucide-react'
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
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { ArcaProblem } from '@/components/administracion/arca/arca-problem'
import {
  ArcaConceptoField,
  ArcaConditionField,
  ArcaDetailField,
  ArcaNumberRow,
  ArcaRelatedField,
} from '@/components/administracion/arca/emission-fields'
import {
  EmitConfirmDialog,
  type EmitSummary,
} from '@/components/administracion/arca/emit-confirm-dialog'
import { PostVoucherDialog } from '@/components/administracion/arca/post-voucher-dialog'
import { type ArcaLock, useArcaEmission } from '@/components/administracion/arca/use-arca-emission'
import {
  type ArcaNextNumberState,
  useArcaNextNumber,
} from '@/components/administracion/arca/use-arca-next-number'
import { ArcaVoucherAttention } from '@/components/administracion/arca/voucher-attention'
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
import { ACC_UNREACHABLE, issuePath } from '@/lib/accounting/action-state'
import { postSalesInvoice } from '@/lib/accounting/actions/documents'
import { netFromGross, vatFromNet } from '@/lib/accounting/iva'
import { letterFor } from '@/lib/accounting/letter'
import { CHANNEL_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import { fetchOpenItems } from '@/lib/accounting/queries/read-actions'
import type { SalesInvoiceValues } from '@/lib/accounting/server/document-types'
import type {
  Channel,
  IvaCondition,
  PostingContext,
  TaxIdType,
  VatRateBp,
} from '@/lib/accounting/types'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import { ensureArcaFinalConsumer, reconcileArcaVoucher } from '@/lib/arca/emit-actions'
import {
  type ArcaConcepto,
  type ArcaEmissionSetup,
  type ArcaEmitValues,
  arcaCbteFor,
  arcaDateHint,
  arcaDateWindow,
  arcaEmitSchema,
  arcaLetterFor,
  arcaPrintHref,
  arcaReceiverIssue,
  arcaVoucherTypeFor,
} from '@/lib/arca/emit-form'
import { condicionFromIvaCondition } from '@/lib/arca/vouchers'
import { addDays, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatVoucherNumber, parseVoucherNumber } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'

export type InvoiceCustomer = {
  id: string
  name: string
  tradeName: string | null
  taxId: string | null
  taxIdType: TaxIdType
  ivaCondition: IvaCondition
  paymentTermDays: number
  active: boolean
}

export type InvoiceSalesPoint = { number: number; label: string; defaultChannel: Channel }

/** Lo que la factura necesita saber de ARCA (lo carga la página). */
export type InvoiceArca = {
  setup: ArcaEmissionSetup
  /** El cliente de sistema «Consumidor final», si ya existe. */
  finalConsumerId: string | null
  /** Cómo se llama el punto de venta de la plataforma en Ajustes › Puntos de venta. */
  pointOfSaleLabel: string | null
  /** No se pudo leer el estado de ARCA (la factura se carga como siempre). */
  loadError: string | null
}

type DocKind = 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note'
type VoucherType = SalesInvoiceValues['voucherType']
type AmountMode = 'total' | 'detail'
type AliquotRow = { key: number; rate: VatRateBp; net: number | null }
type RelatedOption = { documentId: string; label: string; entryDate: string; openCents: number }
type HowMode = 'arca' | 'manual'

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

const HOW_OPTIONS: ChoiceChip<HowMode>[] = [
  { value: 'arca', label: 'La emito ahora con ARCA' },
  { value: 'manual', label: 'Ya la emití en otro sistema' },
]

/** El valor de la fila «Consumidor final» mientras el cliente de sistema todavía no existe. */
const FINAL_CONSUMER_PICK = 'consumidor-final'
const FINAL_CONSUMER_LABEL = 'Consumidor final (sin identificar)'
/** Para validar con el esquema de la acción antes de tener referencia y hash. */
const PLACEHOLDER_REF = '00000000-0000-4000-8000-000000000000'
const PLACEHOLDER_HASH = '0'.repeat(64)

function voucherFor(kind: DocKind, letter: 'a' | 'b'): VoucherType {
  const list = VOUCHERS[kind]
  return (list.find((v) => v.value.endsWith(`_${letter}`)) ?? list[0])?.value ?? 'factura_b'
}

function displayName(p: Pick<InvoiceCustomer, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

/** El cliente de sistema de la Factura B sin identificar (no está en la lista de clientes). */
function finalConsumerCustomer(id: string): InvoiceCustomer {
  return {
    id,
    name: FINAL_CONSUMER_LABEL,
    tradeName: null,
    taxId: null,
    taxIdType: 'none',
    ivaCondition: 'consumidor_final',
    paymentTermDays: 0,
    active: true,
  }
}

/**
 * Factura, nota de crédito o de débito de venta suelta (E.5.9): lo que no pasa
 * por el cierre del día (eventos facturados aparte, catering, sponsoreo). Con
 * «Ya la cobraste» se guarda junto con el cobro.
 *
 * Con la emisión con ARCA prendida (diseño §3.2.2) pregunta primero «¿Cómo la
 * facturás?»: «La emito ahora con ARCA» pide el CAE y la deja cargada; «Ya la
 * emití en otro sistema» es el formulario de siempre, con el número a mano.
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
  arca,
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
  arca: InvoiceArca
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const base = `/${tenantSlug}/administracion`
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const defaultPoint =
    salesPoints.find((p) => p.defaultChannel === 'events') ?? salesPoints[0] ?? null

  // ── ¿Cómo la facturás? ──
  const arcaOn = arca.setup.state === 'on'
  const prefillVoucher = prefill.relatedDocumentId
    ? (arca.setup.platformVouchers.find((v) => v.documentId === prefill.relatedDocumentId) ?? null)
    : null
  const [how, setHow] = useState<HowMode>(
    arcaOn && (prefill.relatedDocumentId === null || prefillVoucher !== null) ? 'arca' : 'manual',
  )
  const arcaMode = arcaOn && how === 'arca'

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

  // ── Lo de ARCA ──
  const [condicionId, setCondicionId] = useState<number | null>(() => {
    const customer = prefill.partyId ? byId.get(prefill.partyId) : undefined
    return customer ? condicionFromIvaCondition(customer.ivaCondition) : null
  })
  const [concepto, setConcepto] = useState<ArcaConcepto>(arca.setup.defaultConcepto)
  const [serviceFrom, setServiceFrom] = useState<string | null>(null)
  const [serviceTo, setServiceTo] = useState<string | null>(null)
  const [notePaymentDue, setNotePaymentDue] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [relatedVoucherId, setRelatedVoucherId] = useState<string | null>(
    prefillVoucher?.id ?? null,
  )
  const [createdFinalId, setCreatedFinalId] = useState<string | null>(null)
  const [preparingFinal, startFinal] = useTransition()
  const [verifying, startVerify] = useTransition()
  const [postingOpen, setPostingOpen] = useState(false)

  const finalConsumerId = arca.finalConsumerId ?? createdFinalId
  const isFinalConsumer = arcaMode && partyId !== null && partyId === finalConsumerId
  const party: InvoiceCustomer | undefined = partyId
    ? (byId.get(partyId) ?? (isFinalConsumer ? finalConsumerCustomer(partyId) : undefined))
    : undefined
  const isCredit = docKind === 'sales_credit_note'
  const isNote = docKind !== 'sales_invoice'
  const isLetterA = voucherType.endsWith('_a')

  const effectiveCondicion = isFinalConsumer ? 5 : condicionId
  const letterChoice = useMemo(
    () => arcaLetterFor(effectiveCondicion, arca.setup.allowedClasses),
    [effectiveCondicion, arca.setup.allowedClasses],
  )
  const arcaLetter = letterChoice.ok ? letterChoice.letter : null
  const arcaVoucherType = arcaVoucherTypeFor(docKind, arcaLetter ?? 'B')
  const cbteTipo = arcaMode && arcaLetter ? arcaCbteFor(docKind, arcaLetter) : null
  const nextNumber = useArcaNextNumber(tenantSlug, cbteTipo, arcaMode)
  // Lo que había del tipo anterior no vale para este (hasta que llegue el suyo).
  const next: ArcaNextNumberState =
    nextNumber.status === 'ready' && nextNumber.data.cbteTipo !== cbteTipo
      ? { status: 'loading', data: null, error: null }
      : nextNumber
  const arcaNumber = next.status === 'ready' ? next.data.nextNumber : null
  const relatedVoucher =
    arcaMode && isNote && relatedVoucherId
      ? (arca.setup.platformVouchers.find((v) => v.id === relatedVoucherId) ?? null)
      : null

  const emission = useArcaEmission({
    tenantSlug,
    onRefresh: () => router.refresh(),
    onNumberChanged: nextNumber.override,
    onEmitted: (data, message) => {
      toast.success(message)
      const note = data.observations[0]
      if (note) toast.info(`ARCA dejó un aviso: ${note}`)
      router.push(
        data.documentId ? `${base}/comprobantes/${data.documentId}` : `${base}/ventas?tab=facturas`,
      )
    },
  })

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
      voucherType: arcaMode ? arcaVoucherType : voucherType,
      pointOfSale: arcaMode ? arca.setup.pointOfSale : pointOfSale,
      number: arcaMode ? arcaNumber : parsedNumber,
      issueDate: issueDate ?? '',
      dueDate: isCredit ? null : dueDate,
      channel,
      aliquots,
      nonTaxedCents: mode === 'detail' ? (nonTaxed ?? 0) : 0,
      exemptCents: mode === 'detail' ? (exempt ?? 0) : 0,
      relatedDocumentId:
        isCredit || docKind === 'sales_debit_note'
          ? arcaMode
            ? (relatedVoucher?.documentId ?? null)
            : relatedId
          : null,
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
    arcaMode,
    arcaVoucherType,
    voucherType,
    arca.setup.pointOfSale,
    pointOfSale,
    arcaNumber,
    number,
    issueDate,
    isCredit,
    dueDate,
    channel,
    aliquots,
    mode,
    nonTaxed,
    exempt,
    relatedVoucher,
    relatedId,
    collectNow,
    collectTreasury,
    collectAmount,
    notes,
  ])
  // Mientras ARCA no dio el número, el asiento se ve igual (el número no cambia los importes).
  const previewValues = useMemo(
    () => (arcaMode && values.number === null ? { ...values, number: 1 } : values),
    [arcaMode, values],
  )
  const preview = useDocumentPreview('sales_invoice', previewValues, ctx, firstOpenDate)

  const arcaBlock = useMemo(
    () => ({
      predictedNumber: arcaNumber,
      condicionIvaReceptorId: effectiveCondicion,
      concepto,
      serviceFrom: concepto === 1 ? null : serviceFrom,
      serviceTo: concepto === 1 ? null : serviceTo,
      paymentDue: concepto !== 1 && isCredit ? notePaymentDue : null,
      detail: detail.trim(),
      relatedVoucherId: isNote ? relatedVoucherId : null,
    }),
    [
      arcaNumber,
      effectiveCondicion,
      concepto,
      serviceFrom,
      serviceTo,
      isCredit,
      notePaymentDue,
      detail,
      isNote,
      relatedVoucherId,
    ],
  )

  const dateWindow = arcaDateWindow({
    today,
    concepto,
    lastIssueDate: next.status === 'ready' ? next.data.lastIssueDate : null,
    firstOpenDate: minDate,
  })

  // Lo que ARCA pide del cliente (CUIT para la A, tope de la B sin identificar).
  const receiverIssue = useMemo(
    () =>
      arcaMode && party && arcaLetter
        ? arcaReceiverIssue({
            letter: arcaLetter,
            receiver: { taxIdType: party.taxIdType, taxId: party.taxId },
            totalCents: computedTotal,
          })
        : null,
    [arcaMode, party, arcaLetter, computedTotal],
  )

  // Lo que pide ARCA, con los mismos textos que la acción (se ve al intentar emitir).
  const arcaIssues = useMemo((): Record<string, string> => {
    if (!arcaMode) return {}
    const out: Record<string, string> = {}
    const parsed = arcaEmitSchema.safeParse({
      ...values,
      number: values.number ?? 1,
      arca: { ...arcaBlock, predictedNumber: values.number ?? 1 },
      clientRef: PLACEHOLDER_REF,
      previewHash: PLACEHOLDER_HASH,
      warningsAck: [],
    })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issuePath(issue.path)
        if (!(key in out)) out[key] = issue.message
      }
    }
    if (!letterChoice.ok) {
      out['arca.condicionIvaReceptorId'] =
        letterChoice.reason === 'condition_missing'
          ? 'Elegí la condición frente al IVA del cliente.'
          : 'A este cliente le corresponde Factura A y todavía no está habilitada: mirá el aviso.'
    }
    if (receiverIssue && !out.partyId) out.partyId = receiverIssue.message
    if (next.status !== 'ready') {
      out.number =
        next.status === 'error'
          ? 'No pudimos consultar el número en ARCA: tocá «Reintentar».'
          : 'Esperá el número de ARCA.'
    }
    if (issueDate && (issueDate < dateWindow.min || issueDate > dateWindow.max)) {
      out.issueDate =
        dateWindow.min === dateWindow.max
          ? 'Con ARCA, esta factura va con la fecha de hoy.'
          : `Con ARCA, la fecha tiene que estar entre el ${formatIsoDay(dateWindow.min)} y hoy.`
    }
    return out
  }, [
    arcaMode,
    values,
    arcaBlock,
    letterChoice,
    receiverIssue,
    next.status,
    issueDate,
    dateWindow.min,
    dateWindow.max,
  ])

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
  const arcaLocal = attempted ? arcaIssues : {}
  const errorOf = (key: string): string | null =>
    (arcaMode ? emission.fieldErrors[key] : undefined) ??
    posting.fieldErrors[key] ??
    localErrors[key] ??
    arcaLocal[key] ??
    null
  const amountsError =
    errorOf('aliquots') ??
    Object.entries({ ...localErrors, ...posting.fieldErrors }).find(([k]) =>
      k.startsWith('aliquots.'),
    )?.[1] ??
    null

  const shown =
    (arcaMode ? emission.overrideFor(preview.key) : posting.overrideFor(preview.key)) ??
    (preview.state.ok ? preview.state.preview : [])

  function clearError(key: string) {
    posting.clearFieldError(key)
    emission.clearFieldError(key)
  }

  function chooseHow(nextHow: HowMode) {
    if (emission.lock || emission.pending) return
    setHow(nextHow)
    // El consumidor final sin identificar es solo de la emisión con ARCA.
    if (nextHow === 'manual' && partyId !== null && partyId === finalConsumerId) setPartyId(null)
    emission.setBanner(null)
    posting.setBanner(null)
  }

  function chooseKind(nextKind: DocKind) {
    setDocKind(nextKind)
    setVoucherType(voucherFor(nextKind, isLetterA ? 'a' : 'b'))
    if (nextKind === 'sales_credit_note') setCollectNow(false)
    if (nextKind === 'sales_invoice') setRelatedVoucherId(null)
    clearError('voucherType')
  }

  function chooseParty(nextId: string | null) {
    if (arcaMode && nextId === FINAL_CONSUMER_PICK) {
      pickFinalConsumer()
      return
    }
    setPartyId(nextId)
    setRelatedId(null)
    setRelatedVoucherId(null)
    clearError('partyId')
    const customer = nextId ? byId.get(nextId) : undefined
    if (customer) {
      setVoucherType(voucherFor(docKind, letterFor(customer.ivaCondition)))
      setCondicionId(condicionFromIvaCondition(customer.ivaCondition))
    } else if (nextId !== null && nextId === finalConsumerId) {
      setCondicionId(5)
    }
  }

  // «Consumidor final (sin identificar)»: el cliente de sistema se crea la primera vez.
  function pickFinalConsumer() {
    if (finalConsumerId) {
      chooseParty(finalConsumerId)
      return
    }
    startFinal(async () => {
      try {
        const res = await ensureArcaFinalConsumer(tenantSlug)
        if (!res.ok) {
          toast.error(res.message)
          return
        }
        setCreatedFinalId(res.data.partyId)
        setPartyId(res.data.partyId)
        setCondicionId(5)
        setRelatedVoucherId(null)
        clearError('partyId')
        // El cliente nuevo tiene que estar en el contexto de la vista previa.
        router.refresh()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })
  }

  function chooseConcepto(nextConcepto: ArcaConcepto) {
    setConcepto(nextConcepto)
    // Con servicios ARCA pide cuándo vence el pago: arranca con el plazo del cliente.
    if (nextConcepto !== 1 && !isCredit && dueDate === null && engineDue) setDueDate(engineDue)
    if (nextConcepto !== 1 && serviceFrom === null && issueDate) setServiceFrom(issueDate)
    if (nextConcepto !== 1 && serviceTo === null && issueDate) setServiceTo(issueDate)
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
    if (arcaMode) {
      submitArca()
      return
    }
    if (!preview.state.ok) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  function submitArca() {
    if (emission.lock || emission.pending) return
    if (!preview.state.ok || Object.keys(arcaIssues).length > 0) {
      emission.setBanner({
        tone: 'error',
        state: { ok: false, code: 'invalid', message: 'Revisá lo marcado en rojo.' },
      })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    // Con el número listo, la vista previa es exactamente la de estos valores.
    emission.request(
      { ...values, arca: arcaBlock } as unknown as Omit<
        ArcaEmitValues,
        'clientRef' | 'previewHash' | 'warningsAck'
      >,
      { key: preview.key, hash: preview.state.hash, warnings: preview.state.warnings },
    )
  }

  function verifyLocked(voucherId: string) {
    startVerify(async () => {
      try {
        const res = await reconcileArcaVoucher(tenantSlug, { voucherId })
        if (!res.ok) {
          toast.error(res.message)
          return
        }
        switch (res.data.status) {
          case 'posted':
            toast.success(res.message)
            router.push(
              res.data.documentId
                ? `${base}/comprobantes/${res.data.documentId}`
                : `${base}/ventas?tab=facturas`,
            )
            return
          case 'authorized':
            emission.setLock({
              kind: 'not_posted',
              voucherId,
              label: res.data.label,
              cae: res.data.cae,
              message: res.message,
            })
            return
          case 'failed':
            emission.setLock(null)
            emission.setBanner({
              tone: 'info',
              state: { ok: false, code: 'error', message: res.message },
            })
            return
          default:
            toast.info(res.message)
        }
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })
  }

  const customerOptions = useMemo((): PartyOption[] => {
    const list: PartyOption[] = customers.map((c) => ({
      id: c.id,
      name: c.name,
      tradeName: c.tradeName,
      taxId: c.taxId,
      active: c.active,
    }))
    if (!arcaMode) return list
    return [
      {
        id: finalConsumerId ?? FINAL_CONSUMER_PICK,
        name: FINAL_CONSUMER_LABEL,
        description: 'Factura B sin los datos de quien compra',
        active: true,
      },
      ...list,
    ]
  }, [customers, arcaMode, finalConsumerId])
  const relatedOptions = useMemo(
    () =>
      arcaMode && isNote && partyId
        ? arca.setup.platformVouchers.filter(
            (v) =>
              v.partyId === partyId &&
              (arcaLetter === null || v.cbteTipo <= 3 === (arcaLetter === 'A')),
          )
        : [],
    [arcaMode, isNote, partyId, arca.setup.platformVouchers, arcaLetter],
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
  const arcaVoucherText = arcaLetter ? voucherLabel(arcaVoucherType) : null
  const arcaSubmitLabel = emission.pending
    ? 'Emitiendo…'
    : `Emitir ${arcaVoucherText ?? noun}${computedTotal > 0 ? ` · ${moneyLabel(computedTotal)}` : ''}`
  const emitSummary: EmitSummary | null =
    arcaMode && arcaVoucherText && arcaNumber !== null && arca.setup.pointOfSale !== null
      ? {
          voucherLabel: arcaVoucherText,
          numberText: formatVoucherNumber(arca.setup.pointOfSale, arcaNumber),
          customer: party ? displayName(party) : '—',
          totalCents: computedTotal,
          issueDate: issueDate ?? today,
        }
      : null
  const lock = emission.lock
  const arcaBanner = emission.banner

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

          {arca.setup.attention.length > 0 ? (
            <ArcaVoucherAttention
              slug={tenantSlug}
              items={arca.setup.attention}
              canWrite
              // Las acciones van de a una: primero el número de ARCA, después la verificación.
              autoVerify={!arcaMode || next.status !== 'loading'}
            />
          ) : null}
          {arca.loadError ? (
            <Callout
              tone="warning"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-8"
                  onClick={() => router.refresh()}
                >
                  Reintentar
                </Button>
              }
            >
              No pudimos ver si la emisión con ARCA está prendida. Mientras tanto, la factura se
              carga como siempre.
            </Callout>
          ) : null}

          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            {arcaOn ? (
              <div className="grid gap-2">
                <GroupLabel id={`${id}-how`}>¿Cómo la facturás?</GroupLabel>
                <ChoiceChips<HowMode>
                  labelledBy={`${id}-how`}
                  value={how}
                  onChange={chooseHow}
                  options={HOW_OPTIONS.map((o) => ({
                    ...o,
                    disabled: lock !== null || emission.pending,
                  }))}
                />
                <p className="text-xs text-muted-foreground text-pretty">
                  {how === 'arca'
                    ? 'La plataforma le pide a ARCA la autorización (el CAE), te deja la factura lista para imprimir y la carga en los libros.'
                    : 'Para una factura que ya hiciste en el sistema que usás hoy: la cargás con su número.'}
                </p>
              </div>
            ) : null}

            <div className="grid gap-2">
              <GroupLabel id={`${id}-kind`}>¿Qué vas a cargar?</GroupLabel>
              <ChoiceChips<DocKind>
                labelledBy={`${id}-kind`}
                value={docKind}
                onChange={chooseKind}
                options={kindOptions}
              />
            </div>

            <Field
              id={`${id}-party`}
              label="Cliente"
              required
              error={errorOf('partyId')}
              hint={
                arcaMode && !party
                  ? 'Si no te pide factura con sus datos, elegí «Consumidor final (sin identificar)».'
                  : undefined
              }
            >
              <PartyCombobox
                id={`${id}-party`}
                value={partyId}
                onValueChange={(nextId) => chooseParty(nextId)}
                parties={customerOptions}
                placeholder="Elegí el cliente"
                onCreate={(name) => setCreating(name)}
                disabled={preparingFinal}
                invalid={Boolean(errorOf('partyId'))}
                aria-describedby={describedBy(`${id}-party`, {
                  hint: arcaMode && !party,
                  error: errorOf('partyId'),
                })}
              />
            </Field>
            {preparingFinal ? (
              <p role="status" className="-mt-3 text-xs text-muted-foreground">
                Preparando «Consumidor final»…
              </p>
            ) : null}
            {arcaMode && receiverIssue && !errorOf('partyId') ? (
              <p role="status" className="-mt-3 text-xs text-warning-text text-pretty">
                {receiverIssue.message}
              </p>
            ) : null}
            {!arcaMode && party && isLetterA && !party.taxId ? (
              <p role="status" className="-mt-3 text-xs text-warning-text">
                {displayName(party)} no tiene CUIT cargado: una {noun} A lo necesita. Completalo en
                Ajustes › Partícipes o elegí la letra B.
              </p>
            ) : null}

            {arcaMode ? (
              <>
                <ArcaConditionField
                  slug={tenantSlug}
                  value={effectiveCondicion}
                  onChange={(nextCond) => {
                    setCondicionId(nextCond)
                    setRelatedVoucherId(null)
                    clearError('arca.condicionIvaReceptorId')
                  }}
                  letterChoice={letterChoice}
                  locked={isFinalConsumer}
                  error={errorOf('arca.condicionIvaReceptorId')}
                />
                <ArcaNumberRow
                  voucherLabel={arcaVoucherText}
                  pointOfSale={arca.setup.pointOfSale}
                  pointOfSaleLabel={arca.pointOfSaleLabel}
                  next={next}
                  onRetry={nextNumber.retry}
                  error={next.status === 'error' ? null : errorOf('number')}
                />
              </>
            ) : (
              <div className="grid gap-5 sm:grid-cols-3">
                <Field
                  id={`${id}-type`}
                  label="Comprobante"
                  required
                  error={errorOf('voucherType')}
                >
                  <Select
                    value={voucherType}
                    onValueChange={(v) => setVoucherType(v as VoucherType)}
                  >
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
            )}

            <div className="grid gap-5 sm:grid-cols-3">
              <DateField
                label="Fecha"
                required
                value={issueDate}
                onValueChange={(nextDate) => {
                  setIssueDate(nextDate)
                  clearError('issueDate')
                }}
                min={arcaMode ? dateWindow.min : minDate}
                max={today}
                today={today}
                hint={arcaMode ? arcaDateHint(dateWindow) : undefined}
                error={errorOf('issueDate')}
              />
              {isCredit ? null : (
                <DateField
                  label={arcaMode && concepto !== 1 ? 'Vence el pago' : 'Vence'}
                  optional={!(arcaMode && concepto !== 1)}
                  required={arcaMode && concepto !== 1}
                  value={dueDate}
                  onValueChange={(nextDate) => {
                    setDueDate(nextDate)
                    clearError('dueDate')
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

            {arcaMode ? (
              <ArcaConceptoField
                value={concepto}
                onChange={chooseConcepto}
                serviceFrom={serviceFrom}
                serviceTo={serviceTo}
                onServiceFrom={(v) => {
                  setServiceFrom(v)
                  clearError('arca.serviceFrom')
                }}
                onServiceTo={(v) => {
                  setServiceTo(v)
                  clearError('arca.serviceTo')
                }}
                today={today}
                fromError={errorOf('arca.serviceFrom')}
                toError={errorOf('arca.serviceTo')}
              >
                {isCredit ? (
                  <DateField
                    label="Vence el pago"
                    required
                    value={notePaymentDue}
                    onValueChange={(v) => {
                      setNotePaymentDue(v)
                      clearError('dueDate')
                    }}
                    min={issueDate ?? undefined}
                    today={today}
                    shortcuts={false}
                    error={errorOf('dueDate')}
                  />
                ) : null}
              </ArcaConceptoField>
            ) : null}

            {arcaMode && isNote ? (
              <ArcaRelatedField
                isCredit={isCredit}
                options={relatedOptions}
                value={relatedVoucherId}
                onChange={(v) => {
                  setRelatedVoucherId(v)
                  clearError('arca.relatedVoucherId')
                }}
                error={errorOf('arca.relatedVoucherId')}
              />
            ) : null}

            {!arcaMode && (isCredit || docKind === 'sales_debit_note') && related.length > 0 ? (
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

            {arcaMode ? (
              <ArcaDetailField
                value={detail}
                onChange={(v) => {
                  setDetail(v)
                  clearError('arca.detail')
                }}
                error={errorOf('arca.detail')}
              />
            ) : null}

            {mode === 'total' ? (
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <MoneyField
                  label="Total (con IVA)"
                  required
                  value={total}
                  onValueChange={(cents) => {
                    setTotal(cents)
                    clearError('aliquots')
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
                            clearError('aliquots')
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
                      onValueChange={(nextTreasury) => setCollectTreasury(nextTreasury)}
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

          {arcaMode && lock ? (
            <ArcaLockNotice
              slug={tenantSlug}
              base={base}
              lock={lock}
              verifying={verifying}
              onVerify={verifyLocked}
              onPost={() => setPostingOpen(true)}
            />
          ) : (
            <>
              {arcaMode ? (
                arcaBanner ? (
                  arcaBanner.tone === 'error' &&
                  arcaBanner.state.code !== 'invalid' &&
                  arcaBanner.state.detail?.key !== 'offline' ? (
                    <ArcaProblem slug={tenantSlug} state={arcaBanner.state} />
                  ) : (
                    <FormBanner
                      banner={{
                        tone: arcaBanner.tone,
                        message: arcaBanner.state.message,
                        action:
                          arcaBanner.state.detail?.key === 'offline'
                            ? { label: ACC_UNREACHABLE.retryLabel, run: emission.retry }
                            : undefined,
                      }}
                    />
                  )
                ) : null
              ) : (
                <FormBanner banner={posting.banner} />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href={`${base}/ventas?tab=facturas`}>Cancelar</Link>
                </Button>
                {arcaMode ? (
                  <Button
                    type="submit"
                    className="h-11 min-w-[200px] md:h-9"
                    disabled={emission.pending || preparingFinal}
                  >
                    {arcaSubmitLabel}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="h-11 min-w-[200px] md:h-9"
                    disabled={posting.pending}
                  >
                    {submitLabel}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-20">
          <EntryPreview entries={shown} />
        </aside>
      </form>

      <WarningsDialog
        warnings={arcaMode ? emission.warnings : posting.warnings}
        pending={arcaMode ? emission.pending : posting.pending}
        onCancel={arcaMode ? emission.dismissWarnings : posting.dismissWarnings}
        onConfirm={() => (arcaMode ? emission.confirmWarnings() : posting.confirmWarnings())}
      />
      {arcaMode ? (
        <EmitConfirmDialog
          open={emission.confirming}
          onOpenChange={emission.setConfirming}
          summary={emitSummary}
          pending={emission.pending}
          onConfirm={emission.emit}
        />
      ) : null}
      {arcaMode && lock?.kind === 'not_posted' ? (
        <PostVoucherDialog
          slug={tenantSlug}
          voucherId={lock.voucherId}
          label={lock.label}
          open={postingOpen}
          onOpenChange={setPostingOpen}
          onPosted={(documentId) => {
            router.push(
              documentId ? `${base}/comprobantes/${documentId}` : `${base}/ventas?tab=facturas`,
            )
          }}
        />
      ) : null}
      <QuickPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        kind="customer"
        initialName={creating ?? ''}
        requireCuit={arcaMode ? arcaLetter === 'A' : isLetterA}
        onCreated={(created) => {
          setPartyId(created.id)
          setVoucherType(voucherFor(docKind, letterFor(created.ivaCondition)))
          setCondicionId(condicionFromIvaCondition(created.ivaCondition))
          setRelatedVoucherId(null)
          clearError('partyId')
          // El cliente nuevo tiene que estar en el contexto de la vista previa.
          router.refresh()
        }}
      />
    </>
  )
}

/**
 * Después de un corte o de una emisión sin asiento: el formulario ya no emite
 * (podría salir dos veces) y ofrece lo que corresponde.
 */
function ArcaLockNotice({
  slug,
  base,
  lock,
  verifying,
  onVerify,
  onPost,
}: {
  slug: string
  base: string
  lock: ArcaLock
  verifying: boolean
  onVerify: (voucherId: string) => void
  onPost: () => void
}) {
  if (lock.kind === 'not_posted') {
    return (
      <Callout
        tone="error"
        title={`${lock.label} está emitida en ARCA, pero falta en los libros`}
        action={
          <>
            <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
              <Link href={arcaPrintHref(slug, lock.voucherId)} target="_blank" rel="noopener">
                <Printer className="size-4" aria-hidden />
                Imprimir
              </Link>
            </Button>
            <Button type="button" size="sm" className="h-11 gap-1.5 md:h-8" onClick={onPost}>
              <BookPlus className="size-4" aria-hidden />
              Cargarla ahora
            </Button>
          </>
        }
      >
        {lock.message} No la vuelvas a emitir: ya existe en ARCA.
      </Callout>
    )
  }
  return (
    <Callout
      tone="warning"
      title="No sabemos si ARCA la emitió"
      action={
        <>
          <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
            <Link href={`${base}/ventas?tab=facturas`}>Ver facturas</Link>
          </Button>
          {lock.voucherId ? (
            <Button
              type="button"
              size="sm"
              className="h-11 gap-1.5 md:h-8"
              disabled={verifying}
              onClick={() => lock.voucherId && onVerify(lock.voucherId)}
            >
              <RefreshCw
                className={verifying ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
                aria-hidden
              />
              {verifying ? 'Verificando…' : 'Verificar con ARCA'}
            </Button>
          ) : null}
        </>
      }
    >
      {lock.message}
    </Callout>
  )
}
