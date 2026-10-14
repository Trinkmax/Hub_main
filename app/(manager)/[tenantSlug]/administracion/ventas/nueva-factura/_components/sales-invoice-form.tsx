'use client'

import { BookPlus, FileText, Plus, Printer, RefreshCw, X } from 'lucide-react'
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
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  TEXT_LINK,
} from '@/components/administracion/acciones/sheet-parts'
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
import { ChoiceCard, StepCard, type StepState } from '@/components/administracion/kit'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { addDays, capitalizeFirst, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatVoucherNumber, parseVoucherNumber } from '@/lib/fiscal'
import { type GateAnswer, InvoiceGate } from './invoice-gate'
import { InvoicePaper, type InvoicePaperStatus, paperAmounts } from './invoice-paper'

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
 * «Factura aparte»: la factura, nota de crédito o de débito de venta que no
 * pasa por el cierre del día (un evento facturado aparte, un catering, un
 * sponsoreo) (E.5.9). Es una carga rara y con muchas decisiones: va paso a
 * paso, con el papel de la factura llenándose solo al costado.
 *
 * Antes de empezar pregunta si la venta ya está en un cierre (para no cargarla
 * dos veces). Con «Sí, ya me pagó» se guarda junto con el cobro.
 *
 * Con la emisión con ARCA prendida (diseño §3.2.2) el primer paso pregunta
 * además cómo se hace: «La emito ahora con ARCA» pide el CAE y la deja cargada;
 * «Ya la hice en otro sistema» la carga con su número, a mano.
 *
 * Lo que se manda no cambió: el mismo estado, los mismos `values` y las mismas
 * dos salidas (`postSalesInvoice` o la emisión con ARCA). Solo cambió cómo se
 * pregunta cada cosa.
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
  askGate = false,
}: {
  /** Preguntar primero si la venta ya está en un cierre (se entró sin nada elegido). */
  askGate?: boolean
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
  // Solo de pantalla (no viajan): el paso 0, lo que está desplegado y la hoja del papel.
  const [gate, setGate] = useState<GateAnswer | null>(askGate ? null : 'apart')
  const [otherRate, setOtherRate] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [paperOpen, setPaperOpen] = useState(false)

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

  // ── Solo presentación: qué paso toca, las palabras de cada opción y el papel del costado ──
  const kindDone = true
  const partyDone = Boolean(partyId)
  const voucherDone =
    Boolean(issueDate) &&
    (arcaMode ? next.status === 'ready' : pointOfSale !== null && number.trim() !== '')
  const amountDone = computedTotal > 0
  const stepStates = [kindDone, partyDone, voucherDone, amountDone]
  const firstPending = stepStates.indexOf(false)
  const stepState = (index: number): StepState =>
    stepStates[index] ? 'done' : index === firstPending ? 'current' : 'todo'
  // «¿Ya te la pagaron?» se tilda como los demás, apenas tiene su respuesta (y la caja, si ya te
  // pagó): no espera a que se completen los pasos de arriba.
  const paidDone = !collectNow || collectTreasury !== null
  const paidState: StepState = paidDone ? 'done' : firstPending === -1 ? 'current' : 'todo'

  const kindWords: Readonly<Record<DocKind, { title: string; consequence: string }>> = {
    sales_invoice: { title: 'Una factura', consequence: 'Le cobrás algo a un cliente.' },
    sales_credit_note: {
      title: 'Una nota de crédito',
      consequence: 'Anula o baja una factura que ya hiciste.',
    },
    sales_debit_note: {
      title: 'Una nota de débito',
      consequence: 'Le suma algo a una factura.',
    },
  }
  // Sin cliente todavía no se sabe qué letra lleva: el recuadro va vacío (no una «B» de borrador).
  const paperLetter: 'A' | 'B' | null = !party
    ? null
    : arcaMode
      ? arcaLetter
      : isLetterA
        ? 'A'
        : 'B'
  const paperNumber = arcaMode
    ? arca.setup.pointOfSale !== null && arcaNumber !== null
      ? formatVoucherNumber(arca.setup.pointOfSale, arcaNumber)
      : null
    : pointOfSale !== null && number.trim() !== ''
      ? formatVoucherNumber(pointOfSale, Number(number))
      : null
  const dueShown = dueDate ?? engineDue
  const relatedLabel = arcaMode
    ? (relatedVoucher?.label ?? null)
    : (related.find((r) => r.documentId === relatedId)?.label ?? null)
  const paperStatus: InvoicePaperStatus | null = !party
    ? null
    : isCredit
      ? relatedLabel
        ? { tone: 'muted', text: `Corrige la ${relatedLabel}` }
        : null
      : collectNow
        ? { tone: 'ok', text: 'Cobrada' }
        : {
            tone: 'warn',
            text: dueShown ? `A cobrar · vence ${formatDayMonth(dueShown)}` : 'A cobrar',
          }
  const amounts = paperAmounts({
    aliquots,
    nonTaxedCents: mode === 'detail' ? (nonTaxed ?? 0) : 0,
    exemptCents: mode === 'detail' ? (exempt ?? 0) : 0,
    totalCents: computedTotal,
  })
  const paper = (
    <InvoicePaper
      title={capitalizeFirst(noun)}
      letter={paperLetter}
      numberText={paperNumber}
      numberHint={arcaMode ? 'el número lo da ARCA' : null}
      issueDate={issueDate}
      customerName={party ? displayName(party) : null}
      customerTaxId={party?.taxId ?? null}
      detail={arcaMode ? detail : notes}
      channelLabel={CHANNEL_LABELS[channel] ?? channel}
      netCents={amounts.netCents}
      vatCents={amounts.vatCents}
      otherCents={amounts.otherCents}
      totalCents={computedTotal}
      status={paperStatus}
    />
  )
  const quickRates: readonly VatRateBp[] = [2100, 1050]
  const rateChip = otherRate || !quickRates.includes(rate) ? 'otra' : String(rate)
  const showNote = noteOpen || notes !== '' || Boolean(errorOf('notes'))
  const typeError = errorOf('voucherType')
  const posError = errorOf('pointOfSale')

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={handleFormKeyDown}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
      >
        <div className="@container min-w-0 space-y-4">
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

          {askGate ? (
            <InvoiceGate value={gate} onChange={setGate} closeHref={`${base}/ventas/cierre`} />
          ) : null}

          {gate === 'apart' ? (
            <>
              {/* ① ¿Qué vas a hacer? */}
              <StepCard
                open
                n={1}
                state={stepState(0)}
                title={<span id={`${id}-kind`}>¿Qué vas a hacer?</span>}
                summary="Una factura nueva, o una nota que corrige una que ya hiciste."
              >
                <div
                  role="radiogroup"
                  aria-labelledby={`${id}-kind`}
                  className="grid gap-2 @[40rem]:grid-cols-3"
                >
                  {kindOptions.map((option) => (
                    <ChoiceCard
                      key={option.value}
                      name={`${id}-kind-choice`}
                      value={option.value}
                      checked={docKind === option.value}
                      onChange={() => chooseKind(option.value)}
                      title={kindWords[option.value].title}
                      consequence={kindWords[option.value].consequence}
                    />
                  ))}
                </div>
                {arcaOn ? (
                  <div className="mt-5 grid gap-2">
                    <GroupLabel id={`${id}-how`}>¿Cómo la hacés?</GroupLabel>
                    <div
                      role="radiogroup"
                      aria-labelledby={`${id}-how`}
                      className="grid gap-2 @[40rem]:grid-cols-2"
                    >
                      <ChoiceCard
                        name={`${id}-how-choice`}
                        value="arca"
                        checked={how === 'arca'}
                        disabled={lock !== null || emission.pending}
                        onChange={() => chooseHow('arca')}
                        title="La emito ahora con ARCA"
                        consequence="Queda lista para imprimir y cargada en los libros."
                      />
                      <ChoiceCard
                        name={`${id}-how-choice`}
                        value="manual"
                        checked={how === 'manual'}
                        disabled={lock !== null || emission.pending}
                        onChange={() => chooseHow('manual')}
                        title="Ya la hice en otro sistema"
                        consequence="La cargo con su número."
                      />
                    </div>
                  </div>
                ) : null}
              </StepCard>

              {/* ② ¿A quién? */}
              <StepCard
                open
                n={2}
                state={stepState(1)}
                title="¿A quién?"
                summary={
                  party
                    ? `${displayName(party)}${party.taxId ? '' : ' · sin CUIT cargado'}`
                    : 'El cliente al que le facturás.'
                }
              >
                <div className="grid gap-4">
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
                    <p role="status" className="-mt-2 text-xs text-muted-foreground">
                      Preparando «Consumidor final»…
                    </p>
                  ) : null}
                  {arcaMode && receiverIssue && !errorOf('partyId') ? (
                    <p role="status" className="-mt-2 text-xs text-warning-text text-pretty">
                      {receiverIssue.message}
                    </p>
                  ) : null}
                  {!arcaMode && party && isLetterA && !party.taxId ? (
                    <p role="status" className="-mt-2 text-xs text-warning-text">
                      {displayName(party)} no tiene CUIT cargado: una {noun} A lo necesita.
                      Completalo en Ajustes › Medios de cobro o elegí la letra B.
                    </p>
                  ) : null}
                  {!arcaMode && party ? (
                    <p className="-mt-1 text-sm text-pretty">
                      Le corresponde{' '}
                      <span className="font-medium">
                        {capitalizeFirst(noun)} {letterFor(party.ivaCondition).toUpperCase()}
                      </span>
                      .
                    </p>
                  ) : null}

                  {arcaMode ? (
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

                  {!arcaMode &&
                  (isCredit || docKind === 'sales_debit_note') &&
                  related.length > 0 ? (
                    <Field
                      id={`${id}-related`}
                      label={isCredit ? '¿Qué factura corrige?' : '¿Sobre qué factura?'}
                      optional
                      hint={
                        isCredit
                          ? 'Se descuenta sola de lo que te debe por esa factura.'
                          : undefined
                      }
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
                              {moneyLabel(r.openCents)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                </div>
              </StepCard>

              {/* ③ El comprobante */}
              <StepCard
                open
                n={3}
                state={stepState(2)}
                title="El comprobante"
                summary={
                  arcaMode
                    ? 'El número lo pone ARCA: revisá la fecha y qué facturás.'
                    : `Como figura en la ${isNote ? 'nota' : 'factura'} que ya hiciste: tipo, punto de venta, número y fecha.`
                }
              >
                <div className="grid gap-5">
                  {arcaMode ? (
                    <ArcaNumberRow
                      voucherLabel={arcaVoucherText}
                      pointOfSale={arca.setup.pointOfSale}
                      pointOfSaleLabel={arca.pointOfSaleLabel}
                      next={next}
                      onRetry={nextNumber.retry}
                      error={next.status === 'error' ? null : errorOf('number')}
                    />
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <GroupLabel id={`${id}-type`}>Tipo</GroupLabel>
                        <div tabIndex={-1} aria-invalid={typeError ? true : undefined}>
                          <ChoiceChips<VoucherType>
                            labelledBy={`${id}-type`}
                            value={voucherType}
                            onChange={(v) => setVoucherType(v)}
                            options={VOUCHERS[docKind]}
                          />
                        </div>
                        {typeError ? (
                          <p role="alert" className="text-xs text-destructive">
                            {typeError}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-5 @[32rem]:grid-cols-[minmax(0,1fr)_14rem]">
                        {salesPoints.length > 0 && salesPoints.length <= 4 ? (
                          <div className="grid content-start gap-2">
                            <GroupLabel id={`${id}-pos`}>Punto de venta</GroupLabel>
                            <div tabIndex={-1} aria-invalid={posError ? true : undefined}>
                              <ChoiceChips<string>
                                labelledBy={`${id}-pos`}
                                value={pointOfSale === null ? null : String(pointOfSale)}
                                onChange={(v) => {
                                  setPointOfSale(Number(v))
                                  posting.clearFieldError('pointOfSale')
                                }}
                                options={salesPoints.map((p) => ({
                                  value: String(p.number),
                                  label: `${String(p.number).padStart(4, '0')} · ${p.label}`,
                                }))}
                              />
                            </div>
                            {posError ? (
                              <p role="alert" className="text-xs text-destructive">
                                {posError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <Field
                            id={`${id}-pos`}
                            label="Punto de venta"
                            required
                            error={posError}
                            hint={
                              salesPoints.length === 0
                                ? 'Cargá tus puntos de venta en Ajustes para elegir uno.'
                                : undefined
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
                                aria-invalid={posError ? true : undefined}
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
                        )}
                        <Field
                          id={`${id}-number`}
                          label="Número"
                          required
                          error={errorOf('number')}
                          hint="Podés pegarlo entero: 0003-00000088."
                        >
                          <Input
                            id={`${id}-number`}
                            value={number}
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={13}
                            placeholder="00000088"
                            className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                            aria-invalid={errorOf('number') ? true : undefined}
                            aria-describedby={describedBy(`${id}-number`, {
                              hint: true,
                              error: errorOf('number'),
                            })}
                            onPaste={onNumberPaste}
                            onChange={(e) => {
                              setNumber(e.target.value.replace(/\D/g, '').slice(0, 8))
                              posting.clearFieldError('number')
                            }}
                          />
                        </Field>
                      </div>
                    </>
                  )}

                  <div className="grid gap-5 @[32rem]:grid-cols-2">
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

                  <div className="grid gap-2">
                    <GroupLabel id={`${id}-channel`}>¿Por dónde se vendió?</GroupLabel>
                    <ChoiceChips<Channel>
                      labelledBy={`${id}-channel`}
                      value={channel}
                      onChange={(v) => setChannel(v)}
                      options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] ?? c }))}
                    />
                    {errorOf('channel') ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errorOf('channel')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </StepCard>

              {/* ④ ¿Cuánto? */}
              <StepCard
                open
                n={4}
                state={stepState(3)}
                title="¿Cuánto?"
                summary={
                  mode === 'total'
                    ? `El total de la ${isNote ? 'nota' : 'factura'}, con el IVA adentro. Si tiene más de una alícuota, o algo no gravado o exento, cargala por alícuota.`
                    : 'Cada alícuota por separado, y lo que no lleva IVA.'
                }
                action={
                  // Corto a propósito: comparte renglón con el título y en el celular no entra más.
                  <button
                    type="button"
                    className={`${TEXT_LINK} -my-2.5 whitespace-nowrap text-xs`}
                    onClick={() => setMode(mode === 'total' ? 'detail' : 'total')}
                  >
                    {mode === 'total' ? 'Por alícuota' : 'Solo el total'}
                  </button>
                }
              >
                {mode === 'total' ? (
                  <div className="grid gap-4">
                    <MoneyField
                      label="Total (con IVA)"
                      required
                      className={BIG_MONEY_FIELD}
                      value={total}
                      onValueChange={(cents) => {
                        setTotal(cents)
                        clearError('aliquots')
                      }}
                      error={amountsError}
                      hint={
                        aliquots[0] && total !== null && rate !== 0
                          ? `Neto ${moneyLabel(aliquots[0].netCents ?? 0)} · IVA ${vatRateLabel(rate)} ${moneyLabel(total - (aliquots[0].netCents ?? 0))}`
                          : undefined
                      }
                    />
                    <div className="grid gap-2">
                      <GroupLabel id={`${id}-rate`}>¿Con qué IVA?</GroupLabel>
                      <ChoiceChips<string>
                        labelledBy={`${id}-rate`}
                        value={rateChip}
                        onChange={(v) => {
                          if (v === 'otra') {
                            setOtherRate(true)
                            return
                          }
                          setOtherRate(false)
                          setRate(Number(v) as VatRateBp)
                        }}
                        options={[
                          ...quickRates.map((r) => ({ value: String(r), label: vatRateLabel(r) })),
                          { value: 'otra', label: 'Otra' },
                        ]}
                      />
                      {rateChip === 'otra' ? (
                        <Select
                          value={String(rate)}
                          onValueChange={(v) => setRate(Number(v) as VatRateBp)}
                        >
                          <SelectTrigger
                            aria-label="Alícuota de IVA"
                            className="w-full data-[size=default]:h-11 sm:w-48 md:data-[size=default]:h-10"
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
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {rows.map((row, index) => {
                      const vat =
                        row.net !== null && row.rate !== 0 ? vatFromNet(row.net, row.rate) : 0
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
                                <SelectItem
                                  key={r}
                                  value={String(r)}
                                  className="min-h-11 md:min-h-8"
                                >
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
                                IVA {vatRateLabel(row.rate)}: {moneyLabel(vat)}
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
                    <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-4">
                      <span className="text-sm text-muted-foreground">Total del comprobante</span>
                      <span className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                        {moneyLabel(computedTotal)}
                      </span>
                    </div>
                  </div>
                )}
              </StepCard>

              {/* ⑤ ¿Ya te la pagaron? */}
              {isCredit ? null : (
                <StepCard
                  open
                  n={5}
                  state={paidState}
                  title={<span id={`${id}-collect`}>¿Ya te la pagaron?</span>}
                  summary="Si todavía no, queda como plata por cobrar hasta que te paguen."
                >
                  <div
                    role="radiogroup"
                    aria-labelledby={`${id}-collect`}
                    className="grid gap-2 @[40rem]:grid-cols-2"
                  >
                    <ChoiceCard
                      name={`${id}-collect-choice`}
                      value="no"
                      checked={!collectNow}
                      onChange={() => setCollectNow(false)}
                      title="Todavía no"
                      consequence={
                        dueShown
                          ? `Queda como plata por cobrar; vence el ${formatDayMonth(dueShown)}.`
                          : 'Queda como plata por cobrar.'
                      }
                    />
                    <ChoiceCard
                      name={`${id}-collect-choice`}
                      value="si"
                      checked={collectNow}
                      onChange={() => setCollectNow(true)}
                      title="Sí, ya me pagó"
                      consequence="Se guarda junto con el cobro y queda saldada."
                    />
                  </div>
                  {collectNow ? (
                    <div className="mt-4 grid gap-5">
                      <div className="grid gap-2">
                        <GroupLabel id={`${id}-ctreasury`}>¿A dónde entró?</GroupLabel>
                        <TreasuryPicker
                          id={`${id}-ctreasury-pick`}
                          value={collectTreasury}
                          onValueChange={(nextTreasury) => setCollectTreasury(nextTreasury)}
                          treasuries={treasuries}
                          excludeCards
                          invalid={Boolean(errorOf('collectNow.treasuryAccountId'))}
                          aria-labelledby={`${id}-ctreasury`}
                        />
                        {errorOf('collectNow.treasuryAccountId') ? (
                          <p role="alert" className="text-xs text-destructive">
                            {errorOf('collectNow.treasuryAccountId')}
                          </p>
                        ) : null}
                      </div>
                      <MoneyField
                        label="¿Cuánto?"
                        optional
                        fieldClassName="sm:max-w-xs"
                        value={collectAmount}
                        onValueChange={setCollectAmount}
                        hint={
                          collectAmount === null && computedTotal > 0
                            ? `Vacío: el total (${moneyLabel(computedTotal)}).`
                            : undefined
                        }
                        error={errorOf('collectNow.amountCents')}
                      />
                    </div>
                  ) : null}
                </StepCard>
              )}

              {showNote ? (
                <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
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
              ) : (
                <div>
                  <button type="button" className={ADD_LINK} onClick={() => setNoteOpen(true)}>
                    <Plus className="size-3.5" aria-hidden />
                    Agregar una nota
                  </button>
                </div>
              )}

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
                  {/* Un solo botón: se vuelve con «‹ Facturas», arriba. */}
                  <div className="flex pt-1 sm:justify-end">
                    {arcaMode ? (
                      <Button
                        type="submit"
                        className="h-12 w-full text-base font-semibold sm:w-auto sm:min-w-[260px]"
                        disabled={emission.pending || preparingFinal}
                      >
                        {arcaSubmitLabel}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        className="h-12 w-full text-base font-semibold sm:w-auto sm:min-w-[260px]"
                        disabled={posting.pending}
                      >
                        {submitLabel}
                      </Button>
                    )}
                  </div>
                </>
              )}

              {/* Sin lugar para el papel al costado (celular, tablet): el total siempre a la
                  vista y la factura a un toque. Va pegada abajo DENTRO de la página. */}
              <div className="sticky bottom-0 z-30 -mx-4 -mb-4 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md sm:-mx-6 sm:-mb-8 sm:px-6 lg:hidden">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Total
                    </p>
                    <p className="mt-0.5 font-serif text-2xl font-semibold leading-none tracking-tight whitespace-nowrap tabular-nums">
                      {computedTotal > 0 ? (
                        moneyLabel(computedTotal)
                      ) : (
                        <span className="text-muted-foreground">
                          <span aria-hidden>—</span>
                          <span className="sr-only">Todavía sin importe</span>
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 gap-2 rounded-full px-4"
                    onClick={() => setPaperOpen(true)}
                  >
                    <FileText className="size-4" aria-hidden />
                    Ver la factura
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block">
          {gate === 'in_close' ? (
            // Ya está en un cierre: no hace falta esta factura. El papel queda apagado, de fondo.
            <>
              <p className="text-sm font-medium text-pretty">No hace falta esta factura</p>
              <div aria-hidden className="pointer-events-none opacity-35 grayscale">
                {paper}
              </div>
            </>
          ) : (
            <>
              {paper}
              <EntryPreview entries={shown} label="Ver cómo queda en los libros" />
            </>
          )}
        </aside>
      </form>

      <Sheet open={paperOpen} onOpenChange={setPaperOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] outline-none"
          // El foco va a la hoja (no a la X): es para leer.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <SheetGrabber />
          <SheetHeader className="sr-only">
            <SheetTitle>Así va quedando la {noun}</SheetTitle>
            <SheetDescription>
              Lo que cargaste hasta ahora. Se guarda con el botón del final.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm space-y-4">
            {paper}
            <EntryPreview entries={shown} label="Ver cómo queda en los libros" />
            <p className="text-center text-xs text-muted-foreground">
              Esto todavía no está guardado: se guarda con el botón del final.
            </p>
          </div>
        </SheetContent>
      </Sheet>

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
