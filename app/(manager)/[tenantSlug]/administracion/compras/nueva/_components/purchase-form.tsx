'use client'

import { Plus, Repeat, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { AttachmentPicker } from '@/components/administracion/adjuntos/attachment-picker'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { MoneyField } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { postPurchase, postPurchaseCreditNote } from '@/lib/accounting/actions/documents'
import { pickTreasury, suggestDueDate } from '@/lib/accounting/defaults'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { IvaCondition, VatRateBp, VoucherType } from '@/lib/accounting/types'
import {
  isVoucherType,
  VOUCHER_CATALOG,
  voucherConditionCheck,
} from '@/lib/accounting/voucher-types'
import { ivaOptionsWith } from '@/lib/arca/lookup-fill'
import { formatIsoDay, formatMonthYear } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  FormBanner,
  InlineNotice,
  RadioChips,
  WarningsDialog,
} from '../../_components/form-feedback'
import {
  RememberAccountCheckbox,
  rememberSupplierAccount,
  SupplierAccountLine,
} from '../../_components/supplier-account'
import { type SavedState, useDocumentPosting } from '../../_components/use-document-posting'
import {
  padNumber,
  padPos,
  VoucherNumberInput,
  type VoucherNumberValue,
  voucherPart,
} from '../../_components/voucher-number-input'
import { isPurchaseImputation } from '../../_lib/accounts'
import { IIBB_JURISDICTIONS } from '../../_lib/jurisdictions'
import { documentHref } from '../../_lib/links'
import {
  buildPurchaseValues,
  DETAIL_RATES,
  detailTotals,
  detailVat,
  discriminatesVat,
  MAIN_DETAIL_RATES,
  type PurchaseFormState,
  type PurchaseFormValues,
  type PurchaseParty,
  purchaseTotal,
} from '../../_lib/purchase'
import {
  detailRoom,
  REMITO_MAX,
  splitTotal,
  VAT_ADJUST_LIMIT,
  withRemito,
} from '../../_lib/quick-expense'
import { findDuplicate, loadPartyDefaults, loadPartyItems } from '../../_lib/sheet-actions'
import type {
  SheetData,
  SheetDuplicate,
  SheetParty,
  SheetPartyDefaults,
} from '../../_lib/sheet-types'
import { accountAsk, accountToRemember, supplierDefaultAccount } from '../../_lib/supplier-account'
import {
  asksIfInvoiced,
  defaultVoucherFor,
  docKindOf,
  notInvoicedDefault,
  type PurchaseFamily,
  rememberedVoucherType,
  splitByInvoice,
  voucherOptionsFor,
} from '../../_lib/vouchers'

/** El tope de las notas (`purchaseSchema.notes`). */
const NOTES_MAX = 1000

/** Un gasto fijo que se puede marcar como cargado con esta factura. */
export type RecurringOption = {
  id: string
  name: string
  partyId: string | null
  accountId: string
  voucherType: string | null
  vatRateBp: number | null
  amountCents: number | null
  nextDueDate: string
  pending: boolean
}

/** Lo que trae la factura relacionada de una NC (`?relacionada=`). */
export type RelatedOption = { documentId: string; label: string }

const PURCHASE_PARTY_KINDS = new Set(['supplier', 'other', 'tax_agency'])
const QUICK_RATES = [2100, 1050, 2700, 500, 250, 0] as const satisfies readonly VatRateBp[]

const NEW_PARTY_CONDITIONS: ReadonlyArray<{ value: IvaCondition; label: string }> = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
]

const CONDITION_LABELS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos de IVA',
}

/** Los campos de pantalla que muestran su error en su lugar. */
const UI_FIELDS = new Set([
  'party',
  'newPartyName',
  'newPartyTaxId',
  'voucherType',
  'number',
  'issueDate',
  'dueDate',
  'total',
  'vatRate',
  'account',
  'detail',
  'gross',
  'nonTaxed',
  'exempt',
  'internalTax',
  'percIva',
  'percIibb',
  'percIibbJurisdiction',
  'percGanancias',
  'otherTaxes',
  'controlTotal',
  'related',
  'payTreasury',
  'payAmount',
  'payDate',
  'payReference',
  'notes',
  ...DETAIL_RATES.map((r) => `net-${r}`),
])

function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/**
 * Factura, nota de crédito o nota de débito de un proveedor (H.6): proveedor,
 * tipo, número con pegado, fechas, importes por total o por alícuota con
 * percepciones, la imputación, el pago en el mismo envío y el asiento en vivo.
 */
export function PurchaseForm({
  tenantSlug,
  data,
  otherTaxesAccountId,
  family: initialFamily,
  initialPartyId,
  related,
  recurring,
  initialRecurringId,
  returnHref,
}: {
  tenantSlug: string
  data: SheetData
  otherTaxesAccountId: string | null
  family: PurchaseFamily
  initialPartyId: string | null
  /** NC: la factura que corrige, si vino en la URL. */
  related: RelatedOption | null
  /** Gastos fijos activos (para «Es el Alquiler de octubre»). */
  recurring: readonly RecurringOption[]
  initialRecurringId: string | null
  returnHref: string
}) {
  const router = useRouter()
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const today = data.today

  const partyById = useMemo(() => new Map(data.parties.map((p) => [p.id, p])), [data.parties])
  const imputable = useMemo(
    () => new Set(data.accounts.filter(isPurchaseImputation).map((a) => a.id)),
    [data.accounts],
  )
  const accountOptions = useMemo(
    () =>
      data.accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        postable: a.postable && imputable.has(a.id),
        active: a.active,
        description: a.description,
      })),
    [data.accounts, imputable],
  )
  const partyOptions: PartyOption[] = useMemo(
    () =>
      data.parties
        .filter((p) => PURCHASE_PARTY_KINDS.has(p.kind))
        .map((p) => ({
          id: p.id,
          name: p.name,
          tradeName: p.tradeName,
          taxId: p.taxId,
          active: p.active,
          description: [
            p.taxId ? `CUIT ${formatCuit(p.taxId)}` : null,
            CONDITION_LABELS[p.ivaCondition],
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    [data.parties],
  )
  const recurringById = useMemo(() => new Map(recurring.map((r) => [r.id, r])), [recurring])
  const firstRecurring = initialRecurringId ? (recurringById.get(initialRecurringId) ?? null) : null

  // ── Estado ──
  const startParty = firstRecurring?.partyId ?? initialPartyId
  const [party, setParty] = useState<PurchaseParty | null>(() =>
    startParty && partyById.has(startParty) ? { kind: 'existing', id: startParty } : null,
  )
  const [family, setFamily] = useState<PurchaseFamily>(initialFamily)
  const [voucherType, setVoucherType] = useState<VoucherType | null>(null)
  const [voucherNumber, setVoucherNumber] = useState<VoucherNumberValue>({ pos: '', number: '' })
  const [issueDate, setIssueDate] = useState<string | null>(today)
  const [dueDate, setDueDate] = useState<string | null>(today)
  const [amountMode, setAmountMode] = useState<'total' | 'detail'>('total')
  const [totalCents, setTotalCents] = useState<number | null>(firstRecurring?.amountCents ?? null)
  const [vatRateBp, setVatRateBp] = useState<VatRateBp>(() =>
    firstRecurring?.vatRateBp !== null &&
    firstRecurring?.vatRateBp !== undefined &&
    (QUICK_RATES as readonly number[]).includes(firstRecurring.vatRateBp)
      ? (firstRecurring.vatRateBp as VatRateBp)
      : 2100,
  )
  const [vatAdjust, setVatAdjust] = useState(0)
  const [accountId, setAccountId] = useState<string | null>(() => {
    if (firstRecurring && imputable.has(firstRecurring.accountId)) return firstRecurring.accountId
    // Con el proveedor ya elegido al entrar, su cuenta habitual va desde el primer dibujo.
    const start = startParty ? partyById.get(startParty) : undefined
    return supplierDefaultAccount(start?.defaultAccountId, imputable)
  })
  const [nets, setNets] = useState<Partial<Record<VatRateBp, number | null>>>({})
  const [netAdjust, setNetAdjust] = useState<Partial<Record<VatRateBp, number>>>({})
  const [moreRates, setMoreRates] = useState(false)
  const [grossCents, setGrossCents] = useState<number | null>(null)
  const [nonTaxedCents, setNonTaxedCents] = useState<number | null>(null)
  const [exemptCents, setExemptCents] = useState<number | null>(null)
  const [internalTaxCents, setInternalTaxCents] = useState<number | null>(null)
  const [showExtras, setShowExtras] = useState(false)
  const [percIvaCents, setPercIvaCents] = useState<number | null>(null)
  const [percIibbCents, setPercIibbCents] = useState<number | null>(null)
  const [iibbJurisdictionCode, setIibbJurisdictionCode] = useState(data.iibbJurisdictionCode)
  const [percGananciasCents, setPercGananciasCents] = useState<number | null>(null)
  const [otherTaxesCents, setOtherTaxesCents] = useState<number | null>(null)
  const [controlTotalCents, setControlTotalCents] = useState<number | null>(null)
  const [relatedDocumentId, setRelatedDocumentId] = useState<string | null>(
    related?.documentId ?? null,
  )
  const [recurringId, setRecurringId] = useState<string | null>(firstRecurring?.id ?? null)
  const [payNow, setPayNow] = useState<PurchaseFormState['payNow']>(null)
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  // «N.º de remito» (opcional, sin factura): va adelante de las notas.
  const [remito, setRemito] = useState('')
  // La cuenta sale de la ficha del proveedor: [Cambiar] la abre solo para esta compra.
  const [accountChanging, setAccountChanging] = useState(false)
  // «Usar siempre para …»: tildado si el proveedor todavía no tiene cuenta habitual.
  const [rememberAccount, setRememberAccount] = useState(true)
  // Lo que hay que hacer después de guardar, tal como estaba al tocar «Guardar».
  const rememberOnSave = useRef<{ party: SheetParty; accountId: string } | null>(null)
  // La foto o el PDF del comprobante: se elige acá y se sube después de guardar.
  const [files, setFiles] = useState<File[]>([])
  // Subiendo esos archivos (el comprobante ya quedó guardado).
  const [attaching, setAttaching] = useState(false)
  const mounted = useRef(true)
  const [submitted, setSubmitted] = useState(false)
  const [stayAfterSave, setStayAfterSave] = useState(false)
  const [defaults, setDefaults] = useState<SheetPartyDefaults | null>(null)
  const [duplicate, setDuplicate] = useState<SheetDuplicate | null>(null)
  const [relatedOptions, setRelatedOptions] = useState<RelatedOption[]>(() =>
    related ? [related] : [],
  )
  const touched = useRef({ voucher: false, account: false, due: false })
  const defaultsSeq = useRef(0)
  // El gasto fijo marcado, a mano de `applyDefaults` (que no se rearma con cada cambio).
  const recurringIdRef = useRef(recurringId)
  recurringIdRef.current = recurringId
  /** La persona eligió a mano la condición del proveedor nuevo (ARCA pregunta antes de cambiarla). */
  const [newPartyIvaTouched, setNewPartyIvaTouched] = useState(false)

  // «Completar con ARCA» del proveedor nuevo (diseño §3.1).
  const newParty = party?.kind === 'new' ? party : null
  const arca = useArcaLookup({
    tenantSlug,
    purpose: 'supplier',
    cuit: newParty?.taxId ?? '',
    values: { name: newParty?.name ?? '', ivaCondition: newParty?.ivaCondition ?? null },
    spec: {
      ivaOptions: NEW_PARTY_CONDITIONS.map((c) => c.value),
      chosen: newPartyIvaTouched ? ['ivaCondition'] : [],
    },
    onApply: (patch) => {
      if (patch.ivaCondition !== undefined) {
        touched.current.voucher = false
        setVoucherType(null)
      }
      setParty((prev) =>
        prev?.kind === 'new'
          ? {
              ...prev,
              ...(patch.name !== undefined ? { name: patch.name } : null),
              ...(patch.ivaCondition !== undefined ? { ivaCondition: patch.ivaCondition } : null),
            }
          : prev,
      )
    },
  })

  // ── Derivados del proveedor y del tipo ──
  const existing = party?.kind === 'existing' ? (partyById.get(party.id) ?? null) : null
  const condition: IvaCondition | null =
    party?.kind === 'new' ? party.ivaCondition : (existing?.ivaCondition ?? null)
  const termDays = party?.kind === 'new' ? party.paymentTermDays : (existing?.paymentTermDays ?? 0)
  const voucherOptions = useMemo(
    () =>
      voucherOptionsFor({
        family,
        condition,
        isTaxAgency: existing?.kind === 'tax_agency',
      }),
    [family, condition, existing?.kind],
  )
  const docKind = voucherType
    ? docKindOf(voucherType)
    : family === 'nc'
      ? 'purchase_credit_note'
      : 'purchase'
  const isCreditNote = docKind === 'purchase_credit_note'
  const numbered = voucherType ? VOUCHER_CATALOG[voucherType].numbered : true
  const vat = discriminatesVat(voucherType)

  // ── «¿Se factura?» (12/10/2026): primero sí o no; después, el tipo de ese grupo ──
  const askInvoiced = asksIfInvoiced({
    family,
    options: voucherOptions,
    isTaxAgency: existing?.kind === 'tax_agency',
  })
  const notInvoiced = isNotInvoicedVoucher(voucherType)
  // La ficha propone: su «Comprobante habitual»; si no tiene, el último que se le cargó.
  const rememberedVoucher = rememberedVoucherType({
    habitual: existing?.defaultVoucherType,
    lastUsed: defaults?.voucherType,
    recurring: firstRecurring?.voucherType,
  })
  // El remito no lleva punto de venta ni número: el suyo queda anotado en las notas.
  const remitoActive = voucherType === 'sin_comprobante'

  // ── La cuenta: de la ficha del proveedor, o se pregunta (12/10/2026) ──
  const defaultAccountId = existing
    ? supplierDefaultAccount(existing.defaultAccountId, imputable)
    : null
  const accountMode = accountAsk({
    existingParty: existing !== null,
    defaultAccountId,
    accountId,
    recurringLinked: recurringId !== null,
    changing: accountChanging,
  })
  const accountName = accountId
    ? (data.accounts.find((a) => a.id === accountId)?.name ?? null)
    : null
  const supplierName = existing ? (existing.tradeName ?? existing.name) : 'este proveedor'

  // El tipo sigue al proveedor, a lo que se recuerda de él y a la familia mientras la
  // persona no lo elija a mano (o lo que eligió deje de valer para ese proveedor).
  useEffect(() => {
    const valid = voucherType !== null && voucherOptions.includes(voucherType)
    if (valid && touched.current.voucher) return
    touched.current.voucher = false
    const next = defaultVoucherFor({
      family,
      options: voucherOptions,
      remembered: rememberedVoucher,
      condition,
    })
    if (next !== voucherType) setVoucherType(next)
  }, [voucherOptions, family, rememberedVoucher, condition, voucherType])

  // El vencimiento sigue a la fecha y al plazo mientras no se toque.
  useEffect(() => {
    if (touched.current.due || !issueDate) return
    setDueDate(suggestDueDate(issueDate, termDays))
  }, [issueDate, termDays])

  // ── Lo que el sistema recuerda del proveedor (H.6) ──
  const applyDefaults = useCallback(
    async (partyId: string) => {
      const seq = ++defaultsSeq.current
      setDefaults(null)
      setDuplicate(null)
      const known = partyById.get(partyId)
      // Con un gasto fijo marcado manda SU cuenta: la habitual del proveedor no la pisa.
      const fixed = recurringIdRef.current ? recurringById.get(recurringIdRef.current) : undefined
      const keepFixed =
        fixed !== undefined &&
        (!fixed.partyId || fixed.partyId === partyId) &&
        imputable.has(fixed.accountId)
      if (
        !keepFixed &&
        !touched.current.account &&
        known?.defaultAccountId &&
        imputable.has(known.defaultAccountId)
      ) {
        setAccountId(known.defaultAccountId)
      }
      let result: Awaited<ReturnType<typeof loadPartyDefaults>>
      try {
        result = await loadPartyDefaults(tenantSlug, partyId)
      } catch {
        return
      }
      if (seq !== defaultsSeq.current || !result.ok || !result.data) return
      const d = result.data
      setDefaults(d)
      if (!keepFixed && !touched.current.account && d.accountId && imputable.has(d.accountId))
        setAccountId(d.accountId)
      if (d.vatRateBp !== null && (QUICK_RATES as readonly number[]).includes(d.vatRateBp)) {
        setVatRateBp(d.vatRateBp as VatRateBp)
      }
      if (d.pointOfSale !== null) {
        setVoucherNumber((prev) =>
          prev.pos === '' ? { ...prev, pos: padPos(String(d.pointOfSale)) } : prev,
        )
      }
    },
    [imputable, partyById, recurringById, tenantSlug],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al entrar con un proveedor elegido
  useEffect(() => {
    if (party?.kind === 'existing') void applyDefaults(party.id)
  }, [])

  // Si la persona se fue de la pantalla mientras subía la foto, al terminar no se la mueve.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // NC: las facturas del proveedor que puede corregir.
  useEffect(() => {
    if (!isCreditNote || party?.kind !== 'existing') return
    let alive = true
    loadPartyItems(tenantSlug, { partyId: party.id })
      .then((result) => {
        if (!alive || !result.ok) return
        const seen = new Set<string>()
        const options: RelatedOption[] = related ? [related] : []
        if (related) seen.add(related.documentId)
        for (const item of result.data.items) {
          if (item.side !== 'credit' || seen.has(item.documentId)) continue
          seen.add(item.documentId)
          options.push({ documentId: item.documentId, label: item.label })
        }
        setRelatedOptions(options)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [isCreditNote, party, tenantSlug, related])

  /**
   * Otro proveedor: la cuenta vuelve a salir de su ficha. La que puso el proveedor anterior no
   * se arrastra (quedaría como la habitual del nuevo); la que eligió la persona y la del gasto
   * fijo que sigue marcado, sí.
   */
  const resetAccountFor = (nextPartyId: string | null) => {
    setAccountChanging(false)
    setRememberAccount(true)
    if (touched.current.account) return
    const r = recurringId ? recurringById.get(recurringId) : undefined
    const fromRecurring =
      r !== undefined && (!r.partyId || r.partyId === nextPartyId) && imputable.has(r.accountId)
    setAccountId(fromRecurring ? r.accountId : null)
  }

  const choosePartyId = (id: string | null) => {
    touched.current.voucher = false
    setVoucherType(null)
    setVoucherNumber({ pos: '', number: '' })
    resetAccountFor(id)
    posting.clearFieldErrors()
    if (!id) {
      setParty(null)
      return
    }
    setParty({ kind: 'existing', id })
    if (recurringId) {
      const r = recurringById.get(recurringId)
      if (r?.partyId && r.partyId !== id) setRecurringId(null)
    }
    void applyDefaults(id)
  }

  // ── Lo que se manda ──
  const formState: PurchaseFormState = {
    party,
    voucherType,
    pointOfSale: voucherPart(voucherNumber.pos),
    number: voucherPart(voucherNumber.number),
    issueDate,
    dueDate,
    amountMode,
    totalCents,
    vatRateBp,
    vatAdjustCents: vatAdjust,
    accountId,
    nets,
    vatAdjust: netAdjust,
    grossCents,
    nonTaxedCents,
    exemptCents,
    internalTaxCents,
    percIvaCents,
    percIibbCents,
    iibbJurisdictionCode,
    percGananciasCents,
    otherTaxesCents,
    otherTaxesAccountId,
    controlTotalCents,
    relatedDocumentId,
    recurringExpenseId: recurringId,
    payNow,
    notes: remitoActive ? withRemito(remito, notes) : notes,
  }
  const built = buildPurchaseValues(formState)
  const key = built.values ? JSON.stringify(built.values) : ''
  const form = isCreditNote ? 'purchase_credit_note' : 'purchase'
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` resume `built.values`
  const preview = useMemo(
    () =>
      built.values
        ? previewDocumentForm(form, built.values, data.ctx, { firstOpenDate: data.firstOpenDate })
        : null,
    [key, form, data.ctx, data.firstOpenDate],
  )
  const total = purchaseTotal(formState)
  const detail = detailTotals(formState)

  /**
   * Lo que sigue a un comprobante YA guardado. Nada de acá lo deshace: si algo
   * falla, se avisa y el comprobante queda. `documentId` es el comprobante
   * nuevo (la compra o la nota): lo que haya que colgarle después de guardar
   * (la foto del comprobante) va acá.
   */
  const afterPosted = async (posted: {
    documentId: string | null
    remember: { party: SheetParty; accountId: string } | null
    files: readonly File[]
  }) => {
    if (posted.remember) {
      // «Usar siempre para …»: la cuenta queda en la ficha del proveedor.
      await rememberSupplierAccount(tenantSlug, posted.remember.party, posted.remember.accountId)
    }
    // La foto del comprobante: si alguna no sube, avisa y se suma después desde el comprobante.
    await attachPendingFiles({
      tenantSlug,
      documentId: posted.documentId,
      files: posted.files,
      openDocument: (id) => router.push(documentHref(tenantSlug, id)),
    })
  }

  const onSaved = (saved: SavedState) => {
    posting.undoToast(saved.message, saved)
    const remember = rememberOnSave.current
    rememberOnSave.current = null
    const picked = files
    const followUp = afterPosted({
      documentId: saved.result.documents[0]?.id ?? null,
      remember,
      files: picked,
    })
    if (!stayAfterSave) {
      if (picked.length === 0) {
        router.push(returnHref)
        return
      }
      // Con foto, la pantalla espera a que suba y recién ahí vuelve a la lista.
      setAttaching(true)
      void followUp.finally(() => {
        if (mounted.current) router.push(returnHref)
      })
      return
    }
    // ⇧⌘↵: queda vacía para cargar otra del mismo proveedor (uno nuevo ya quedó creado:
    // se vuelve a elegir de la lista para no crearlo dos veces).
    setStayAfterSave(false)
    setSubmitted(false)
    if (party?.kind === 'new') {
      setParty(null)
      touched.current.voucher = false
      setVoucherType(null)
      setVoucherNumber({ pos: '', number: '' })
    }
    setVoucherNumber((prev) => ({ pos: prev.pos, number: '' }))
    setTotalCents(null)
    setNets({})
    setNetAdjust({})
    setGrossCents(null)
    setNonTaxedCents(null)
    setExemptCents(null)
    setInternalTaxCents(null)
    setPercIvaCents(null)
    setPercIibbCents(null)
    setPercGananciasCents(null)
    setOtherTaxesCents(null)
    setControlTotalCents(null)
    setVatAdjust(0)
    setRecurringId(null)
    setPayNow(null)
    setNotes('')
    setRemito('')
    // [Cambiar] valía para esa compra: la próxima vuelve a la cuenta de la ficha.
    if (accountChanging && defaultAccountId !== null) {
      touched.current.account = false
      setAccountId(defaultAccountId)
    }
    setAccountChanging(false)
    setDuplicate(null)
    setFiles([])
    // La próxima se puede ir cargando; se guarda cuando terminó de subir la foto de esta.
    if (picked.length > 0) setAttaching(true)
    // Los datos se vuelven a traer cuando terminó lo de después (la ficha ya tiene su cuenta).
    void followUp.finally(() => {
      if (mounted.current) setAttaching(false)
      router.refresh()
    })
  }

  const posting = useDocumentPosting<PurchaseFormValues>({
    tenantSlug,
    action: isCreditNote ? postPurchaseCreditNote : postPurchase,
    onSaved: (saved) => onSaved(saved),
    formRef,
    isKnownField: (k) => UI_FIELDS.has(built.fieldOf[k] ?? k),
  })

  // ── ¿Ya está cargada? ──
  const partyId = party?.kind === 'existing' ? party.id : null
  const pos = voucherPart(voucherNumber.pos)
  const number = voucherPart(voucherNumber.number)
  useEffect(() => {
    if (!partyId || total === null || !issueDate || !voucherType || (numbered && number === null)) {
      setDuplicate(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const result = await findDuplicate(tenantSlug, {
          partyId,
          totalCents: total,
          issueDate,
          voucherType,
          pointOfSale: numbered ? pos : null,
          number: numbered ? number : null,
        })
        if (alive) setDuplicate(result.ok ? result.data : null)
      } catch {
        if (alive) setDuplicate(null)
      }
    }, 450)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [partyId, total, issueDate, voucherType, numbered, pos, number, tenantSlug])

  // ── Errores: los propios al guardar + los del motor y del servidor, cada uno en su campo ──
  const errors: Record<string, string> = {}
  const unplaced: string[] = []
  const place = (source: Record<string, string>) => {
    for (const [path, message] of Object.entries(source)) {
      const field = built.fieldOf[path] ?? path
      if (UI_FIELDS.has(field)) {
        if (!errors[field]) errors[field] = message
      } else unplaced.push(message)
    }
  }
  if (submitted) {
    place(built.missing)
    if (preview && !preview.ok) place(preview.fieldErrors ?? {})
  }
  place(posting.fieldErrors)
  const unknownPreviewError =
    submitted &&
    preview &&
    !preview.ok &&
    unplaced.length === 0 &&
    Object.keys(preview.fieldErrors ?? {}).length === 0
      ? preview.message
      : (unplaced[0] ?? null)

  const submit = (event?: FormEvent, stay = false) => {
    event?.preventDefault()
    // Mientras sube la foto de la anterior no se guarda otra (esa ya quedó cargada).
    if (posting.pending || attaching) return
    setSubmitted(true)
    if (!built.values || !preview?.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    setStayAfterSave(stay)
    // Lo de después de guardar se decide ahora, con lo que se está mandando.
    const accountToSave = accountToRemember({
      ask: accountMode,
      remember: rememberAccount,
      accountId,
    })
    rememberOnSave.current =
      existing && accountToSave ? { party: existing, accountId: accountToSave } : null
    posting.submit(built.values, preview.hash, key)
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit(undefined, event.shiftKey)
    }
  }

  // ── Textos que acompañan ──
  const ids = (name: string) => `${uid}-${name}`
  const split =
    amountMode === 'total' && vat ? splitTotal(netOfExtras(), vatRateBp, vatAdjust) : null
  function netOfExtras(): number | null {
    if (totalCents === null) return null
    const extras = [
      percIvaCents,
      percIibbCents,
      percGananciasCents,
      otherTaxesCents,
    ].reduce<number>((sum, c) => sum + (c && c > 0 ? c : 0), 0)
    return totalCents - extras > 0 ? totalCents - extras : null
  }
  const voucherHint = (() => {
    // Lo que es cierto de cada tipo: el remito no va al Libro IVA; el «otro comprobante», sí.
    if (voucherType === 'sin_comprobante') return 'No entra al Libro IVA: va todo al costo.'
    if (voucherType === 'otro_comprobante') {
      return 'Lleva punto de venta y número, y entra al Libro IVA como «Otro comprobante».'
    }
    if (!voucherType || !condition) return null
    const check = voucherConditionCheck(voucherType, condition)
    if (check.warnings.includes('voucher_m')) {
      return 'Factura M: puede corresponder retener IVA y Ganancias. Consultalo con la contadora.'
    }
    if (check.warnings.includes('voucher_condition')) {
      return `Con ${VOUCHER_CATALOG[voucherType].label} no computás el IVA: va todo al costo. Pedí factura A si podés.`
    }
    return null
  })()
  const closedMonth =
    issueDate && data.firstOpenDate && issueDate < data.firstOpenDate
      ? `${capitalize(formatMonthYear(issueDate))} está cerrado: va al Libro IVA de ${formatMonthYear(data.firstOpenDate)} (se registra el ${formatIsoDay(data.firstOpenDate)}).`
      : null
  const lastVoucher =
    defaults && defaults.pointOfSale !== null && defaults.lastNumber !== null
      ? `${padPos(String(defaults.pointOfSale))}-${padNumber(String(defaults.lastNumber))}`
      : null
  const pendingRecurring = recurring.filter(
    (r) => r.pending && r.partyId !== null && r.partyId === partyId && r.id !== recurringId,
  )
  const linkedRecurring = recurringId ? (recurringById.get(recurringId) ?? null) : null
  const payAmount = payNow ? (payNow.amountCents ?? total) : null
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const title = isCreditNote
    ? 'nota de crédito'
    : docKind === 'purchase_debit_note'
      ? 'nota de débito'
      : notInvoiced
        ? 'compra'
        : 'factura'
  const submitLabel = payNow
    ? payAmount
      ? `Guardar y pagar ${formatCentsShort(payAmount)}`
      : 'Guardar y pagar'
    : `Guardar ${title}`

  // Con «¿Se factura?» a la vista, el selector trae solo los tipos de la respuesta elegida.
  const invoiceSplit = splitByInvoice(voucherOptions)
  const shownTypes = askInvoiced
    ? notInvoiced
      ? invoiceSplit.notInvoiced
      : invoiceSplit.invoiced
    : voucherOptions
  const chooseInvoiced = (next: 'si' | 'no') => {
    if (voucherType !== null && notInvoiced === (next === 'no')) return
    const type =
      next === 'no'
        ? notInvoicedDefault(voucherOptions)
        : defaultVoucherFor({
            family,
            options: invoiceSplit.invoiced,
            remembered: rememberedVoucher,
            condition,
          })
    if (!type) return
    touched.current.voucher = true
    setVoucherType(type)
    setVatAdjust(0)
    posting.clearFieldErrors()
  }

  const typeGroups: Array<{ label: string; types: VoucherType[] }> = [
    {
      label: 'Facturas y tiques',
      types: shownTypes.filter(
        (t) => !VOUCHER_CATALOG[t].isCreditNote && !VOUCHER_CATALOG[t].isDebitNote,
      ),
    },
    {
      label: 'Notas de débito',
      types: shownTypes.filter((t) => VOUCHER_CATALOG[t].isDebitNote),
    },
    {
      label: 'Notas de crédito',
      types: shownTypes.filter((t) => VOUCHER_CATALOG[t].isCreditNote),
    },
  ].filter((g) => g.types.length > 0)

  const familyChips: ReadonlyArray<{ value: PurchaseFamily; label: string }> = [
    { value: 'factura', label: 'Factura o tique' },
    { value: 'nd', label: 'Nota de débito' },
    { value: 'nc', label: 'Nota de crédito' },
  ]

  const previewCard = (
    <div className="card-hairline rounded-xl border bg-card">
      <header className="border-b border-border/60 px-5 py-4">
        <h2 className="font-serif text-lg font-semibold tracking-tight">
          Asiento que se va a generar
        </h2>
        <p className="text-xs text-muted-foreground">Se arma solo con lo que cargás.</p>
      </header>
      <div className="px-5 py-4">
        <EntryPreview
          entries={entries}
          alwaysOpen
          emptyText="Completá el proveedor, el tipo y los importes para ver el asiento."
        />
      </div>
    </div>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <form
        ref={formRef}
        onSubmit={(e) => submit(e)}
        onKeyDown={onFormKeyDown}
        noValidate
        className="card-hairline grid gap-6 rounded-xl border bg-card p-5 sm:p-6"
      >
        {/* ── Proveedor ── */}
        <section className="grid gap-5" aria-labelledby={ids('s-proveedor')}>
          <h2 id={ids('s-proveedor')} className="sr-only">
            Proveedor y comprobante
          </h2>
          {party?.kind === 'new' ? (
            // `@container`: el bloque mide ~490 px a 1280 con el menú abierto y ~290 en el
            // teléfono; las columnas y el rótulo del botón siguen a ese ancho, no a la ventana
            // (en tres columnas «Responsable inscripto» se metía debajo de la CUIT).
            <div className="@container grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium whitespace-nowrap">Proveedor nuevo</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 text-muted-foreground md:h-8"
                  onClick={() => setParty(null)}
                >
                  <X className="size-3.5" aria-hidden />
                  <span className="@sm:hidden">Elegir otro</span>
                  <span className="hidden @sm:inline">Elegir uno existente</span>
                </Button>
              </div>
              <Field id={ids('np-name')} label="Razón social" required error={errors.newPartyName}>
                <Input
                  id={ids('np-name')}
                  value={party.name}
                  maxLength={120}
                  autoComplete="off"
                  aria-invalid={errors.newPartyName ? true : undefined}
                  onChange={(e) => setParty({ ...party, name: e.target.value })}
                  className="h-11 text-base md:h-10 md:text-sm"
                />
              </Field>
              <div className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
                <Field id={ids('np-cond')} label="Condición frente al IVA">
                  <Select
                    value={party.ivaCondition}
                    onValueChange={(v) => {
                      touched.current.voucher = false
                      setVoucherType(null)
                      setNewPartyIvaTouched(true)
                      setParty({ ...party, ivaCondition: v as IvaCondition })
                    }}
                  >
                    <SelectTrigger
                      id={ids('np-cond')}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ivaOptionsWith(NEW_PARTY_CONDITIONS, party.ivaCondition).map((c) => (
                        <SelectItem key={c.value} value={c.value} className="min-h-11 md:min-h-8">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id={ids('np-cuit')}
                  label="CUIT"
                  required={voucherType !== null && VOUCHER_CATALOG[voucherType].ivaBook}
                  error={errors.newPartyTaxId}
                >
                  <Input
                    id={ids('np-cuit')}
                    value={party.taxId}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="30-71876543-5"
                    aria-invalid={errors.newPartyTaxId ? true : undefined}
                    onChange={(e) => setParty({ ...party, taxId: e.target.value })}
                    onBlur={(e) => {
                      const digits = e.target.value.replace(/\D/g, '')
                      if (digits.length === 11) setParty({ ...party, taxId: formatCuit(digits) })
                    }}
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                  />
                </Field>
                <Field id={ids('np-term')} label="Plazo de pago">
                  <div className="relative">
                    <Input
                      id={ids('np-term')}
                      value={String(party.paymentTermDays)}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 3)
                        setParty({
                          ...party,
                          paymentTermDays: digits === '' ? 0 : Math.min(365, Number(digits)),
                        })
                      }}
                      className="h-11 pr-12 text-base tabular-nums md:h-10 md:text-sm"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                    >
                      días
                    </span>
                  </div>
                </Field>
              </div>
              <ArcaLookupTrigger lookup={arca} />
              <ArcaLookupPanel lookup={arca} />
            </div>
          ) : (
            <Field
              id={ids('party')}
              label="Proveedor"
              required
              error={errors.party}
              hint={
                existing
                  ? [
                      CONDITION_LABELS[existing.ivaCondition],
                      existing.taxId ? `CUIT ${formatCuit(existing.taxId)}` : 'Sin CUIT cargado',
                      existing.paymentTermDays > 0
                        ? `Paga a ${existing.paymentTermDays} días`
                        : 'De contado',
                    ].join(' · ')
                  : 'Buscá por nombre o CUIT. Si no está, creálo desde acá.'
              }
            >
              <PartyCombobox
                id={ids('party')}
                value={party?.kind === 'existing' ? party.id : null}
                onValueChange={(id) => choosePartyId(id)}
                parties={partyOptions}
                onCreate={(name) => {
                  touched.current.voucher = false
                  setVoucherType(null)
                  resetAccountFor(null)
                  defaultsSeq.current += 1
                  setDefaults(null)
                  setNewPartyIvaTouched(false)
                  arca.reset()
                  setParty({
                    kind: 'new',
                    name,
                    ivaCondition: 'responsable_inscripto',
                    taxId: '',
                    paymentTermDays: 0,
                  })
                }}
                invalid={Boolean(errors.party)}
                aria-describedby={`${ids('party')}-hint`}
              />
            </Field>
          )}

          {/* ── Qué es ── */}
          <div className="grid gap-2">
            <span id={ids('family')} className="text-sm font-medium leading-none">
              ¿Qué cargás?
            </span>
            <RadioChips
              labelledBy={ids('family')}
              value={family}
              options={familyChips}
              onChange={(next) => {
                touched.current.voucher = false
                setVoucherType(null)
                setFamily(next)
                if (next === 'nc') setPayNow(null)
                posting.clearFieldErrors()
              }}
            />
          </div>

          {/* ── ¿Se factura? (solo facturas y tiques; una nota siempre es con comprobante) ── */}
          {askInvoiced ? (
            <div className="grid gap-2">
              <span id={ids('invoiced')} className="text-sm font-medium leading-none">
                ¿Se factura?
              </span>
              <RadioChips
                labelledBy={ids('invoiced')}
                value={voucherType === null ? null : notInvoiced ? 'no' : 'si'}
                options={[
                  { value: 'si', label: 'Sí' },
                  { value: 'no', label: 'No', ariaLabel: 'No: remito u otro comprobante' },
                ]}
                onChange={chooseInvoiced}
              />
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id={ids('voucherType')}
              label="Tipo de comprobante"
              required
              error={errors.voucherType}
              hint={voucherHint ?? undefined}
            >
              {/* Siempre controlado (`''` = sin elegir): con `undefined` el `<select>` oculto de
                  Radix dispara `onValueChange('')` al volver a «sin tipo» (proveedor nuevo,
                  otra familia) y el render se rompía con un tipo que no existe. */}
              <Select
                value={voucherType ?? ''}
                onValueChange={(v) => {
                  if (!isVoucherType(v)) return
                  touched.current.voucher = true
                  setVoucherType(v)
                  setVatAdjust(0)
                  posting.clearFieldErrors()
                }}
              >
                <SelectTrigger
                  id={ids('voucherType')}
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  aria-invalid={errors.voucherType ? true : undefined}
                >
                  <SelectValue placeholder="Elegí el tipo" />
                </SelectTrigger>
                <SelectContent>
                  {typeGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      {typeGroups.length > 1 ? <SelectLabel>{group.label}</SelectLabel> : null}
                      {group.types.map((t) => (
                        <SelectItem key={t} value={t} className="min-h-11 md:min-h-8">
                          {VOUCHER_CATALOG[t].label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {numbered ? (
              <Field
                id={ids('number')}
                label="Punto de venta y número"
                required
                error={errors.number}
                hint={
                  lastVoucher ? `La última fue ${lastVoucher}.` : 'Podés pegar «0003-00001290».'
                }
              >
                <VoucherNumberInput
                  id={ids('number')}
                  value={voucherNumber}
                  onChange={(next) => {
                    setVoucherNumber(next)
                    posting.clearFieldErrors()
                  }}
                  invalid={Boolean(errors.number)}
                  describedBy={`${ids('number')}-hint`}
                />
              </Field>
            ) : remitoActive ? (
              <Field
                id={ids('remito')}
                label="N.º de remito"
                optional
                hint="Si el papel tiene número, queda anotado en las notas."
              >
                <Input
                  id={ids('remito')}
                  value={remito}
                  maxLength={REMITO_MAX}
                  autoComplete="off"
                  placeholder="0001-00001234"
                  aria-describedby={`${ids('remito')}-hint`}
                  onChange={(e) => {
                    setRemito(e.target.value)
                    posting.clearFieldErrors()
                  }}
                  className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                />
              </Field>
            ) : null}
          </div>

          {duplicate ? (
            <InlineNotice
              action={
                <Link
                  href={documentHref(tenantSlug, duplicate.documentId)}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Ver el que ya está
                </Link>
              }
            >
              {duplicate.match === 'number'
                ? `Ya cargaste ${duplicate.label}${duplicate.partyName ? ` de ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` el ${formatIsoDay(duplicate.accountingDate)}` : ''}.`
                : `Ya hay un comprobante de ${duplicate.totalCents !== null ? formatCentsShort(duplicate.totalCents) : 'ese importe'}${duplicate.partyName ? ` de ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` del ${formatIsoDay(duplicate.accountingDate)}` : ''} (${duplicate.label}). ¿Es otro?`}
            </InlineNotice>
          ) : null}

          {/* Foto del comprobante: se sube después de guardar */}
          <AttachmentPicker
            value={files}
            onChange={setFiles}
            disabled={posting.pending || attaching}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <DateField
              id={ids('issueDate')}
              label="Fecha del comprobante"
              required
              value={issueDate}
              onValueChange={(next) => {
                setIssueDate(next)
                posting.clearFieldErrors()
              }}
              min={data.booksStartDate}
              max={today}
              today={today}
              error={errors.issueDate ?? null}
              hint={closedMonth ?? undefined}
            />
            {isCreditNote ? null : (
              <DateField
                id={ids('dueDate')}
                label="Vence"
                optional
                value={dueDate}
                onValueChange={(next) => {
                  touched.current.due = true
                  setDueDate(next)
                  posting.clearFieldErrors()
                }}
                min={issueDate ?? undefined}
                shortcuts={
                  issueDate
                    ? [
                        { label: 'De contado', value: issueDate },
                        ...(termDays > 0
                          ? [
                              {
                                label: `A ${termDays} días`,
                                value: suggestDueDate(issueDate, termDays),
                              },
                            ]
                          : []),
                      ]
                    : false
                }
                today={today}
                error={errors.dueDate ?? null}
                hint={termDays > 0 ? `Plazo del proveedor: ${termDays} días.` : undefined}
              />
            )}
          </div>

          {linkedRecurring ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <Repeat className="size-4 text-success" aria-hidden />
                Es «{linkedRecurring.name}»: queda marcado como cargado.
              </span>
              <button
                type="button"
                aria-label={`No es «${linkedRecurring.name}»`}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:size-8"
                onClick={() => setRecurringId(null)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : pendingRecurring.length > 0 && !isCreditNote ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">¿Es un gasto fijo?</span>
              {pendingRecurring.map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 rounded-full md:h-8"
                  onClick={() => {
                    setRecurringId(r.id)
                    if (totalCents === null && r.amountCents !== null && amountMode === 'total') {
                      setTotalCents(r.amountCents)
                    }
                    // El gasto fijo trae su cuenta, salvo que la persona ya haya elegido otra.
                    if (!touched.current.account && imputable.has(r.accountId)) {
                      setAccountId(r.accountId)
                    }
                  }}
                >
                  <Repeat className="size-3.5" aria-hidden />
                  Es «{r.name}» (vence el {formatIsoDay(r.nextDueDate)})
                </Button>
              ))}
            </div>
          ) : null}

          {isCreditNote ? (
            <Field
              id={ids('related')}
              label="¿Qué factura corrige?"
              optional
              error={errors.related}
              hint="La nota queda a favor y se usa sola en el próximo pago."
            >
              <Select
                value={relatedDocumentId ?? '__ninguna__'}
                onValueChange={(v) => setRelatedDocumentId(v === '__ninguna__' ? null : v)}
              >
                <SelectTrigger
                  id={ids('related')}
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ninguna__" className="min-h-11 md:min-h-8">
                    Ninguna en particular
                  </SelectItem>
                  {relatedOptions.map((o) => (
                    <SelectItem
                      key={o.documentId}
                      value={o.documentId}
                      className="min-h-11 md:min-h-8"
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </section>

        {/* ── Importes ── */}
        <section
          className="grid gap-5 border-t border-border/60 pt-6"
          aria-labelledby={ids('s-importes')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id={ids('s-importes')}
              className="font-display text-base font-semibold tracking-tight"
            >
              Importes
            </h2>
            <RadioChips
              labelledBy={ids('s-importes')}
              value={amountMode}
              onChange={(next) => {
                setAmountMode(next)
                posting.clearFieldErrors()
              }}
              options={[
                { value: 'total', label: 'Total' },
                { value: 'detail', label: 'Detalle por alícuota' },
              ]}
            />
          </div>

          {amountMode === 'total' ? (
            <div className="grid gap-4">
              <div className={cn('grid gap-4', vat && 'sm:grid-cols-[minmax(0,1fr)_140px]')}>
                <MoneyField
                  id={ids('total')}
                  label="Total del comprobante"
                  required
                  value={totalCents}
                  onValueChange={(cents) => {
                    setTotalCents(cents)
                    posting.clearFieldErrors()
                  }}
                  error={errors.total ?? null}
                  hint={
                    vat
                      ? 'Con IVA, percepciones e impuestos: lo que dice «Total».'
                      : 'Lo que dice «Total».'
                  }
                />
                {vat ? (
                  <Field id={ids('vatRate')} label="Alícuota de IVA" error={errors.vatRate}>
                    <Select
                      value={String(vatRateBp)}
                      onValueChange={(v) => {
                        setVatRateBp(Number(v) as VatRateBp)
                        setVatAdjust(0)
                      }}
                    >
                      <SelectTrigger
                        id={ids('vatRate')}
                        className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUICK_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                            {vatRateLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </div>
              {split ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground">
                    Neto {formatCents(split.netCents)} · IVA {formatCents(split.vatCents)}
                  </span>
                  {vatRateBp !== 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 px-2.5 tabular-nums md:h-7"
                        aria-label="Restar un centavo al IVA"
                        disabled={vatAdjust <= -VAT_ADJUST_LIMIT}
                        onClick={() => setVatAdjust((v) => Math.max(-VAT_ADJUST_LIMIT, v - 1))}
                      >
                        −1¢
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 px-2.5 tabular-nums md:h-7"
                        aria-label="Sumar un centavo al IVA"
                        disabled={vatAdjust >= VAT_ADJUST_LIMIT}
                        onClick={() => setVatAdjust((v) => Math.min(VAT_ADJUST_LIMIT, v + 1))}
                      >
                        +1¢
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4">
              {vat ? (
                <div className="grid gap-3">
                  {(moreRates ? DETAIL_RATES : MAIN_DETAIL_RATES).map((rate) => {
                    const net = nets[rate] ?? null
                    const adjust = netAdjust[rate] ?? 0
                    const field = `net-${rate}`
                    return (
                      <div
                        key={rate}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start"
                      >
                        <MoneyField
                          id={ids(field)}
                          label={`Neto gravado ${vatRateLabel(rate)}`}
                          value={net}
                          align="end"
                          onValueChange={(cents) => {
                            setNets((prev) => ({ ...prev, [rate]: cents }))
                            setNetAdjust((prev) => ({ ...prev, [rate]: 0 }))
                            posting.clearFieldErrors()
                          }}
                          error={errors[field] ?? null}
                        />
                        {rate !== 0 ? (
                          <div className="grid gap-1.5 sm:pt-[22px]">
                            <div className="flex h-11 items-center justify-between gap-2 rounded-md border border-dashed border-border/80 px-3 text-sm md:h-10">
                              <span className="text-muted-foreground">
                                IVA {vatRateLabel(rate)}
                              </span>
                              <span className="tabular-nums">
                                {net && net > 0 ? formatCents(detailVat(net, rate, adjust)) : '—'}
                              </span>
                            </div>
                            {net && net > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 px-2 text-xs tabular-nums md:h-7"
                                  aria-label={`Restar un centavo al IVA ${vatRateLabel(rate)}`}
                                  disabled={adjust <= -VAT_ADJUST_LIMIT}
                                  onClick={() =>
                                    setNetAdjust((prev) => ({
                                      ...prev,
                                      [rate]: Math.max(-VAT_ADJUST_LIMIT, (prev[rate] ?? 0) - 1),
                                    }))
                                  }
                                >
                                  −1¢
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 px-2 text-xs tabular-nums md:h-7"
                                  aria-label={`Sumar un centavo al IVA ${vatRateLabel(rate)}`}
                                  disabled={adjust >= VAT_ADJUST_LIMIT}
                                  onClick={() =>
                                    setNetAdjust((prev) => ({
                                      ...prev,
                                      [rate]: Math.min(VAT_ADJUST_LIMIT, (prev[rate] ?? 0) + 1),
                                    }))
                                  }
                                >
                                  +1¢
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  {moreRates ? null : (
                    <button
                      type="button"
                      onClick={() => setMoreRates(true)}
                      className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-0"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Más alícuotas (5 %, 2,5 %, 0 %)
                    </button>
                  )}
                </div>
              ) : (
                <MoneyField
                  id={ids('gross')}
                  label="Importe"
                  required
                  value={grossCents}
                  align="end"
                  onValueChange={(cents) => {
                    setGrossCents(cents)
                    posting.clearFieldErrors()
                  }}
                  error={errors.gross ?? null}
                  hint="Las facturas B y C no discriminan IVA: va todo junto."
                />
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <MoneyField
                  id={ids('nonTaxed')}
                  label="No gravado"
                  optional
                  value={nonTaxedCents}
                  align="end"
                  onValueChange={setNonTaxedCents}
                  error={errors.nonTaxed ?? null}
                />
                <MoneyField
                  id={ids('exempt')}
                  label="Exento"
                  optional
                  value={exemptCents}
                  align="end"
                  onValueChange={setExemptCents}
                  error={errors.exempt ?? null}
                />
                <MoneyField
                  id={ids('internalTax')}
                  label="Impuestos internos"
                  optional
                  value={internalTaxCents}
                  align="end"
                  onValueChange={setInternalTaxCents}
                  error={errors.internalTax ?? null}
                />
              </div>
              {errors.detail ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.detail}
                </p>
              ) : null}
            </div>
          )}

          {/* Percepciones e impuestos (los dos modos) */}
          {showExtras || percIvaCents || percIibbCents || percGananciasCents || otherTaxesCents ? (
            <div className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <p className="text-sm font-medium">Percepciones e impuestos</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {vat ? (
                  <MoneyField
                    id={ids('percIva')}
                    label="Percepción de IVA"
                    optional
                    value={percIvaCents}
                    align="end"
                    onValueChange={setPercIvaCents}
                    error={errors.percIva ?? null}
                  />
                ) : null}
                <MoneyField
                  id={ids('percGanancias')}
                  label="Percepción de Ganancias"
                  optional
                  value={percGananciasCents}
                  align="end"
                  onValueChange={setPercGananciasCents}
                  error={errors.percGanancias ?? null}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <MoneyField
                  id={ids('percIibb')}
                  label="Percepción de Ingresos Brutos"
                  optional
                  value={percIibbCents}
                  align="end"
                  onValueChange={setPercIibbCents}
                  error={errors.percIibb ?? null}
                />
                <Field
                  id={ids('percIibbJurisdiction')}
                  label="Jurisdicción"
                  error={errors.percIibbJurisdiction}
                >
                  <Select
                    value={String(iibbJurisdictionCode)}
                    onValueChange={(v) => setIibbJurisdictionCode(Number(v))}
                  >
                    <SelectTrigger
                      id={ids('percIibbJurisdiction')}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IIBB_JURISDICTIONS.map((j) => (
                        <SelectItem
                          key={j.code}
                          value={String(j.code)}
                          className="min-h-11 md:min-h-8"
                        >
                          {j.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {otherTaxesAccountId ? (
                <MoneyField
                  id={ids('otherTaxes')}
                  label="Otros tributos"
                  optional
                  value={otherTaxesCents}
                  align="end"
                  onValueChange={setOtherTaxesCents}
                  error={errors.otherTaxes ?? null}
                  hint="Tasas municipales u otros cargos que no son IVA."
                />
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowExtras(true)}
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-0"
            >
              <Plus className="size-3.5" aria-hidden />
              Percepciones e impuestos
            </button>
          )}

          {amountMode === 'detail' ? (
            <div className="grid gap-3 rounded-xl bg-secondary/40 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">Total</span>
                <span className="font-serif text-2xl font-semibold tabular-nums">
                  {detail.totalCents > 0 ? formatCents(detail.totalCents) : '—'}
                </span>
              </div>
              {detail.totalCents > 0 ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {vat
                    ? `Neto ${formatCents(detail.netCents)} · IVA ${formatCents(detail.vatCents)}`
                    : `Importe ${formatCents(detail.netCents)}`}
                  {detail.otherCents > 0 ? ` · Otros ${formatCents(detail.otherCents)}` : ''}
                </p>
              ) : null}
              <MoneyField
                id={ids('controlTotal')}
                label="Total según la factura"
                optional
                value={controlTotalCents}
                align="end"
                onValueChange={setControlTotalCents}
                error={errors.controlTotal ?? null}
                hint="Para controlar que cargaste todo."
              >
                {controlTotalCents !== null && detail.totalCents > 0 ? (
                  controlTotalCents === detail.totalCents ? (
                    <p className="text-xs font-medium text-success">Coincide.</p>
                  ) : (
                    <p className="text-xs font-medium text-warning-text">
                      Diferencia {formatCents(Math.abs(controlTotalCents - detail.totalCents))}.
                    </p>
                  )
                ) : null}
              </MoneyField>
            </div>
          ) : null}

          {accountMode === 'fixed' && accountName ? (
            // La cuenta sale de la ficha del proveedor: no se pregunta. [Cambiar] la abre.
            <SupplierAccountLine
              accountName={accountName}
              className="text-sm"
              onChange={() => {
                setAccountChanging(true)
                requestAnimationFrame(() => document.getElementById(ids('account'))?.focus())
              }}
            />
          ) : (
            <Field
              id={ids('account')}
              label="¿En qué es la compra?"
              required
              error={errors.account}
              hint={
                accountChanging && defaultAccountId !== null ? (
                  <>
                    Solo para esta compra: la cuenta habitual de {supplierName} no cambia.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        touched.current.account = false
                        setAccountChanging(false)
                        setAccountId(defaultAccountId)
                        posting.clearFieldErrors()
                      }}
                      className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Usar la habitual
                    </button>
                  </>
                ) : accountMode === 'ask-remember' ? (
                  'La cuenta donde va el neto.'
                ) : (
                  'La cuenta donde va el neto. Se recuerda para la próxima con este proveedor.'
                )
              }
            >
              <AccountCombobox
                id={ids('account')}
                value={accountId}
                onValueChange={(next) => {
                  touched.current.account = true
                  setAccountId(next)
                  posting.clearFieldErrors()
                }}
                accounts={accountOptions}
                placeholder="Elegí la cuenta (mercadería, bebidas, limpieza…)"
                invalid={Boolean(errors.account)}
                aria-describedby={`${ids('account')}-hint`}
              />
              {accountMode === 'ask-remember' ? (
                <RememberAccountCheckbox
                  id={ids('remember')}
                  partyName={supplierName}
                  checked={rememberAccount}
                  onCheckedChange={setRememberAccount}
                />
              ) : null}
            </Field>
          )}
        </section>

        {/* ── Pago en el mismo envío ── */}
        {payNow && !isCreditNote ? (
          <section
            className="grid gap-4 rounded-xl border border-border/70 bg-background/40 p-4"
            aria-labelledby={ids('s-pago')}
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id={ids('s-pago')}
                className="font-display text-base font-semibold tracking-tight"
              >
                Pago
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 gap-1.5 text-muted-foreground md:h-8"
                onClick={() => setPayNow(null)}
              >
                <X className="size-3.5" aria-hidden />
                Sin pago
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id={ids('payTreasury')}
                label="¿Con qué pagaste?"
                required
                error={errors.payTreasury}
              >
                <TreasurySelect
                  id={ids('payTreasury')}
                  value={payNow.treasuryAccountId}
                  onValueChange={(next) => setPayNow({ ...payNow, treasuryAccountId: next })}
                  treasuries={data.treasuries}
                  invalid={Boolean(errors.payTreasury)}
                />
              </Field>
              <MoneyField
                id={ids('payAmount')}
                label="Monto"
                value={payNow.amountCents ?? total}
                onValueChange={(cents) =>
                  setPayNow({
                    ...payNow,
                    amountCents: cents !== null && cents === total ? null : cents,
                  })
                }
                error={errors.payAmount ?? null}
                hint={
                  payNow.amountCents !== null && total !== null && payNow.amountCents < total
                    ? `Queda ${formatCents(total - payNow.amountCents)} a pagar.`
                    : 'Lo que pagaste ahora (el total si fue todo).'
                }
              />
              <DateField
                id={ids('payDate')}
                label="Fecha del pago"
                value={payNow.date}
                onValueChange={(next) => setPayNow({ ...payNow, date: next })}
                min={issueDate ?? data.booksStartDate}
                max={today}
                today={today}
                error={errors.payDate ?? null}
              />
              <Field
                id={ids('payReference')}
                label="Referencia"
                optional
                error={errors.payReference}
              >
                <Input
                  id={ids('payReference')}
                  value={payNow.reference}
                  maxLength={60}
                  autoComplete="off"
                  placeholder="N° de transferencia"
                  onChange={(e) => setPayNow({ ...payNow, reference: e.target.value })}
                  className="h-11 text-base md:h-10 md:text-sm"
                />
              </Field>
            </div>
          </section>
        ) : null}

        {/* ── Notas ── */}
        {showNotes || notes ? (
          <Field id={ids('notes')} label="Notas" optional error={errors.notes}>
            <Textarea
              id={ids('notes')}
              value={notes}
              maxLength={detailRoom(remitoActive ? remito : '', NOTES_MAX)}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              className="text-base md:text-sm"
            />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowNotes(true)}
            className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-0"
          >
            <Plus className="size-3.5" aria-hidden />
            Agregar notas
          </button>
        )}

        {/* En el celular el asiento va acá, arriba de los botones. */}
        <div className="lg:hidden">
          <EntryPreview
            entries={entries}
            emptyText="Completá el proveedor, el tipo y los importes para ver el asiento."
          />
        </div>

        {unknownPreviewError ? (
          <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
        ) : null}
        <FormBanner banner={posting.banner} />

        <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button asChild variant="ghost" className="h-11 md:h-9">
            <Link href={returnHref}>Cancelar</Link>
          </Button>
          {!payNow && !isCreditNote ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() =>
                setPayNow({
                  treasuryAccountId: pickTreasury({
                    treasuries: data.treasuries.filter((t) => t.active),
                    lastUsedWithParty: defaults?.treasuryAccountId ?? null,
                    order: data.treasuries.map((t) => t.id),
                  }),
                  amountCents: null,
                  date: today,
                  reference: '',
                })
              }
            >
              Guardar y pagar…
            </Button>
          ) : null}
          <Button
            type="submit"
            className="h-11 min-w-[160px] md:h-9"
            disabled={posting.pending || attaching}
          >
            {posting.pending ? 'Guardando…' : attaching ? 'Subiendo el comprobante…' : submitLabel}
          </Button>
        </div>
        <p className="hidden text-right text-[11px] text-muted-foreground lg:block">
          ⌘↵ guarda · ⇧⌘↵ guarda y deja la {title} vacía para cargar otra
        </p>
      </form>

      <aside className="hidden lg:sticky lg:top-20 lg:block">{previewCard}</aside>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onConfirm={posting.confirmWarnings}
        onCancel={posting.dismissWarnings}
      />
    </div>
  )
}
