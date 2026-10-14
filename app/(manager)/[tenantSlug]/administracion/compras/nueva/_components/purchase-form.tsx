'use client'

import { Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import {
  PAPER_OPTIONS,
  paperConsequence,
  recoveredVatFromPreview,
  recoversVat,
  ticketTotalLabel,
} from '@/components/administracion/acciones/gasto-papel'
import {
  PaperChoices,
  TreasuryAfterHint,
  TreasuryAfterLine,
} from '@/components/administracion/acciones/gasto-piezas'
import { ADD_LINK, BIG_MONEY_FIELD } from '@/components/administracion/acciones/sheet-parts'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { AttachmentPicker } from '@/components/administracion/adjuntos/attachment-picker'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
import { DateField } from '@/components/administracion/date-input'
import {
  CategoryPicker,
  categoryOptions,
  categoryShortName,
  featuredCategories,
  StepCard,
  Term,
  topCategories,
} from '@/components/administracion/kit'
import { MoneyField } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { postPurchase, postPurchaseCreditNote } from '@/lib/accounting/actions/documents'
import { saveParty } from '@/lib/accounting/actions/master'
import { suggestDueDate } from '@/lib/accounting/defaults'
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
import { formatDayMonth, formatIsoDay, formatMonthYear, formatWeekdayDayMonth } from '@/lib/dates'
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
import { SupplierInvoicingAsk } from '../../_components/supplier-invoicing-ask'
import { type SavedState, useDocumentPosting } from '../../_components/use-document-posting'
import {
  padNumber,
  padPos,
  VoucherNumberInput,
  type VoucherNumberValue,
  voucherPart,
} from '../../_components/voucher-number-input'
import { isPurchaseImputation, isQuickExpenseAccount } from '../../_lib/accounts'
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
  asksDue,
  asksPaper,
  conditionNoun,
  type DueChoice,
  dueChoices,
  dueLine,
  dueSameDayWarning,
  INVOICING_CHOICES,
  initialPayNow,
  invoiceLetterChoices,
  invoicingGap,
  newPartyTermToSend,
  otherPaperTypes,
  paperLine,
  paperOfVoucher,
  purchaseDraftMissing,
  purchaseOutcomeNote,
  purchaseStamp,
  purchaseStepStates,
  purchaseSubmitLabel,
  purchaseTotalLabel,
  voucherForPaper,
} from '../../_lib/purchase-paper'
import {
  detailRoom,
  type QuickVoucher,
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
  type PurchaseFamily,
  rememberedVoucherType,
  voucherOptionsFor,
} from '../../_lib/vouchers'
import {
  DueChips,
  PayWhenCards,
  RecurringLinked,
  RecurringOffers,
  STEP_LINK,
  STEP_QUESTION,
  StepField,
  SupplierPicked,
  TicketBar,
} from './purchase-steps'
import { PurchaseTicket, type PurchaseTicketRow } from './purchase-ticket'

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
/** Las alícuotas de todos los días; las otras tres van detrás de «Otra». */
const MAIN_RATES = [2100, 1050, 2700] as const satisfies readonly VatRateBp[]
const OTHER_RATES = [500, 250, 0] as const satisfies readonly VatRateBp[]

/** Cuántos proveedores van como atajo en «Los que más usás». */
const MAX_PARTY_CHIPS = 6
/** Hasta cuántas compras para corregir van como chips; con más, el desplegable. */
const MAX_RELATED_CHIPS = 6
const NO_RELATED = '__ninguna__'

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

const FAMILY_WORDS: Readonly<Record<PurchaseFamily, string>> = {
  factura: 'una compra',
  nc: 'una nota de crédito',
  nd: 'una nota de débito',
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/**
 * «Cargar una compra que debo» (y la nota de crédito o de débito de un
 * proveedor): escribir un renglón en su libreta. Una pantalla con cuatro
 * secciones numeradas, todas abiertas, que se van tildando solas:
 *
 *   ① ¿A quién le compraste?  ② ¿Qué papel te dieron?  ③ ¿Cuánto es?  ④ ¿Cuándo le pagás?
 *
 * y, al costado, el ticket que se arma con lo que se va contestando («Le vas a
 * deber $ 120.000 · vence el 30/10»). El orden es el de la receta de la guía.
 *
 * Es la MISMA carga de antes: mismo estado, mismas validaciones y el mismo
 * envío (`buildPurchaseValues` → `postPurchase` / `postPurchaseCreditNote`). Lo
 * que cambió es cómo se pregunta: los cuatro papeles de «Nuevo gasto» en vez de
 * un sí/no de si se factura + un desplegable de once tipos, chips para el
 * vencimiento, «Ya lo pagué» en vez del botón de guardar y pagar, y el asiento
 * plegado detrás de
 * «Ver cómo queda en los libros».
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
  // «¿En qué le comprás?» como botones: las categorías pensadas para compras.
  const categories = useMemo(() => {
    const quick = new Set(data.accounts.filter(isQuickExpenseAccount).map((a) => a.id))
    const featured = featuredCategories(data.accounts)
    // «Las que más usás»: las de los atajos de siempre (lo último que se cargó).
    const usage = new Map<string, number>()
    for (const s of data.suggestions) usage.set(s.accountId, (usage.get(s.accountId) ?? 0) + 1)
    return {
      options: categoryOptions(data.accounts, (id) => quick.has(id)),
      featured,
      pinned: topCategories(usage, 6, new Set(featured)),
    }
  }, [data.accounts, data.suggestions])
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

  // ── Lo que es solo de la pantalla (no viaja) ──
  /** La tarjeta que se tocó y no entra con lo que sabemos del proveedor: abre «¿Cómo te factura?». */
  const [askingPaper, setAskingPaper] = useState<QuickVoucher | null>(null)
  /** La tarjeta que queda marcada cuando lleguen las opciones nuevas (la ficha ya se guardó). */
  const pendingPaper = useRef<QuickVoucher | null>(null)
  /** «Es otro papel»: el desplegable con lo que no es ninguna de las cuatro tarjetas. */
  const [otherPaper, setOtherPaper] = useState(false)
  /** «Ver el plan completo» de la categoría. */
  const [fullPlan, setFullPlan] = useState(false)
  /** «Otra» alícuota de IVA y el ajuste de centavos, plegados. */
  const [moreVat, setMoreVat] = useState(false)
  const [showVatAdjust, setShowVatAdjust] = useState(false)
  /** «Otra fecha» de vencimiento: el campo abierto. */
  const [dueOther, setDueOther] = useState(false)
  /** La persona tocó cuándo vence (solo importa con `ASK_WHEN_UNKNOWN`). */
  const [dueTouched, setDueTouched] = useState(false)
  /** «Pagué solo una parte» y el n.º de transferencia, plegados. */
  const [payPartial, setPayPartial] = useState(false)
  const [showPayReference, setShowPayReference] = useState(false)
  /** «Cargar otra después»: lo que antes solo se podía con ⇧⌘↵. */
  const [another, setAnother] = useState(false)
  /** Guardando «Pagarle siempre a N días» en la ficha. */
  const [savingTerm, setSavingTerm] = useState(false)
  /** El sello entra de nuevo cada vez que la persona toca un papel. */
  const [stampNonce, setStampNonce] = useState(0)
  /** El ticket en una hoja (celular y pantallas angostas). */
  const [ticketOpen, setTicketOpen] = useState(false)

  // «Completar con ARCA» del proveedor nuevo (diseño §3.1).
  const newParty = party?.kind === 'new' ? party : null
  const arca = useArcaLookup({
    tenantSlug,
    purpose: 'supplier',
    cuit: newParty?.taxId ?? '',
    values: { name: newParty?.name ?? '', ivaCondition: newParty?.ivaCondition ?? null },
    spec: {
      ivaOptions: INVOICING_CHOICES.map((c) => c.value),
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
      : family === 'nd'
        ? 'purchase_debit_note'
        : 'purchase'
  const isCreditNote = docKind === 'purchase_credit_note'
  const numbered = voucherType ? VOUCHER_CATALOG[voucherType].numbered : true
  const vat = discriminatesVat(voucherType)

  // ── Los cuatro papeles (solo compras; una nota siempre lleva su letra y un organismo, su boleta) ──
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
  const paper = paperOfVoucher(voucherType)
  const otherTypes = otherPaperTypes(voucherOptions)
  // Un exento puede dar B o C: la tarjeta escribe una y acá se elige la otra.
  const letterChoices = invoiceLetterChoices(voucherOptions)

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
    // Con `ASK_WHEN_UNKNOWN` (apagado), de quien no sabemos cómo factura no se propone nada.
    const next = asksPaper({ condition, remembered: rememberedVoucher })
      ? null
      : defaultVoucherFor({
          family,
          options: voucherOptions,
          remembered: rememberedVoucher,
          condition,
        })
    if (next !== voucherType) setVoucherType(next)
  }, [voucherOptions, family, rememberedVoucher, condition, voucherType])

  // La ficha del proveedor ya dice cómo factura: queda marcada la tarjeta que la persona tocó.
  // Va DESPUÉS del efecto de arriba a propósito: si los dos escriben, gana lo que tocó.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando llegan opciones nuevas
  useEffect(() => {
    const wanted = pendingPaper.current
    if (wanted === null) return
    const type = voucherForPaper(wanted, {
      options: voucherOptions,
      remembered: rememberedVoucher,
      condition,
    })
    if (type === null) return
    pendingPaper.current = null
    touched.current.voucher = true
    setAskingPaper(null)
    setVoucherType(type)
    setVatAdjust(0)
    setStampNonce((n) => n + 1)
  }, [voucherOptions])

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
    setFullPlan(false)
    if (touched.current.account) return
    const r = recurringId ? recurringById.get(recurringId) : undefined
    const fromRecurring =
      r !== undefined && (!r.partyId || r.partyId === nextPartyId) && imputable.has(r.accountId)
    setAccountId(fromRecurring ? r.accountId : null)
  }

  const choosePartyId = (id: string | null) => {
    touched.current.voucher = false
    pendingPaper.current = null
    setAskingPaper(null)
    setOtherPaper(false)
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
    // «Cargar otra después» (o ⇧⌘↵): queda vacía para cargar otra del mismo proveedor (uno
    // nuevo ya quedó creado: se vuelve a elegir de la lista para no crearlo dos veces).
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
    // Lo plegado vuelve a plegarse: la próxima arranca como una compra nueva.
    setPayPartial(false)
    setShowPayReference(false)
    setShowVatAdjust(false)
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

  // Con `ASK_WHEN_UNKNOWN` (apagado): sin plazo, el vencimiento hay que tocarlo.
  const dueAnswered = isCreditNote || payNow !== null || dueTouched || !asksDue({ termDays })

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
    if (!dueAnswered) errors.dueDate = 'Tocá cuándo vence, o «Sin fecha».'
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
    if (!built.values || !preview?.ok || !dueAnswered) {
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
      submit(undefined, event.shiftKey || another)
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
    // Lo que es cierto de cada tipo: el «otro comprobante» lleva número y entra al Libro IVA.
    if (voucherType === 'otro_comprobante') {
      return 'Lleva punto de venta y número, y entra al Libro IVA como «Otro comprobante».'
    }
    if (!voucherType || !condition || notInvoiced) return null
    const check = voucherConditionCheck(voucherType, condition)
    if (check.warnings.includes('voucher_m')) {
      return 'Factura M: puede corresponder retener IVA y Ganancias. Consultalo con la contadora.'
    }
    if (check.warnings.includes('voucher_condition')) {
      // «Con tique…», «Con Factura B…»: el tique va en minúscula, como una palabra más.
      const name = VOUCHER_CATALOG[voucherType].label.replace(/^Tique/, 'tique')
      return `Con ${name} no recuperás el IVA: va todo al costo. Pedí factura A si podés.`
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
  const paying = payNow !== null && !isCreditNote
  const submitLabel = purchaseSubmitLabel({ docKind, paying, totalCents: total })

  // ── Los papeles: tocar una tarjeta escribe un tipo que ya se ofrecía ──
  const writeVoucher = (type: VoucherType) => {
    touched.current.voucher = true
    setVoucherType(type)
    setVatAdjust(0)
    setShowVatAdjust(false)
    posting.clearFieldErrors()
  }
  const choosePaper = (next: QuickVoucher) => {
    const type = voucherForPaper(next, {
      options: voucherOptions,
      remembered: rememberedVoucher,
      condition,
    })
    if (type === null) {
      // No entra con lo que sabemos del proveedor: la compra no cambia hasta resolverlo.
      setAskingPaper(next)
      return
    }
    setAskingPaper(null)
    setOtherPaper(false)
    setStampNonce((n) => n + 1)
    // Tocar la que ya estaba marcada solo confirma.
    if (type === voucherType) {
      touched.current.voucher = true
      return
    }
    writeVoucher(type)
  }
  const partyGap =
    existing && voucherType
      ? invoicingGap({
          paper,
          condition: existing.ivaCondition,
          hasTaxId: Boolean(existing.taxId),
          entersIvaBook: VOUCHER_CATALOG[voucherType].ivaBook,
        })
      : null
  const askedGap =
    existing && askingPaper
      ? invoicingGap({
          paper: askingPaper,
          condition: existing.ivaCondition,
          hasTaxId: Boolean(existing.taxId),
          entersIvaBook: true,
        })
      : null
  // Una nota de un proveedor al que no se le puede cargar ninguna letra: primero, cómo factura.
  const noteGap =
    existing && family !== 'factura' && voucherOptions.length === 0
      ? {
          kind:
            existing.ivaCondition === 'sin_datos' ? ('unknown' as const) : ('mismatch' as const),
          suggest: null,
        }
      : null
  const shownGap = askedGap ?? noteGap ?? partyGap
  // ── El IVA de una Factura A: ¿se recupera?, ¿cuánto? ──
  // La tarjeta lo dice por la regla (el proveedor y el bar son responsables inscriptos); el
  // ticket, por lo que de verdad manda la vista previa a crédito fiscal.
  const canRecover = recoversVat({ condition, sasCondition: data.ctx.settings.ivaCondition })
  const previewVat = preview?.ok
    ? recoveredVatFromPreview(preview.preview, data.ctx.sys.vat_credit.id)
    : 0
  const recovers = preview?.ok ? previewVat > 0 : canRecover

  // ── ¿Cuándo vence? ──
  // Un proveedor nuevo todavía no tiene un «como siempre»: su plazo lo deja el tilde de abajo.
  const dueOptions = dueChoices({
    issueDate,
    dueDate,
    termDays: party?.kind === 'new' ? 0 : termDays,
    suggestedTermDays: defaults?.suggestedTermDays ?? null,
    answered: dueAnswered,
  })
  const activeDue = dueOptions.find((c) => c.active) ?? null
  const showDueField = dueOther || activeDue?.key === 'other'
  const pickDue = (choice: DueChoice) => {
    touched.current.due = true
    setDueTouched(true)
    posting.clearFieldErrors()
    if (choice.value === undefined) {
      // «Otra fecha»: abre el campo; la fecha la escribe la persona.
      setDueOther(true)
      if (party?.kind === 'new') setParty({ ...party, paymentTermDays: 0 })
      requestAnimationFrame(() => document.getElementById(ids('dueDate'))?.focus())
      return
    }
    setDueOther(false)
    setDueDate(choice.value)
    // Proveedor nuevo: «En 7 días» deja tildado «Pagarle siempre a 7 días» (se puede destildar).
    if (party?.kind === 'new') {
      const days = choice.key !== 'same' && choice.days && choice.days > 0 ? choice.days : 0
      setParty({ ...party, paymentTermDays: days })
    }
  }
  // «Pagarle siempre a N días»: con un plazo tocado y un proveedor que todavía no tiene el suyo.
  const offeredTerm =
    !paying && activeDue?.days && activeDue.days > 0 && activeDue.key !== 'term'
      ? activeDue.days
      : null
  // Proveedor nuevo: su plazo solo viaja mientras el tilde «Pagarle siempre a N días» está a
  // la vista. Si deja de verse (pasó a «Ya lo pagué», cambió la fecha del papel) vuelve a 0:
  // no se le guarda en la ficha un plazo que la persona ya no tiene adelante.
  useEffect(() => {
    if (party?.kind !== 'new') return
    const kept = newPartyTermToSend(party.paymentTermDays, offeredTerm)
    if (kept !== party.paymentTermDays) setParty({ ...party, paymentTermDays: kept })
  }, [party, offeredTerm])
  const saveTerm = async (days: number) => {
    if (!existing || savingTerm) return
    setSavingTerm(true)
    try {
      const result = await saveParty(tenantSlug, {
        id: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        kind: existing.kind,
        name: existing.name,
        paymentTermDays: days,
      })
      if (!result.ok) {
        toast.error(
          result.code === 'stale'
            ? 'Alguien cambió a este proveedor recién. Probá de nuevo.'
            : result.message,
        )
        if (result.code === 'stale') router.refresh()
        return
      }
      toast.success(`Listo: a ${supplierName} le pagás a ${days} días.`)
      router.refresh()
    } catch {
      toast.error(ACC_UNREACHABLE.offline)
    } finally {
      setSavingTerm(false)
    }
  }

  // ── ¿Cuándo le pagás? ──
  const setPaying = (next: boolean) => {
    posting.clearFieldErrors()
    if (!next) {
      setPayNow(null)
      return
    }
    if (payNow) return
    // El mismo pago que armaba el botón de guardar y pagar de antes.
    setPayNow(
      initialPayNow({
        treasuries: data.treasuries,
        lastUsedWithParty: defaults?.treasuryAccountId ?? null,
        today,
      }),
    )
  }
  const payTreasury = payNow?.treasuryAccountId
    ? (data.treasuries.find((t) => t.id === payNow.treasuryAccountId) ?? null)
    : null

  // ── El ticket: lo que va a pasar, en palabras ──
  const supplierShown =
    party?.kind === 'new' ? party.name.trim() || null : existing ? supplierName : null
  const priorDebt =
    existing && data.balances
      ? (data.balances.find((b) => b.partyId === existing.id)?.debtCents ?? null)
      : null
  const stamp = purchaseStamp(voucherType)
  const hasNumber = !numbered || (pos !== null && number !== null)
  const partyDone =
    party !== null && accountId !== null && (party.kind !== 'new' || party.name.trim().length >= 2)
  const paperDone = voucherType !== null && hasNumber && issueDate !== null
  const amountDone = total !== null && total > 0
  const extrasCents = [
    percIvaCents,
    percIibbCents,
    percGananciasCents,
    otherTaxesCents,
  ].reduce<number>((sum, c) => sum + (c && c > 0 ? c : 0), 0)
  const draftMissing =
    purchaseDraftMissing({
      party: party === null || (party.kind === 'new' && party.name.trim().length < 2),
      account: accountId === null,
      paper: voucherType === null,
      number: voucherType !== null && !hasNumber,
      total: total === null || total <= 0,
    }) ?? (entries.length === 0 ? 'Todavía falta completar un dato.' : null)
  // El borrador no afirma lo que nadie eligió: sin proveedor y sin tocar un papel, el que
  // se ve es solo el que propone el sistema (el valor por defecto no cambia; se ve apagado).
  const paperProposed = party === null && stampNonce === 0
  const ticketTotalCents = paying ? payAmount : total
  // Como un tique de verdad (la regla del ticket del cierre): si algún importe tiene
  // centavos, los llevan todos; si son todos redondos, ninguno.
  const showsSplit = vat && split !== null
  const showsDetail = vat && !showsSplit && amountMode === 'detail' && detail.totalCents > 0
  const ticketWithCents = [
    showsSplit ? (split?.netCents ?? 0) : 0,
    showsSplit ? (split?.vatCents ?? 0) : 0,
    showsDetail ? detail.netCents : 0,
    showsDetail ? detail.vatCents : 0,
    extrasCents,
    ticketTotalCents ?? 0,
  ].some((cents) => cents % 100 !== 0)
  const ticketMoney = (cents: number) => formatCents(cents, { decimals: ticketWithCents ? 2 : 0 })
  const ticketRows: PurchaseTicketRow[] = [
    {
      key: 'papel',
      label: 'Papel',
      value:
        paperLine({
          voucherType,
          pos: voucherNumber.pos,
          number: voucherNumber.number,
          remito,
        }) ?? '—',
      muted: paperProposed,
    },
    { key: 'en-que', label: 'En qué', value: accountName ? categoryShortName(accountName) : '—' },
  ]
  if (vat && split) {
    ticketRows.push(
      { key: 'neto', label: 'Neto', value: ticketMoney(split.netCents) },
      {
        key: 'iva',
        label: `IVA ${vatRateLabel(vatRateBp)}`,
        hint: recovers ? 'Lo recuperás' : 'Va al costo',
        value: ticketMoney(split.vatCents),
      },
    )
  } else if (showsDetail) {
    ticketRows.push(
      { key: 'neto', label: 'Neto', value: ticketMoney(detail.netCents) },
      {
        key: 'iva',
        label: 'IVA',
        hint: recovers ? 'Lo recuperás' : 'Va al costo',
        value: ticketMoney(detail.vatCents),
      },
    )
  }
  if (extrasCents > 0) {
    ticketRows.push({
      key: 'extras',
      label: 'Percepciones e impuestos',
      value: ticketMoney(extrasCents),
    })
  }
  if (linkedRecurring) {
    ticketRows.push({ key: 'fijo', label: 'Gasto fijo', value: linkedRecurring.name })
  }
  const totalLabel =
    paying && payTreasury ? ticketTotalLabel(payTreasury) : purchaseTotalLabel({ docKind, paying })
  const ticketNote =
    draftMissing ??
    purchaseOutcomeNote({
      docKind,
      supplier: supplierShown ?? 'el proveedor',
      voucherType,
      totalCents: total ?? 0,
      paidCents: paying ? (payAmount ?? 0) : null,
      priorDebtCents: priorDebt,
    })
  const ticketSubtitle = `${
    isCreditNote
      ? 'Nota de crédito'
      : docKind === 'purchase_debit_note'
        ? 'Nota de débito'
        : 'Compra'
  }${issueDate ? ` del ${formatWeekdayDayMonth(issueDate)}` : ''}`
  const ticket = (books: boolean) => (
    <PurchaseTicket
      supplier={supplierShown}
      subtitle={ticketSubtitle}
      stamp={stamp}
      stampNonce={stampNonce}
      stampDraft={paperProposed}
      rows={ticketRows}
      totalLabel={totalLabel}
      totalCents={ticketTotalCents}
      withCents={ticketWithCents}
      totalHint={
        isCreditNote ? undefined : paying ? (
          payTreasury ? (
            <TreasuryAfterHint treasury={payTreasury} amountCents={payAmount} />
          ) : undefined
        ) : // «Vence el…» recién cuando hay un importe que venza.
        dueAnswered && amountDone ? (
          dueLine(dueDate)
        ) : undefined
      }
      note={ticketNote}
      pending={draftMissing !== null}
      entries={entries}
      books={books}
    />
  )

  // ── Las cuatro secciones: cuál ya está ──
  // «¿Cuándo le pagás?» llega contestada de fábrica («lo debo», vence el mismo día): se da por
  // hecha recién cuando las tres de antes lo están. Si no, el paso a paso arrancaba con el
  // último paso tildado.
  const payDone =
    (paying ? payNow?.treasuryAccountId != null : dueAnswered) &&
    partyDone &&
    paperDone &&
    amountDone
  const [partyState, paperState, amountState, payState] = purchaseStepStates(
    isCreditNote ? [partyDone, paperDone, amountDone] : [partyDone, paperDone, amountDone, payDone],
  )
  const partyChips = data.suggestions
    .filter((s) => s.type === 'party' && s.partyId !== null)
    .flatMap((s) => {
      const p = s.partyId ? partyById.get(s.partyId) : undefined
      return p?.active && PURCHASE_PARTY_KINDS.has(p.kind) ? [p] : []
    })
    .filter((p, index, list) => list.findIndex((other) => other.id === p.id) === index)
    .slice(0, MAX_PARTY_CHIPS)

  const startNewParty = (name: string) => {
    touched.current.voucher = false
    pendingPaper.current = null
    setAskingPaper(null)
    setOtherPaper(false)
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
  }
  const switchFamily = (next: PurchaseFamily) => {
    touched.current.voucher = false
    pendingPaper.current = null
    setAskingPaper(null)
    setOtherPaper(false)
    setVoucherType(null)
    setFamily(next)
    if (next === 'nc') setPayNow(null)
    posting.clearFieldErrors()
  }

  const voucherSelect = (types: readonly VoucherType[], label: string) => (
    <StepField
      id={ids('voucherType')}
      label={label}
      required
      error={errors.voucherType}
      hint={voucherHint ?? undefined}
    >
      {/* Siempre controlado (`''` = sin elegir): con `undefined` el `<select>` oculto de
          Radix dispara `onValueChange('')` al volver a «sin tipo» (proveedor nuevo,
          otra familia) y el render se rompía con un tipo que no existe. */}
      <Select
        value={voucherType !== null && types.includes(voucherType) ? voucherType : ''}
        onValueChange={(v) => {
          if (!isVoucherType(v)) return
          setStampNonce((n) => n + 1)
          writeVoucher(v)
        }}
      >
        <SelectTrigger
          id={ids('voucherType')}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
          aria-invalid={errors.voucherType ? true : undefined}
        >
          <SelectValue placeholder="Elegí el papel" />
        </SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t} value={t} className="min-h-11 md:min-h-8">
              {VOUCHER_CATALOG[t].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </StepField>
  )

  return (
    <>
      <form ref={formRef} onSubmit={(e) => submit(e, another)} onKeyDown={onFormKeyDown} noValidate>
        {/* Dos columnas recién con lugar para las dos (`xl`): el ticket mide 22rem y, con el
            menú abierto, antes de eso la columna de preguntas quedaba más angosta que un
            celular. Más abajo, una columna y el ticket detrás de «Ver ticket». */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="@container min-w-0 space-y-4 sm:space-y-5">
            {/* ── 1 · A quién ── */}
            <StepCard
              open
              n={1}
              id="paso-1"
              state={partyState ?? 'current'}
              title="¿A quién le compraste?"
              summary={
                partyDone && supplierShown
                  ? `${supplierShown}${accountName ? ` · ${categoryShortName(accountName)}` : ''}`
                  : 'Elegilo de tu libreta o creálo acá: después le cargás de un toque.'
              }
            >
              <div className="grid gap-4">
                {party?.kind === 'new' ? (
                  <div className="grid gap-4 rounded-xl bg-secondary/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className={STEP_QUESTION}>Proveedor nuevo</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-mr-1.5 h-11 gap-1.5 text-muted-foreground md:h-8"
                        onClick={() => setParty(null)}
                      >
                        <X className="size-3.5" aria-hidden />
                        Elegir uno que ya está
                      </Button>
                    </div>
                    <StepField
                      id={ids('np-name')}
                      label="¿Cómo se llama?"
                      required
                      hint="La razón social, como figura en sus papeles."
                      error={errors.newPartyName}
                    >
                      <Input
                        id={ids('np-name')}
                        value={party.name}
                        maxLength={120}
                        autoComplete="off"
                        aria-invalid={errors.newPartyName ? true : undefined}
                        onChange={(e) => setParty({ ...party, name: e.target.value })}
                        className="h-11 text-base md:h-10 md:text-sm"
                      />
                    </StepField>
                    <div className="grid gap-1.5">
                      <span id={ids('np-cond')} className="text-sm font-medium leading-none">
                        ¿Cómo te factura?
                      </span>
                      <RadioChips
                        labelledBy={ids('np-cond')}
                        value={party.ivaCondition}
                        options={ivaOptionsWith(INVOICING_CHOICES, party.ivaCondition)}
                        onChange={(next) => {
                          touched.current.voucher = false
                          setVoucherType(null)
                          setNewPartyIvaTouched(true)
                          setAskingPaper(null)
                          setParty({ ...party, ivaCondition: next })
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {INVOICING_CHOICES.find((c) => c.value === party.ivaCondition)?.hint ??
                          'Si no sabés, mirá la letra de su factura.'}
                      </p>
                    </div>
                    <StepField
                      id={ids('np-cuit')}
                      label="Su CUIT"
                      required={voucherType !== null && VOUCHER_CATALOG[voucherType].ivaBook}
                      optional={!(voucherType !== null && VOUCHER_CATALOG[voucherType].ivaBook)}
                      hint="Poné el CUIT y traemos el resto. Con remito, podés dejarlo vacío."
                      error={errors.newPartyTaxId}
                    >
                      <ArcaLookupTrigger lookup={arca}>
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
                            if (digits.length === 11) {
                              setParty({ ...party, taxId: formatCuit(digits) })
                            }
                          }}
                          className="h-11 max-w-56 text-base tabular-nums placeholder:text-muted-foreground/50 md:h-10 md:text-sm"
                        />
                      </ArcaLookupTrigger>
                    </StepField>
                    <ArcaLookupPanel lookup={arca} />
                  </div>
                ) : existing ? (
                  <SupplierPicked
                    name={
                      existing.tradeName && existing.tradeName !== existing.name
                        ? `${existing.tradeName} (${existing.name})`
                        : existing.name
                    }
                    detail={[
                      existing.ivaCondition === 'sin_datos'
                        ? null
                        : CONDITION_LABELS[existing.ivaCondition],
                      existing.taxId ? `CUIT ${formatCuit(existing.taxId)}` : null,
                      existing.paymentTermDays > 0
                        ? `Le pagás a ${existing.paymentTermDays} días`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    debtCents={priorDebt}
                    onChange={() => choosePartyId(null)}
                  />
                ) : (
                  <div className="grid gap-3">
                    {partyChips.length > 0 ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Los que más usás
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {partyChips.map((p) => (
                            <Button
                              key={p.id}
                              type="button"
                              variant="outline"
                              className="h-11 max-w-full rounded-full px-4 md:h-9"
                              onClick={() => choosePartyId(p.id)}
                            >
                              <span className="truncate">{p.tradeName ?? p.name}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <StepField
                      id={ids('party')}
                      label={partyChips.length > 0 ? 'O buscalo' : 'Proveedor'}
                      required
                      error={errors.party}
                      hint="Buscá por nombre o CUIT. Si no está, creálo desde acá."
                    >
                      <PartyCombobox
                        id={ids('party')}
                        value={null}
                        onValueChange={(id) => choosePartyId(id)}
                        parties={partyOptions}
                        onCreate={startNewParty}
                        invalid={Boolean(errors.party)}
                        aria-describedby={`${ids('party')}-hint`}
                      />
                    </StepField>
                  </div>
                )}

                {/* ¿Es un gasto fijo? (solo si el gasto fijo es de ese proveedor) */}
                {linkedRecurring ? (
                  <RecurringLinked
                    name={linkedRecurring.name}
                    onClear={() => setRecurringId(null)}
                  />
                ) : isCreditNote ? null : (
                  <RecurringOffers
                    options={pendingRecurring}
                    onPick={(id) => {
                      const r = recurringById.get(id)
                      if (!r) return
                      setRecurringId(r.id)
                      if (totalCents === null && r.amountCents !== null && amountMode === 'total') {
                        setTotalCents(r.amountCents)
                      }
                      // El gasto fijo trae su cuenta, salvo que la persona ya haya elegido otra.
                      if (!touched.current.account && imputable.has(r.accountId)) {
                        setAccountId(r.accountId)
                      }
                    }}
                  />
                )}

                {/* La categoría: de la ficha del proveedor, o se pregunta */}
                {party === null ? null : accountMode === 'fixed' && accountName ? (
                  <SupplierAccountLine
                    accountName={accountName}
                    className="text-sm"
                    onChange={() => {
                      setAccountChanging(true)
                      requestAnimationFrame(() => document.getElementById(ids('account'))?.focus())
                    }}
                  />
                ) : (
                  <div className="grid gap-2.5">
                    <p id={ids('account-label')} className={STEP_QUESTION}>
                      ¿En qué le comprás?
                      <span aria-hidden="true" className="ml-0.5 text-destructive">
                        *
                      </span>
                    </p>
                    <CategoryPicker
                      id={ids('account')}
                      aria-labelledby={ids('account-label')}
                      options={categories.options}
                      featured={categories.featured}
                      pinned={categories.pinned}
                      value={accountId}
                      outside={
                        accountId &&
                        accountName &&
                        !categories.options.some((o) => o.id === accountId)
                          ? { id: accountId, name: accountName }
                          : null
                      }
                      invalid={Boolean(errors.account)}
                      onChange={(next) => {
                        touched.current.account = true
                        setAccountId(next)
                        posting.clearFieldErrors()
                      }}
                      onOpenFullPlan={() => setFullPlan(true)}
                    />
                    {fullPlan ? (
                      <div className="grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                        <p className="text-xs text-muted-foreground">
                          El plan completo, para una cuenta que no está entre los botones.
                        </p>
                        <AccountCombobox
                          id={ids('account-plan')}
                          aria-label="Buscar en el plan completo"
                          value={accountId}
                          onValueChange={(next) => {
                            touched.current.account = true
                            setAccountId(next)
                            posting.clearFieldErrors()
                          }}
                          accounts={accountOptions}
                          placeholder="Buscar una cuenta"
                        />
                      </div>
                    ) : null}
                    {errors.account ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.account}
                      </p>
                    ) : null}
                    {accountChanging && defaultAccountId !== null ? (
                      <p className="text-xs text-muted-foreground text-pretty">
                        Solo para esta compra: la categoría habitual de {supplierName} no cambia.{' '}
                        <button
                          type="button"
                          onClick={() => {
                            touched.current.account = false
                            setAccountChanging(false)
                            setFullPlan(false)
                            setAccountId(defaultAccountId)
                            posting.clearFieldErrors()
                          }}
                          className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Usar la habitual
                        </button>
                      </p>
                    ) : null}
                    {accountMode === 'ask-remember' ? (
                      <RememberAccountCheckbox
                        id={ids('remember')}
                        partyName={supplierName}
                        checked={rememberAccount}
                        onCheckedChange={setRememberAccount}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </StepCard>

            {/* ── 2 · El papel ── */}
            <StepCard
              open
              n={2}
              id="paso-2"
              state={paperState ?? 'todo'}
              title="¿Qué papel te dieron?"
              summary={
                paperDone
                  ? `${
                      paperLine({
                        voucherType,
                        pos: voucherNumber.pos,
                        number: voucherNumber.number,
                        remito,
                      }) ?? ''
                    }${issueDate ? ` · del ${formatDayMonth(issueDate)}` : ''}`
                  : family === 'factura'
                    ? 'Tocá el que tenés en la mano. Con factura o sin factura, todo queda registrado en los libros.'
                    : // «Estás cargando una nota de crédito» ya lo dice el pie de la sección.
                      'La letra, el número y la fecha, como figuran en el papel.'
              }
            >
              <div className="grid gap-4">
                {/* La foto primero: el resto se completa con el papel a la vista. */}
                <AttachmentPicker
                  value={files}
                  onChange={setFiles}
                  label="Sacale una foto al papel"
                  disabled={posting.pending || attaching}
                />

                {family === 'factura' ? (
                  askInvoiced ? (
                    <div className="grid gap-2.5">
                      {existing?.ivaCondition === 'sin_datos' ? (
                        <p className="text-sm text-muted-foreground text-pretty">
                          Todavía no sabemos qué papel te da {supplierName}: tocá el que tenés en la
                          mano.
                        </p>
                      ) : null}
                      <span id={ids('paper-label')} className="sr-only">
                        ¿Qué papel te dieron?
                      </span>
                      <PaperChoices
                        name={ids('paper')}
                        labelledBy={ids('paper-label')}
                        // Con «¿Cómo te factura?» abierto queda marcada la que se tocó.
                        value={askedGap ? askingPaper : paper}
                        onPick={choosePaper}
                        consequenceFor={(option) =>
                          paperConsequence(option, {
                            selected: paper,
                            recovers: canRecover,
                            recoveredVatCents:
                              paper === 'a' && canRecover
                                ? previewVat > 0
                                  ? previewVat
                                  : (split?.vatCents ?? null)
                                : null,
                          })
                        }
                      />
                      {errors.voucherType && !otherPaper ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors.voucherType}
                        </p>
                      ) : null}
                      {voucherHint && paper !== null ? (
                        <p className="text-xs text-muted-foreground text-pretty">{voucherHint}</p>
                      ) : null}

                      {/* Un exento da B o C: la tarjeta marcó una; acá se elige la que es. */}
                      {paper === 'bc' && !askedGap && letterChoices.length > 0 ? (
                        <div className="grid gap-1.5">
                          <span id={ids('bc-letter')} className="text-sm font-medium leading-none">
                            ¿Es B o C?
                          </span>
                          <RadioChips
                            labelledBy={ids('bc-letter')}
                            value={voucherType}
                            options={letterChoices.map((t) => ({
                              value: t,
                              label: VOUCHER_CATALOG[t].label,
                            }))}
                            onChange={(t) => {
                              if (t === voucherType) return
                              setStampNonce((n) => n + 1)
                              writeVoucher(t)
                            }}
                          />
                        </div>
                      ) : null}

                      {/* Un proveedor nuevo: lo que contestó en ① no coincide con el papel. */}
                      {askingPaper && party?.kind === 'new' ? (
                        <InlineNotice
                          action={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 md:h-8"
                              onClick={() => {
                                pendingPaper.current = askingPaper
                                setNewPartyIvaTouched(true)
                                setParty({ ...party, ivaCondition: 'responsable_inscripto' })
                              }}
                            >
                              Es responsable inscripto
                            </Button>
                          }
                        >
                          Dijiste que es {conditionNoun(party.ivaCondition)}, y así no da{' '}
                          {PAPER_OPTIONS.find((o) => o.value === askingPaper)?.title ?? 'ese papel'}
                          .
                        </InlineNotice>
                      ) : null}

                      {otherPaper || (voucherType !== null && paper === null) ? (
                        <div className="grid gap-2 rounded-xl bg-secondary/50 p-3.5">
                          {voucherSelect(otherTypes, 'Otro papel')}
                          <button
                            type="button"
                            className={cn(STEP_LINK, 'justify-self-start')}
                            onClick={() => {
                              setOtherPaper(false)
                              if (paper === null) {
                                // Vuelve a lo que propone el sistema para ese proveedor.
                                touched.current.voucher = false
                                setVoucherType(null)
                              }
                            }}
                          >
                            Es uno de los cuatro de arriba
                          </button>
                        </div>
                      ) : otherTypes.length > 0 ? (
                        <button
                          type="button"
                          className={cn(STEP_LINK, 'justify-self-start')}
                          onClick={() => {
                            setOtherPaper(true)
                            setAskingPaper(null)
                          }}
                        >
                          <Plus className="size-3.5" aria-hidden />
                          Es otro papel
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    // Un organismo: no hay cuatro papeles, se elige el comprobante.
                    voucherSelect(voucherOptions, '¿Qué comprobante es?')
                  )
                ) : voucherOptions.length > 0 ? (
                  <div className="grid gap-2">
                    <span id={ids('letter')} className={STEP_QUESTION}>
                      ¿Qué letra tiene?
                      <span aria-hidden="true" className="ml-0.5 text-destructive">
                        *
                      </span>
                    </span>
                    <RadioChips
                      labelledBy={ids('letter')}
                      value={voucherType}
                      invalid={Boolean(errors.voucherType)}
                      options={voucherOptions.map((t) => ({
                        value: t,
                        label: VOUCHER_CATALOG[t].label,
                      }))}
                      onChange={(t) => {
                        setStampNonce((n) => n + 1)
                        writeVoucher(t)
                      }}
                    />
                    {errors.voucherType ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.voucherType}
                      </p>
                    ) : null}
                    {voucherHint ? (
                      <p className="text-xs text-muted-foreground text-pretty">{voucherHint}</p>
                    ) : null}
                  </div>
                ) : null}

                {/* Lo que falta saber del proveedor para cargarle ese papel */}
                {existing && shownGap ? (
                  <SupplierInvoicingAsk
                    key={`${existing.id}:${shownGap.kind}:${askingPaper ?? ''}`}
                    tenantSlug={tenantSlug}
                    party={existing}
                    gap={shownGap}
                    paper={askingPaper ?? paper}
                    onSaved={() => {
                      // La tarjeta que tocó queda marcada cuando lleguen las opciones nuevas.
                      pendingPaper.current = askingPaper
                      router.refresh()
                    }}
                    onCancel={askedGap ? () => setAskingPaper(null) : undefined}
                  />
                ) : null}

                {/* Nota de crédito: qué compra corrige */}
                {isCreditNote ? (
                  <div className="grid gap-2">
                    <span id={ids('related')} className={STEP_QUESTION}>
                      ¿Qué compra corrige?
                    </span>
                    {relatedOptions.length <= MAX_RELATED_CHIPS ? (
                      <RadioChips
                        labelledBy={ids('related')}
                        value={relatedDocumentId ?? NO_RELATED}
                        invalid={Boolean(errors.related)}
                        options={[
                          ...relatedOptions.map((o) => ({ value: o.documentId, label: o.label })),
                          { value: NO_RELATED, label: 'Ninguna en particular' },
                        ]}
                        onChange={(v) => setRelatedDocumentId(v === NO_RELATED ? null : v)}
                      />
                    ) : (
                      <Select
                        value={relatedDocumentId ?? NO_RELATED}
                        onValueChange={(v) => setRelatedDocumentId(v === NO_RELATED ? null : v)}
                      >
                        <SelectTrigger
                          aria-labelledby={ids('related')}
                          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_RELATED} className="min-h-11 md:min-h-8">
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
                    )}
                    <p className="text-xs text-muted-foreground">
                      La nota queda a tu favor y se usa sola en el próximo pago.
                    </p>
                    {errors.related ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.related}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* El número y la fecha del papel */}
                <div className="grid gap-4 @lg:grid-cols-2">
                  {voucherType === null ? null : numbered ? (
                    <StepField
                      id={ids('number')}
                      label="Punto de venta y número"
                      required
                      error={errors.number}
                      hint={
                        lastVoucher
                          ? `La última fue ${lastVoucher}.`
                          : 'Podés pegar «0003-00001290».'
                      }
                    >
                      {/* Los ejemplos van apagados: apurado, el ejemplo parecía un número ya puesto. */}
                      <div className="[&_input]:placeholder:text-muted-foreground/50">
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
                      </div>
                    </StepField>
                  ) : remitoActive ? (
                    <StepField
                      id={ids('remito')}
                      label="N.º de remito"
                      optional
                      hint="Si el papel tiene número, queda anotado en la compra."
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
                        className="h-11 text-base tabular-nums placeholder:text-muted-foreground/50 md:h-10 md:text-sm"
                      />
                    </StepField>
                  ) : null}
                  <DateField
                    id={ids('issueDate')}
                    label="¿De qué fecha es?"
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
                </div>

                {duplicate ? (
                  <InlineNotice
                    action={
                      <Link
                        href={documentHref(tenantSlug, duplicate.documentId)}
                        className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

                {/* Cambiar de familia: una compra, una nota de crédito o una de débito */}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0 text-sm text-muted-foreground">
                  {family === 'factura' ? (
                    <>
                      <span>¿No es una compra?</span>
                      <button
                        type="button"
                        className={STEP_LINK}
                        onClick={() => switchFamily('nc')}
                      >
                        Es una nota de crédito
                      </button>
                      <button
                        type="button"
                        className={STEP_LINK}
                        onClick={() => switchFamily('nd')}
                      >
                        Es una nota de débito
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Estás cargando {FAMILY_WORDS[family]}.</span>
                      <button
                        type="button"
                        className={STEP_LINK}
                        onClick={() => switchFamily('factura')}
                      >
                        Es una compra común
                      </button>
                    </>
                  )}
                </p>
              </div>
            </StepCard>

            {/* ── 3 · Cuánto ── */}
            <StepCard
              open
              n={3}
              id="paso-3"
              state={amountState ?? 'todo'}
              title="¿Cuánto es?"
              summary={
                amountDone && total !== null
                  ? total % 100 === 0
                    ? formatCentsShort(total)
                    : formatCents(total)
                  : 'El total del papel, con IVA y todo.'
              }
            >
              <div className="grid gap-4">
                {amountMode === 'total' ? (
                  <div className="grid gap-3">
                    <MoneyField
                      id={ids('total')}
                      label="Total del papel"
                      required
                      value={totalCents}
                      onValueChange={(cents) => {
                        setTotalCents(cents)
                        posting.clearFieldErrors()
                      }}
                      error={errors.total ?? null}
                      hint="Con IVA y todo: lo que dice «Total»."
                      className={BIG_MONEY_FIELD}
                    />
                    {vat ? (
                      <div className="grid gap-2.5 rounded-xl bg-secondary/50 p-3.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span id={ids('vatRate')} className="text-sm font-medium">
                            IVA del papel
                          </span>
                          <RadioChips
                            labelledBy={ids('vatRate')}
                            value={
                              (MAIN_RATES as readonly number[]).includes(vatRateBp) && !moreVat
                                ? String(vatRateBp)
                                : 'otra'
                            }
                            invalid={Boolean(errors.vatRate)}
                            options={[
                              ...MAIN_RATES.map((r) => ({
                                value: String(r),
                                label: vatRateLabel(r),
                              })),
                              { value: 'otra', label: 'Otra' },
                            ]}
                            onChange={(v) => {
                              if (v === 'otra') {
                                setMoreVat(true)
                                return
                              }
                              setMoreVat(false)
                              setVatRateBp(Number(v) as VatRateBp)
                              setVatAdjust(0)
                            }}
                          />
                        </div>
                        {moreVat || !(MAIN_RATES as readonly number[]).includes(vatRateBp) ? (
                          <RadioChips
                            labelledBy={ids('vatRate')}
                            value={
                              (OTHER_RATES as readonly number[]).includes(vatRateBp)
                                ? String(vatRateBp)
                                : null
                            }
                            options={OTHER_RATES.map((r) => ({
                              value: String(r),
                              label: vatRateLabel(r),
                            }))}
                            onChange={(v) => {
                              setVatRateBp(Number(v) as VatRateBp)
                              setVatAdjust(0)
                            }}
                          />
                        ) : null}
                        {errors.vatRate ? (
                          <p role="alert" className="text-xs text-destructive">
                            {errors.vatRate}
                          </p>
                        ) : null}
                        {split ? (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            Neto {formatCents(split.netCents)} · IVA {formatCents(split.vatCents)}
                          </p>
                        ) : null}
                        {split && vatRateBp !== 0 ? (
                          showVatAdjust || vatAdjust !== 0 ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-muted-foreground">
                                Ajustá el IVA de a un centavo:
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 px-3 tabular-nums md:h-8"
                                aria-label="Restar un centavo al IVA"
                                disabled={vatAdjust <= -VAT_ADJUST_LIMIT}
                                onClick={() =>
                                  setVatAdjust((v) => Math.max(-VAT_ADJUST_LIMIT, v - 1))
                                }
                              >
                                −1¢
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 px-3 tabular-nums md:h-8"
                                aria-label="Sumar un centavo al IVA"
                                disabled={vatAdjust >= VAT_ADJUST_LIMIT}
                                onClick={() =>
                                  setVatAdjust((v) => Math.min(VAT_ADJUST_LIMIT, v + 1))
                                }
                              >
                                +1¢
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={cn(STEP_LINK, 'justify-self-start text-xs')}
                              onClick={() => setShowVatAdjust(true)}
                            >
                              ¿El IVA del papel no coincide por centavos?
                            </button>
                          )
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setAmountMode('detail')
                        posting.clearFieldErrors()
                      }}
                      className={ADD_LINK}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      El papel tiene más renglones
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className={STEP_QUESTION}>Renglón por renglón, como está en el papel</p>
                      <button
                        type="button"
                        className={STEP_LINK}
                        onClick={() => {
                          setAmountMode('total')
                          posting.clearFieldErrors()
                        }}
                      >
                        Volver a cargar solo el total
                      </button>
                    </div>
                    {vat ? (
                      <div className="grid gap-3">
                        {(moreRates ? DETAIL_RATES : MAIN_DETAIL_RATES).map((rate) => {
                          const net = nets[rate] ?? null
                          const adjust = netAdjust[rate] ?? 0
                          const field = `net-${rate}`
                          return (
                            <div
                              key={rate}
                              className="grid gap-2 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @lg:items-start"
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
                                <div className="grid gap-1.5 @lg:pt-[22px]">
                                  <div className="flex h-11 items-center justify-between gap-2 rounded-md bg-secondary/50 px-3 text-sm md:h-10">
                                    <span className="text-muted-foreground">
                                      IVA {vatRateLabel(rate)}
                                    </span>
                                    <span className="tabular-nums">
                                      {net && net > 0
                                        ? formatCents(detailVat(net, rate, adjust))
                                        : '—'}
                                    </span>
                                  </div>
                                  {net && net > 0 ? (
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 px-2 text-xs tabular-nums md:h-7"
                                        aria-label={`Restar un centavo al IVA ${vatRateLabel(rate)}`}
                                        disabled={adjust <= -VAT_ADJUST_LIMIT}
                                        onClick={() =>
                                          setNetAdjust((prev) => ({
                                            ...prev,
                                            [rate]: Math.max(
                                              -VAT_ADJUST_LIMIT,
                                              (prev[rate] ?? 0) - 1,
                                            ),
                                          }))
                                        }
                                      >
                                        −1¢
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 px-2 text-xs tabular-nums md:h-7"
                                        aria-label={`Sumar un centavo al IVA ${vatRateLabel(rate)}`}
                                        disabled={adjust >= VAT_ADJUST_LIMIT}
                                        onClick={() =>
                                          setNetAdjust((prev) => ({
                                            ...prev,
                                            [rate]: Math.min(
                                              VAT_ADJUST_LIMIT,
                                              (prev[rate] ?? 0) + 1,
                                            ),
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
                            className={ADD_LINK}
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
                    <div className="grid gap-3 @lg:grid-cols-3">
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
                {showExtras ||
                percIvaCents ||
                percIibbCents ||
                percGananciasCents ||
                otherTaxesCents ? (
                  <div className="grid gap-3 rounded-xl bg-secondary/50 p-4">
                    <p className={STEP_QUESTION}>
                      <Term name="percepciones" inline>
                        Lo que te cobran de más por impuestos
                      </Term>
                    </p>
                    <div className="grid gap-3 @lg:grid-cols-2">
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
                    <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <MoneyField
                        id={ids('percIibb')}
                        label="Percepción de Ingresos Brutos"
                        optional
                        value={percIibbCents}
                        align="end"
                        onValueChange={setPercIibbCents}
                        error={errors.percIibb ?? null}
                      />
                      <StepField
                        id={ids('percIibbJurisdiction')}
                        label="Provincia"
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
                      </StepField>
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
                  <button type="button" onClick={() => setShowExtras(true)} className={ADD_LINK}>
                    <Plus className="size-3.5" aria-hidden />
                    Tiene percepciones u otros impuestos
                  </button>
                )}

                {amountMode === 'detail' ? (
                  <div className="grid gap-3 rounded-xl bg-secondary/50 p-4">
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
                      label="Total según el papel"
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
                            Diferencia{' '}
                            {formatCents(Math.abs(controlTotalCents - detail.totalCents))}.
                          </p>
                        )
                      ) : null}
                    </MoneyField>
                  </div>
                ) : null}
              </div>
            </StepCard>

            {/* ── 4 · Cuándo le pagás (una nota de crédito no se paga) ── */}
            {isCreditNote ? null : (
              <StepCard
                open
                n={4}
                id="paso-4"
                state={payState ?? 'todo'}
                title="¿Cuándo le pagás?"
                summary={
                  paying
                    ? payTreasury
                      ? `Ya lo pagué con ${payTreasury.name}.`
                      : 'Ya lo pagué.'
                    : // Lo que viene de fábrica no se lee como contestado hasta que se llegó acá.
                      dueAnswered && (payDone || dueTouched)
                      ? `Lo debo · ${dueLine(dueDate).toLowerCase()}.`
                      : 'Si lo quedás debiendo, queda anotado en su libreta.'
                }
              >
                <div className="grid gap-4">
                  <PayWhenCards name={ids('pay-when')} paying={paying} onChange={setPaying} />

                  {!paying ? (
                    <div className="grid gap-2.5">
                      <span id={ids('due-label')} className={STEP_QUESTION}>
                        ¿Cuándo vence?
                      </span>
                      <DueChips
                        labelId={ids('due-label')}
                        choices={dueOptions}
                        onPick={pickDue}
                        invalid={Boolean(errors.dueDate) && !showDueField}
                        dateField={
                          showDueField ? (
                            <DateField
                              id={ids('dueDate')}
                              label="Fecha de vencimiento"
                              value={dueDate}
                              onValueChange={(next) => {
                                touched.current.due = true
                                setDueTouched(true)
                                setDueDate(next)
                                posting.clearFieldErrors()
                              }}
                              min={issueDate ?? undefined}
                              shortcuts={false}
                              today={today}
                              error={errors.dueDate ?? null}
                            />
                          ) : null
                        }
                      />
                      {errors.dueDate && !showDueField ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors.dueDate}
                        </p>
                      ) : null}
                      {/* Con un importe a la vista: antes no hay nada que «figure como vencido». */}
                      {dueSameDayWarning({ issueDate, dueDate, paying }) &&
                      dueAnswered &&
                      amountDone ? (
                        <InlineNotice tone="info">
                          Así, desde mañana va a figurar como vencida. Si le pagás más adelante,
                          tocá cuándo.
                        </InlineNotice>
                      ) : null}
                      {offeredTerm !== null && existing && existing.paymentTermDays === 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 justify-self-start rounded-full px-4 md:h-9"
                          disabled={savingTerm}
                          onClick={() => void saveTerm(offeredTerm)}
                        >
                          {savingTerm ? 'Guardando…' : `Pagarle siempre a ${offeredTerm} días`}
                        </Button>
                      ) : null}
                      {party?.kind === 'new' && offeredTerm !== null && activeDue?.days ? (
                        <label
                          htmlFor={ids('np-term')}
                          className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground md:min-h-9"
                        >
                          <Checkbox
                            id={ids('np-term')}
                            checked={party.paymentTermDays === activeDue.days}
                            onCheckedChange={(checked) =>
                              setParty({
                                ...party,
                                paymentTermDays: checked === true ? (activeDue.days ?? 0) : 0,
                              })
                            }
                          />
                          <span className="min-w-0 text-pretty">
                            Pagarle siempre a {activeDue.days} días
                          </span>
                        </label>
                      ) : null}
                    </div>
                  ) : payNow ? (
                    <div className="grid gap-4">
                      <div className="grid gap-2.5">
                        <span id={ids('pay-label')} className={STEP_QUESTION}>
                          ¿Con qué pagaste?
                          <span aria-hidden="true" className="ml-0.5 text-destructive">
                            *
                          </span>
                        </span>
                        <TreasuryPicker
                          id={ids('payTreasury')}
                          aria-labelledby={ids('pay-label')}
                          value={payNow.treasuryAccountId}
                          onValueChange={(next) => {
                            setPayNow({ ...payNow, treasuryAccountId: next })
                            posting.clearFieldErrors()
                          }}
                          treasuries={data.treasuries}
                          invalid={Boolean(errors.payTreasury)}
                        />
                        {errors.payTreasury ? (
                          <p role="alert" className="text-xs text-destructive">
                            {errors.payTreasury}
                          </p>
                        ) : null}
                        {payTreasury ? (
                          <TreasuryAfterLine treasury={payTreasury} amountCents={payAmount} />
                        ) : null}
                      </div>
                      {payPartial || payNow.amountCents !== null ? (
                        <MoneyField
                          id={ids('payAmount')}
                          label="¿Cuánto pagaste ahora?"
                          value={payNow.amountCents ?? total}
                          onValueChange={(cents) =>
                            setPayNow({
                              ...payNow,
                              amountCents: cents !== null && cents === total ? null : cents,
                            })
                          }
                          error={errors.payAmount ?? null}
                          hint={
                            payNow.amountCents !== null &&
                            total !== null &&
                            payNow.amountCents < total
                              ? `Queda ${formatCents(total - payNow.amountCents)} a pagar.`
                              : 'Lo que pagaste ahora (el total si fue todo).'
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          className={ADD_LINK}
                          onClick={() => {
                            setPayPartial(true)
                            requestAnimationFrame(() =>
                              document.getElementById(ids('payAmount'))?.focus(),
                            )
                          }}
                        >
                          <Plus className="size-3.5" aria-hidden />
                          Pagué solo una parte
                        </button>
                      )}
                      <div className="grid gap-4 @lg:grid-cols-2">
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
                        {showPayReference || payNow.reference ? (
                          <StepField
                            id={ids('payReference')}
                            label="N.º de transferencia"
                            optional
                            error={errors.payReference}
                          >
                            <Input
                              id={ids('payReference')}
                              value={payNow.reference}
                              maxLength={60}
                              autoComplete="off"
                              onChange={(e) => setPayNow({ ...payNow, reference: e.target.value })}
                              className="h-11 text-base md:h-10 md:text-sm"
                            />
                          </StepField>
                        ) : (
                          <button
                            type="button"
                            className={cn(ADD_LINK, '@lg:mt-[22px]')}
                            onClick={() => {
                              setShowPayReference(true)
                              requestAnimationFrame(() =>
                                document.getElementById(ids('payReference'))?.focus(),
                              )
                            }}
                          >
                            <Plus className="size-3.5" aria-hidden />
                            Agregar n.º de transferencia
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </StepCard>
            )}

            {/* ── Cierre ── */}
            <div className="grid gap-4">
              {showNotes || notes ? (
                <StepField id={ids('notes')} label="Nota" optional error={errors.notes}>
                  <Textarea
                    id={ids('notes')}
                    value={notes}
                    maxLength={detailRoom(remitoActive ? remito : '', NOTES_MAX)}
                    rows={2}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </StepField>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowNotes(true)
                    requestAnimationFrame(() => document.getElementById(ids('notes'))?.focus())
                  }}
                  className={ADD_LINK}
                >
                  <Plus className="size-3.5" aria-hidden />
                  Agregar una nota
                </button>
              )}

              {unknownPreviewError ? (
                <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
              ) : null}
              <FormBanner banner={posting.banner} />

              <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <label
                  htmlFor={ids('another')}
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground"
                >
                  <Checkbox
                    id={ids('another')}
                    checked={another}
                    onCheckedChange={(checked) => setAnother(checked === true)}
                  />
                  Cargar otra después
                </label>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  <Button asChild variant="ghost" className="h-11 text-muted-foreground">
                    <Link href={returnHref}>Cancelar</Link>
                  </Button>
                  <Button
                    type="submit"
                    className="h-12 min-w-[200px] rounded-full px-6 text-base"
                    disabled={posting.pending || attaching}
                  >
                    {posting.pending ? 'Guardando…' : attaching ? 'Subiendo la foto…' : submitLabel}
                  </Button>
                </div>
              </div>
              <p className="hidden text-right text-[11px] text-muted-foreground lg:block">
                ⌘↵ guarda · ⇧⌘↵ guarda y deja lista otra
              </p>
            </div>
          </div>

          {/* El ticket acompaña mientras se carga (solo con lugar para las dos columnas). */}
          <aside className="hidden xl:sticky xl:top-20 xl:block">{ticket(true)}</aside>
        </div>

        <TicketBar
          label={totalLabel}
          totalCents={ticketTotalCents}
          onOpen={() => setTicketOpen(true)}
        />
      </form>

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] outline-none"
          // El foco va a la hoja (no a la X): es para leer, y así el lector arranca por el título.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <SheetGrabber />
          <SheetHeader className="sr-only">
            <SheetTitle>Lo que vas a cargar</SheetTitle>
            <SheetDescription>
              El ticket de la compra con lo que cargaste hasta ahora. Se guarda con el botón del
              final de la pantalla.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm">
            {ticket(true)}
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Esto todavía no está guardado: se guarda con el botón del final.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full rounded-full"
              onClick={() => setTicketOpen(false)}
            >
              Seguir cargando
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onConfirm={posting.confirmWarnings}
        onCancel={posting.dismissWarnings}
      />
    </>
  )
}
