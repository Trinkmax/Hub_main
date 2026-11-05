'use client'

import { ChevronLeft, Plus, X } from 'lucide-react'
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
import { toast } from 'sonner'
import {
  exactAmountText,
  recoveredVatFromPreview,
  recoversVat,
  treasuryAfter,
  treasuryAfterWords,
} from '@/components/administracion/acciones/gasto-papel'
import { SavedNote, TreasuryAfterHint } from '@/components/administracion/acciones/gasto-piezas'
import { ADD_LINK } from '@/components/administracion/acciones/sheet-parts'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
import { DateInput } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { FotoPanel } from '@/components/administracion/foto-qr/foto-panel'
import {
  categoryOptions,
  featuredCategories,
  Term,
  topCategories,
} from '@/components/administracion/kit'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { SimplePage } from '@/components/administracion/planilla'
import { TreasurySelect } from '@/components/administracion/treasury-select'
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
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE, type AccActionState } from '@/lib/accounting/action-state'
import {
  postPurchase,
  postPurchaseCreditNote,
  postQuickExpense,
} from '@/lib/accounting/actions/documents'
import { saveParty } from '@/lib/accounting/actions/master'
import type { ArcaQrData } from '@/lib/accounting/arca-qr'
import { amountLooksOff, pickTreasury, suggestDueDate } from '@/lib/accounting/defaults'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, bpLabel } from '@/lib/accounting/taxes'
import type { IvaCondition, VatRateBp, VoucherType } from '@/lib/accounting/types'
import {
  isVoucherType,
  VOUCHER_CATALOG,
  voucherConditionCheck,
  voucherNumberRequired,
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
import { SEGMENT_LIST, segmentOption } from '../../_components/segment'
import {
  RememberAccountCheckbox,
  rememberSupplierAccount,
  SupplierAccountLine,
} from '../../_components/supplier-account'
import { SupplierInvoicingAsk } from '../../_components/supplier-invoicing-ask'
import {
  type PostingMeta,
  type SavedState,
  useDocumentPosting,
} from '../../_components/use-document-posting'
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
  asksDue,
  asksPaper,
  conditionForVoucher,
  conditionNoun,
  dueSameDayWarning,
  dueTermOf,
  findPartyByCuit,
  INVOICING_CHOICES,
  initialPayNow,
  invoicingGap,
  letterBoxOf,
  newPartyTermToSend,
  otherPaperTypes,
  paperOfVoucher,
  paperPicks,
  parseTermDays,
  purchaseRoute,
  purchaseSubmitLabel,
} from '../../_lib/purchase-paper'
import {
  buildQuickFromPurchase,
  detailRoom,
  QUICK_DETAIL_MAX,
  type QuickExpenseFormValues,
  REMITO_MAX,
  sortRecurringForSheet,
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
  anyVoucherOptions,
  asksIfInvoiced,
  defaultVoucherFor,
  docKindOf,
  familyOf,
  notInvoicedDefault,
  type PurchaseFamily,
  rememberedVoucherType,
  voucherOptionsFor,
} from '../../_lib/vouchers'
import {
  CategoryCombobox,
  DueTermLine,
  FlashCell,
  LetterStamp,
  PAPER_LINK,
  PaperField,
  PaperPicks,
  PayOptions,
  RecurringLinked,
  RecurringOffers,
  RecurringPicker,
} from './purchase-parts'

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
  treasuryAccountId: string | null
  nextDueDate: string
  pending: boolean
}

/** Lo que trae la factura relacionada de una NC (`?relacionada=`). */
export type RelatedOption = { documentId: string; label: string }

const PURCHASE_PARTY_KINDS = new Set(['supplier', 'other', 'tax_agency'])
const VAT_RATES = [2100, 1050, 2700, 500, 250, 0] as const satisfies readonly VatRateBp[]

/** Hasta cuántas compras para corregir van como chips; con más, el desplegable. */
const MAX_RELATED_CHIPS = 6
const NO_RELATED = '__ninguna__'

/** La misma memoria de «Nuevo gasto»: con qué pagó esta persona la última vez, en este dispositivo. */
const LAST_TREASURY_KEY = 'hub_acc_gasto_caja:'

const CONDITION_LABELS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos de IVA',
}

/** Lo que vive plegado en «Más opciones»: si tiene un error, se abre sola. */
const ADVANCED_FIELDS = [
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
  'notes',
  ...DETAIL_RATES.map((r) => `net-${r}`),
]

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
  'related',
  'payTreasury',
  'payAmount',
  'payDate',
  'payReference',
  ...ADVANCED_FIELDS,
])

/** En qué orden se encienden los campos que completó el QR. */
const FLASH_DELAYS = { party: 0, letter: 110, number: 220, date: 330, total: 440 } as const
const FLASH_MS = 1_700

const FAMILY_TITLES: Readonly<Record<PurchaseFamily, string>> = {
  factura: 'Cargar una compra',
  nc: 'Nota de crédito de un proveedor',
  nd: 'Nota de débito de un proveedor',
}

const FAMILY_WORDS: Readonly<Record<PurchaseFamily, string>> = {
  factura: 'una compra',
  nc: 'una nota de crédito',
  nd: 'una nota de débito',
}

/** El adentro de los campos del papel: un poco más bajos que en una hoja, para que entre todo. */
const COMPACT_INPUT = 'h-11 text-base md:h-9 md:text-sm'

type AnyValues = PurchaseFormValues | QuickExpenseFormValues

/** El envío sale de lo que se manda: un reintento no puede ir por el camino equivocado. */
function postAny(slug: string, input: AnyValues & PostingMeta): Promise<AccActionState> {
  if ('amountCents' in input) return postQuickExpense(slug, input)
  return input.docKind === 'purchase_credit_note'
    ? postPurchaseCreditNote(slug, input)
    : postPurchase(slug, input)
}

function rememberedTreasury(slug: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_TREASURY_KEY}${slug}`)
  } catch {
    return null
  }
}

function rememberTreasury(slug: string, id: string): void {
  try {
    window.localStorage.setItem(`${LAST_TREASURY_KEY}${slug}`, id)
  } catch {
    // Sin almacenamiento (modo privado): la próxima vez se propone la caja.
  }
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/** Una fila de los totales: el rótulo a la izquierda y la plata alineada a la derecha. */
function TotalLine({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Cargar una compra: una factura argentina en la pantalla, sin scroll en una compu.
 *
 *   Proveedor · el recuadro de la letra · FACTURA, número, fecha, vence
 *                                               Neto · IVA · Total
 *   La debo / Ya la pagué · Ver el asiento · Más opciones · Cargar otra y el botón
 *
 * Al costado, la foto: un QR para sacarla con el celular. Si la factura es electrónica, su QR de ARCA
 * completa el papel solo.
 *
 * «Compra y pago» es esta misma pantalla con «Ya la pagué» y cubre lo que hace la hoja «Nuevo gasto»:
 * el proveedor es opcional, y lo que va sin factura se manda igual que un gasto (`purchaseRoute`). Una
 * compra, una nota de crédito o una de débito siguen siendo la misma carga de siempre:
 * `buildPurchaseValues` → `postPurchase` / `postPurchaseCreditNote`.
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
  startPaying = false,
  startAnother = true,
  takeDropped = false,
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
  /** `?modo=pago`: arranca con «Ya la pagué». */
  startPaying?: boolean
  /** «Cargar otra» arranca tildado, salvo que se haya venido de una pantalla a la que hay que volver. */
  startAnother?: boolean
  /** `?desde=archivo`: el comprobante se soltó en otra pantalla. */
  takeDropped?: boolean
}) {
  const router = useRouter()
  const { openAction } = useAccounting()
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const today = data.today

  const partyById = useMemo(() => new Map(data.parties.map((p) => [p.id, p])), [data.parties])
  const imputable = useMemo(
    () => new Set(data.accounts.filter(isPurchaseImputation).map((a) => a.id)),
    [data.accounts],
  )
  // «Va a…»: las mismas categorías del selector de chips, con lo que más se usa adelante.
  const categories = useMemo(() => {
    const featured = featuredCategories(data.accounts)
    const usage = new Map<string, number>()
    for (const s of data.suggestions) usage.set(s.accountId, (usage.get(s.accountId) ?? 0) + 1)
    return {
      options: categoryOptions(data.accounts, (id) => imputable.has(id)),
      featured,
      pinned: topCategories(usage, 6, new Set(featured)),
    }
  }, [data.accounts, data.suggestions, imputable])
  // El buscador abre con los proveedores de siempre arriba: los atajos de antes, sin ocupar lugar.
  const partyOptions: PartyOption[] = useMemo(() => {
    const usedFirst = new Map<string, number>()
    for (const s of data.suggestions) {
      if (s.type === 'party' && s.partyId && !usedFirst.has(s.partyId)) {
        usedFirst.set(s.partyId, usedFirst.size)
      }
    }
    return data.parties
      .filter((p) => PURCHASE_PARTY_KINDS.has(p.kind))
      .map((p, index) => ({ p, index }))
      .sort(
        (a, b) =>
          (usedFirst.get(a.p.id) ?? Number.MAX_SAFE_INTEGER) -
            (usedFirst.get(b.p.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
      )
      .map(({ p }) => ({
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
      }))
  }, [data.parties, data.suggestions])
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
    (VAT_RATES as readonly number[]).includes(firstRecurring.vatRateBp)
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
  const [payNow, setPayNow] = useState<PurchaseFormState['payNow']>(() =>
    startPaying && initialFamily !== 'nc'
      ? initialPayNow({ treasuries: data.treasuries, lastUsedWithParty: null, today })
      : null,
  )
  const [notes, setNotes] = useState('')
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
  // «Cargar otra» tal como estaba al tocar «Guardar». Un ref: la respuesta de la acción lo tiene que
  // ver aunque llegue antes del próximo dibujo.
  const stayAfterSave = useRef(false)
  const [defaults, setDefaults] = useState<SheetPartyDefaults | null>(null)
  const [duplicate, setDuplicate] = useState<SheetDuplicate | null>(null)
  const [relatedOptions, setRelatedOptions] = useState<RelatedOption[]>(() =>
    related ? [related] : [],
  )
  const touched = useRef({ voucher: false, account: false, due: false, treasury: false })
  const defaultsSeq = useRef(0)
  // El gasto fijo marcado, a mano de `applyDefaults` (que no se rearma con cada cambio).
  const recurringIdRef = useRef(recurringId)
  recurringIdRef.current = recurringId
  /** La persona eligió a mano la condición del proveedor nuevo (ARCA pregunta antes de cambiarla). */
  const [newPartyIvaTouched, setNewPartyIvaTouched] = useState(false)

  // ── Lo que es solo de la pantalla (no viaja) ──
  /** La letra que se tocó y no entra con lo que sabemos del proveedor: abre «¿Cómo te factura?». */
  const [asking, setAsking] = useState<VoucherType | null>(null)
  /** La letra que queda marcada cuando lleguen las opciones nuevas (la ficha ya se guardó). */
  const pendingVoucher = useRef<VoucherType | null>(null)
  /** «Más opciones», plegado. */
  const [moreOpen, setMoreOpen] = useState(false)
  /** El ajuste de centavos del IVA, plegado adentro. */
  const [showVatAdjust, setShowVatAdjust] = useState(false)
  /** Un tique no pide número: «Tiene número» abre los dos campos. */
  const [tiqueNumber, setTiqueNumber] = useState(false)
  /** El plazo que escribió la persona: el vencimiento lo sigue si cambia la fecha del papel. */
  const [termOverride, setTermOverride] = useState<number | null>(null)
  /** Lo que se está tipeando en el plazo (`null`: se muestra el que resulta de las fechas). */
  const [termText, setTermText] = useState<string | null>(null)
  /** La persona tocó cuándo vence (solo importa con `ASK_WHEN_UNKNOWN`). */
  const [dueTouched, setDueTouched] = useState(false)
  /** «Pagué solo una parte», otra fecha de pago y el n.º de transferencia, plegados. */
  const [payPartial, setPayPartial] = useState(false)
  const [payDateOpen, setPayDateOpen] = useState(false)
  const [showPayReference, setShowPayReference] = useState(false)
  /** «Cargar otra»: lo que antes solo se podía con ⇧⌘↵. */
  const [another, setAnother] = useState(startAnother)
  /** Guardando «Pagarle siempre a N días» en la ficha. */
  const [savingTerm, setSavingTerm] = useState(false)
  /** Con «Cargar otra»: lo último que se cargó y cuántas van, para no perder el hilo. */
  const [lastSaved, setLastSaved] = useState<{ text: string; count: number } | null>(null)
  /** Cambia para que el panel de la foto cierre su link y arranque con un QR nuevo. */
  const [panelNonce, setPanelNonce] = useState(0)
  /** Los campos que acaba de completar el QR se encienden un momento. */
  const [flash, setFlash] = useState(false)
  /** La CUIT del QR no está entre los proveedores: se ofrece crearlo. */
  const [cuitOffer, setCuitOffer] = useState<{
    cuit: string
    condition: IvaCondition | null
  } | null>(null)

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
      if (patch.ivaCondition !== undefined && !touched.current.voucher) {
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
  const isTaxAgency = existing?.kind === 'tax_agency'
  // Sin proveedor todavía se puede elegir cualquier letra: la condición se mira cuando lo hay.
  const voucherOptions = useMemo(
    () =>
      party === null
        ? anyVoucherOptions(family)
        : voucherOptionsFor({ family, condition, isTaxAgency }),
    [family, condition, isTaxAgency, party],
  )
  const docKind = voucherType
    ? docKindOf(voucherType)
    : family === 'nc'
      ? 'purchase_credit_note'
      : family === 'nd'
        ? 'purchase_debit_note'
        : 'purchase'
  const isCreditNote = docKind === 'purchase_credit_note'
  const paying = payNow !== null && !isCreditNote
  const numberRequired = voucherType ? voucherNumberRequired(voucherType) : true
  const vat = discriminatesVat(voucherType)

  // ── El papel: los botones de abajo de la letra (y, para lo demás, una lista) ──
  const picks = paperPicks({ family, options: voucherOptions, isTaxAgency })
  const askInvoiced = asksIfInvoiced({ family, options: voucherOptions, isTaxAgency })
  const notInvoiced = isNotInvoicedVoucher(voucherType)
  // La ficha propone: su «Comprobante habitual»; si no tiene, el último que se le cargó.
  const rememberedVoucher = rememberedVoucherType({
    habitual: existing?.defaultVoucherType,
    lastUsed: defaults?.voucherType,
    recurring: firstRecurring?.voucherType,
  })
  // El remito no lleva punto de venta ni número: el suyo queda anotado en las notas.
  const remitoActive = voucherType === 'sin_comprobante'
  const otherTypes = otherPaperTypes(voucherOptions)
  // Con «¿Cómo te factura?» abierto queda marcada la que se tocó.
  const shownType = asking ?? voucherType
  const letterBox = letterBoxOf(shownType)

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
      : // Lo que se pagó sin decir a quién es un remito: una factura pediría proveedor.
        party === null && paying && family === 'factura'
        ? notInvoicedDefault(voucherOptions)
        : defaultVoucherFor({
            family,
            options: voucherOptions,
            remembered: rememberedVoucher,
            condition,
          })
    if (next !== voucherType) setVoucherType(next)
  }, [voucherOptions, family, rememberedVoucher, condition, voucherType, party, paying])

  // La ficha del proveedor ya dice cómo factura: queda marcada la letra que la persona tocó.
  // Va DESPUÉS del efecto de arriba a propósito: si los dos escriben, gana lo que tocó.
  useEffect(() => {
    const wanted = pendingVoucher.current
    if (wanted === null || !voucherOptions.includes(wanted)) return
    pendingVoucher.current = null
    touched.current.voucher = true
    setAsking(null)
    setVoucherType(wanted)
    setVatAdjust(0)
  }, [voucherOptions])

  // El vencimiento sigue a la fecha y al plazo. Una fecha puesta a mano se queda donde está.
  useEffect(() => {
    if (!issueDate) return
    if (termOverride !== null) {
      setDueDate(suggestDueDate(issueDate, termOverride))
      return
    }
    if (touched.current.due) return
    setDueDate(suggestDueDate(issueDate, termDays))
  }, [issueDate, termDays, termOverride])

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
      if (d.vatRateBp !== null && (VAT_RATES as readonly number[]).includes(d.vatRateBp)) {
        setVatRateBp(d.vatRateBp as VatRateBp)
      }
      if (d.pointOfSale !== null) {
        setVoucherNumber((prev) =>
          prev.pos === '' ? { ...prev, pos: padPos(String(d.pointOfSale)) } : prev,
        )
      }
      // Lo que se pagó la última vez con este proveedor, si nadie eligió otra cosa.
      if (d.treasuryAccountId && !touched.current.treasury) {
        const lastUsedWithParty = d.treasuryAccountId
        setPayNow((prev) =>
          prev
            ? {
                ...prev,
                treasuryAccountId: pickTreasury({
                  treasuries: data.treasuries.filter((t) => t.active),
                  lastUsedWithParty,
                  myLastQuickExpense: rememberedTreasury(tenantSlug),
                  order: data.treasuries.map((t) => t.id),
                }),
              }
            : prev,
        )
      }
    },
    [data.treasuries, imputable, partyById, recurringById, tenantSlug],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al entrar con un proveedor elegido
  useEffect(() => {
    if (party?.kind === 'existing') void applyDefaults(party.id)
  }, [])

  // Con `?modo=pago`, lo último con que pagó esta persona. Va acá y no en el estado inicial: del lado
  // del servidor no hay `localStorage`, y el primer dibujo tiene que dar lo mismo en los dos lados.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al entrar
  useEffect(() => {
    const mine = rememberedTreasury(tenantSlug)
    if (!mine) return
    setPayNow((prev) =>
      prev && !touched.current.treasury && !defaults
        ? {
            ...prev,
            treasuryAccountId: pickTreasury({
              treasuries: data.treasuries.filter((t) => t.active),
              lastUsedWithParty: null,
              myLastQuickExpense: mine,
              order: data.treasuries.map((t) => t.id),
            }),
          }
        : prev,
    )
  }, [])

  // Si la persona se fue de la pantalla mientras subía la foto, al terminar no se la mueve.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // El destello del QR dura un rato: si se lee otra foto, se vuelve a encender.
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  const flashDelay = (field: keyof typeof FLASH_DELAYS): number | null =>
    flash ? FLASH_DELAYS[field] : null

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

  /** Otro proveedor, otro plazo: el vencimiento vuelve a salir de su ficha. */
  const resetDue = () => {
    touched.current.due = false
    setDueTouched(false)
    setTermOverride(null)
    setTermText(null)
  }

  const choosePartyId = (id: string | null) => {
    const next = id ? (partyById.get(id) ?? null) : null
    const nextOptions = next
      ? voucherOptionsFor({
          family,
          condition: next.ivaCondition,
          isTaxAgency: next.kind === 'tax_agency',
        })
      : anyVoucherOptions(family)
    // Lo que la persona ya eligió se queda si ese proveedor lo puede dar.
    if (!(touched.current.voucher && voucherType !== null && nextOptions.includes(voucherType))) {
      touched.current.voucher = false
      setVoucherType(null)
    }
    pendingVoucher.current = null
    setAsking(null)
    setCuitOffer(null)
    // El punto de venta propuesto era del proveedor anterior; lo que ya se tipeó no se borra.
    setVoucherNumber((prev) => (prev.number === '' ? { pos: '', number: '' } : prev))
    resetDue()
    resetAccountFor(id)
    posting.clearFieldErrors()
    if (!id) {
      defaultsSeq.current += 1
      setDefaults(null)
      setDuplicate(null)
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
  // Sin factura y pagado en el momento, es lo mismo que «Nuevo gasto».
  const route = purchaseRoute(formState, { family, today, notes, remito })
  const built =
    route === 'quick_expense'
      ? buildQuickFromPurchase(formState, { notes, remito })
      : buildPurchaseValues(formState)
  const key = built.values ? JSON.stringify(built.values) : ''
  const form =
    route === 'quick_expense' ? 'quick_expense' : isCreditNote ? 'purchase_credit_note' : 'purchase'
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
    if (paying && payNow?.treasuryAccountId) {
      rememberTreasury(tenantSlug, payNow.treasuryAccountId)
    }
    posting.undoToast(saved.message, saved)
    const remember = rememberOnSave.current
    rememberOnSave.current = null
    const picked = files
    const followUp = afterPosted({
      documentId: saved.result.documents[0]?.id ?? null,
      remember,
      files: picked,
    })
    if (!stayAfterSave.current) {
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
    // «Cargar otra» (o ⇧⌘↵): queda vacía para cargar otra. En una compra sigue el mismo proveedor (uno
    // nuevo ya quedó creado: se vuelve a elegir de la lista para no crearlo dos veces). En una compra y
    // pago, como en «Nuevo gasto», se conservan la fecha y la caja.
    const savedText = [
      total !== null ? exactAmountText(total) : null,
      party?.kind === 'new' ? party.name.trim() : existing ? supplierName : null,
    ]
      .filter((part) => part)
      .join(' · ')
    setLastSaved((prev) => ({ text: savedText, count: (prev?.count ?? 0) + 1 }))
    stayAfterSave.current = false
    setSubmitted(false)
    if (party?.kind === 'new' || paying) {
      defaultsSeq.current += 1
      setDefaults(null)
      setParty(null)
      touched.current.voucher = false
      touched.current.account = false
      setVoucherType(null)
      setVoucherNumber({ pos: '', number: '' })
      setAccountId(null)
    } else {
      setVoucherNumber((prev) => ({ pos: prev.pos, number: '' }))
    }
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
    setPayNow((prev) => (prev ? { ...prev, amountCents: null, date: today, reference: '' } : null))
    setNotes('')
    setRemito('')
    // [Cambiar] valía para esa compra: la próxima vuelve a la cuenta de la ficha.
    if (accountChanging && defaultAccountId !== null && party?.kind !== 'new' && !paying) {
      touched.current.account = false
      setAccountId(defaultAccountId)
    }
    setAccountChanging(false)
    setDuplicate(null)
    setFiles([])
    setAsking(null)
    setCuitOffer(null)
    setFlash(false)
    resetDue()
    // Lo plegado vuelve a plegarse: la próxima arranca como una compra nueva.
    setMoreOpen(false)
    setShowExtras(false)
    setShowVatAdjust(false)
    setTiqueNumber(false)
    setPayPartial(false)
    setPayDateOpen(false)
    setShowPayReference(false)
    // El panel cierra el link de esta compra, borra la copia temporal y arma un QR nuevo.
    setPanelNonce((n) => n + 1)
    // La próxima se puede ir cargando; se guarda cuando terminó de subir la foto de esta.
    if (picked.length > 0) setAttaching(true)
    // Los datos se vuelven a traer cuando terminó lo de después (la ficha ya tiene su cuenta).
    void followUp.finally(() => {
      if (mounted.current) setAttaching(false)
      router.refresh()
    })
    // La próxima arranca por lo primero que cambia: el proveedor, o el número de la siguiente factura.
    const clearedParty = party?.kind === 'new' || paying
    requestAnimationFrame(() => {
      const number = document.getElementById(ids('number'))
      const target = clearedParty
        ? document.getElementById(ids('party'))
        : (number?.parentElement?.querySelectorAll('input')[1] ??
          document.getElementById(ids('total')))
      target?.focus()
    })
  }

  const posting = useDocumentPosting<AnyValues>({
    tenantSlug,
    action: postAny,
    onSaved: (saved) => onSaved(saved),
    formRef,
    isKnownField: (k) => UI_FIELDS.has(built.fieldOf[k] ?? k),
  })

  // ── ¿Ya está cargada? ──
  const partyId = party?.kind === 'existing' ? party.id : null
  const pos = voucherPart(voucherNumber.pos)
  const number = voucherPart(voucherNumber.number)
  // Un tique va con los dos o con ninguno: un punto de venta solo (el que propone el sistema) no cuenta.
  const hasBothParts = pos !== null && number !== null
  const carriesNumber =
    voucherType !== null &&
    VOUCHER_CATALOG[voucherType].numbered &&
    (numberRequired || hasBothParts)
  useEffect(() => {
    if (
      !partyId ||
      total === null ||
      !issueDate ||
      !voucherType ||
      (numberRequired && number === null)
    ) {
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
          pointOfSale: carriesNumber ? pos : null,
          number: carriesNumber ? number : null,
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
  }, [
    partyId,
    total,
    issueDate,
    voucherType,
    numberRequired,
    carriesNumber,
    pos,
    number,
    tenantSlug,
  ])

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
    if (!dueAnswered) errors.dueDate = 'Poné a cuántos días vence, o «Sin fecha».'
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

  // Un error en lo plegado no puede quedar escondido.
  const advancedError = ADVANCED_FIELDS.some((field) => errors[field])
  useEffect(() => {
    if (advancedError) setMoreOpen(true)
  }, [advancedError])

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
    stayAfterSave.current = stay
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
  const extrasCents = [
    percIvaCents,
    percIibbCents,
    percGananciasCents,
    otherTaxesCents,
  ].reduce<number>((sum, c) => sum + (c && c > 0 ? c : 0), 0)
  const netOfExtras =
    totalCents !== null && totalCents - extrasCents > 0 ? totalCents - extrasCents : null
  const split = amountMode === 'total' && vat ? splitTotal(netOfExtras, vatRateBp, vatAdjust) : null
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
  // Sin proveedor todavía, «Compra y pago» ofrece los gastos fijos de este mes, como «Nuevo gasto».
  const recurringToPick =
    party === null && paying && family === 'factura' && recurringId === null
      ? sortRecurringForSheet(recurring.filter((r) => r.pending))
      : []
  const pickRecurring = (id: string) => {
    const r = recurringById.get(id)
    if (!r) return
    // `applyDefaults` lo mira para no pisar la cuenta del gasto fijo.
    recurringIdRef.current = r.id
    if (r.partyId && partyById.get(r.partyId)?.active) choosePartyId(r.partyId)
    setRecurringId(r.id)
    if (imputable.has(r.accountId)) setAccountId(r.accountId)
    if (totalCents === null && r.amountCents !== null && amountMode === 'total') {
      setTotalCents(r.amountCents)
    }
    if (r.vatRateBp !== null && (VAT_RATES as readonly number[]).includes(r.vatRateBp)) {
      setVatRateBp(r.vatRateBp as VatRateBp)
    }
    if (isVoucherType(r.voucherType)) {
      touched.current.voucher = true
      setVoucherType(r.voucherType)
    }
    const treasury = r.treasuryAccountId
    if (treasury && data.treasuries.some((t) => t.id === treasury && t.active)) {
      touched.current.treasury = true
      setPayNow((prev) => (prev ? { ...prev, treasuryAccountId: treasury } : prev))
    }
  }
  const payAmount = payNow ? (payNow.amountCents ?? total) : null
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const submitLabel = purchaseSubmitLabel({ docKind, paying, totalCents: total })
  const looksOff =
    total !== null && existing && defaults?.medianTotalCents
      ? amountLooksOff(total, defaults.medianTotalCents)
      : false

  // ── Los botones de la letra: tocar uno escribe un tipo que ya se ofrecía ──
  const writeVoucher = (type: VoucherType) => {
    touched.current.voucher = true
    setVoucherType(type)
    setVatAdjust(0)
    setShowVatAdjust(false)
    posting.clearFieldErrors()
  }
  const chooseVoucher = (type: VoucherType) => {
    if (!voucherOptions.includes(type)) {
      // No entra con lo que sabemos del proveedor: la compra no cambia hasta resolverlo.
      setAsking(type)
      return
    }
    setAsking(null)
    // Tocar la que ya estaba marcada solo confirma.
    if (type === voucherType) {
      touched.current.voucher = true
      return
    }
    writeVoucher(type)
  }
  // Un tique sin número no entra al Libro IVA: para ese papel el CUIT no hace falta.
  const entersIvaBook = (type: VoucherType) =>
    VOUCHER_CATALOG[type].ivaBook && (voucherNumberRequired(type) || hasBothParts)
  const partyGap =
    existing && voucherType
      ? invoicingGap({
          paper: paperOfVoucher(voucherType),
          voucherType,
          condition: existing.ivaCondition,
          hasTaxId: Boolean(existing.taxId),
          entersIvaBook: entersIvaBook(voucherType),
        })
      : null
  const askedGap =
    existing && asking
      ? invoicingGap({
          paper: paperOfVoucher(asking),
          voucherType: asking,
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
  // ── El IVA de una Factura A: ¿se recupera? ──
  const canRecover = recoversVat({ condition, sasCondition: data.ctx.settings.ivaCondition })
  const previewVat = preview?.ok
    ? recoveredVatFromPreview(preview.preview, data.ctx.sys.vat_credit.id)
    : 0
  const recovers = preview?.ok ? previewVat > 0 : canRecover

  // ── La debo: a cuántos días ──
  const dueTerm = dueTermOf({
    issueDate,
    dueDate,
    termDays: party?.kind === 'new' ? 0 : termDays,
    suggestedTermDays: defaults?.suggestedTermDays ?? null,
  })
  const shownTerm =
    termText ?? (dueTerm.days !== null && dueTerm.days > 0 ? String(dueTerm.days) : '')
  const applyTerm = (days: number) => {
    touched.current.due = true
    setDueTouched(true)
    setTermOverride(days)
    posting.clearFieldErrors()
    // Proveedor nuevo: «A 7 días» deja tildado «Pagarle siempre a 7 días» (se puede destildar).
    if (party?.kind === 'new') setParty({ ...party, paymentTermDays: days })
  }
  const setNoDue = () => {
    touched.current.due = true
    setDueTouched(true)
    setTermOverride(null)
    setTermText(null)
    setDueDate(null)
    posting.clearFieldErrors()
    if (party?.kind === 'new') setParty({ ...party, paymentTermDays: 0 })
  }
  // «Pagarle siempre a N días»: con un plazo escrito y un proveedor que todavía no tiene el suyo.
  const offeredTerm =
    !paying &&
    termOverride !== null &&
    termOverride > 0 &&
    termOverride !== (existing?.paymentTermDays ?? 0)
      ? termOverride
      : null
  // Proveedor nuevo: su plazo solo viaja mientras el tilde «Pagarle siempre a N días» está a
  // la vista. Si deja de verse (pasó a «Ya la pagué», cambió la fecha del papel) vuelve a 0:
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

  // ── La debo / Ya la pagué ──
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
        myLast: rememberedTreasury(tenantSlug),
        today,
      }),
    )
  }
  const payTreasury = payNow?.treasuryAccountId
    ? (data.treasuries.find((t) => t.id === payNow.treasuryAccountId) ?? null)
    : null
  // El impuesto al cheque: el motor lo suma solo en el mismo envío; acá se avisa cuánto va a ser.
  const payTreasuryRef = payNow?.treasuryAccountId
    ? data.ctx.treasuries.get(payNow.treasuryAccountId)
    : undefined
  const taxSettings = data.ctx.settings.taxSettings
  const bankTaxCents =
    paying && payAmount !== null ? bankTaxOf(payAmount, payTreasuryRef, taxSettings) : 0
  const treasuryShort = payTreasury
    ? treasuryAfter(payTreasury, payAmount, 'out').state === 'short'
    : false
  const canNameTreasury =
    payTreasury !== null &&
    treasuryAfterWords(payTreasury.kind, treasuryAfter(payTreasury, payAmount, 'out')) !== null

  const priorDebt =
    existing && data.balances
      ? (data.balances.find((b) => b.partyId === existing.id)?.debtCents ?? null)
      : null

  const startNewParty = (
    name: string,
    from: { taxId?: string; condition?: IvaCondition | null } = {},
  ) => {
    // Con el papel leído, la letra que se leyó no se pierde.
    if (!touched.current.voucher) setVoucherType(null)
    pendingVoucher.current = null
    setAsking(null)
    setCuitOffer(null)
    resetDue()
    resetAccountFor(null)
    defaultsSeq.current += 1
    setDefaults(null)
    setNewPartyIvaTouched(false)
    arca.reset()
    setParty({
      kind: 'new',
      name,
      ivaCondition: from.condition ?? 'responsable_inscripto',
      taxId: from.taxId ?? '',
      paymentTermDays: 0,
    })
  }
  const switchFamily = (next: PurchaseFamily) => {
    touched.current.voucher = false
    pendingVoucher.current = null
    setAsking(null)
    setVoucherType(null)
    setFamily(next)
    if (next === 'nc') setPayNow(null)
    posting.clearFieldErrors()
  }

  /**
   * Llegó una foto con el QR de ARCA: se completa el papel, y cada campo se enciende para que se vea
   * qué se puso. Lo que no se leyó se queda como estaba. Después, revisar y listo.
   */
  const applyRead = (read: ArcaQrData) => {
    posting.clearFieldErrors()
    const found = findPartyByCuit(
      data.parties.filter((p) => PURCHASE_PARTY_KINDS.has(p.kind)),
      read.cuit,
    )
    const nextFamily = read.voucherType ? familyOf(read.voucherType) : family
    if (nextFamily !== family) {
      setFamily(nextFamily)
      if (nextFamily === 'nc') setPayNow(null)
    }
    if (found && found.id !== partyId) choosePartyId(found.id)
    setCuitOffer(
      found ? null : { cuit: read.cuit, condition: conditionForVoucher(read.voucherType) },
    )
    if (read.voucherType) {
      const known = found ?? existing
      const options = known
        ? voucherOptionsFor({
            family: nextFamily,
            condition: known.ivaCondition,
            isTaxAgency: known.kind === 'tax_agency',
          })
        : party?.kind === 'new'
          ? voucherOptionsFor({ family: nextFamily, condition: party.ivaCondition })
          : anyVoucherOptions(nextFamily)
      if (options.includes(read.voucherType)) {
        pendingVoucher.current = null
        touched.current.voucher = true
        setAsking(null)
        setVoucherType(read.voucherType)
        setVatAdjust(0)
      } else {
        // Lo que dice su ficha no coincide con el papel: se pregunta, no se pisa ninguno de los dos.
        setAsking(read.voucherType)
      }
    }
    setVoucherNumber({
      pos: padPos(String(read.pointOfSale)),
      number: padNumber(String(read.number)),
    })
    if (read.voucherType === 'tique') setTiqueNumber(true)
    setIssueDate(read.date)
    if (read.totalCents !== null) {
      setAmountMode('total')
      setTotalCents(read.totalCents)
    }
    setFlash(true)
  }

  const voucherSelect = (types: readonly VoucherType[], label: string, required: boolean) => (
    <PaperField
      id={ids('voucherType')}
      label={label}
      required={required}
      error={errors.voucherType}
    >
      {/* Siempre controlado (`''` = sin elegir): con `undefined` el `<select>` oculto de
          Radix dispara `onValueChange('')` al volver a «sin tipo» (proveedor nuevo,
          otra familia) y el render se rompía con un tipo que no existe. */}
      <Select
        value={voucherType !== null && types.includes(voucherType) ? voucherType : ''}
        onValueChange={(v) => {
          if (!isVoucherType(v)) return
          setAsking(null)
          writeVoucher(v)
        }}
      >
        <SelectTrigger
          id={ids('voucherType')}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-9"
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
    </PaperField>
  )

  // ── Lo que dice la barra de «Más opciones» cuando está plegada y hay algo adentro ──
  const moreInUse = [
    voucherType !== null && otherTypes.includes(voucherType) && family === 'factura'
      ? VOUCHER_CATALOG[voucherType].label
      : null,
    amountMode === 'detail' ? 'Renglones' : null,
    extrasCents > 0 ? 'Percepciones' : null,
    vatAdjust !== 0 ? 'IVA ajustado' : null,
    notes.trim() !== '' ? 'Nota' : null,
  ].filter((part): part is string => part !== null)

  const title = family === 'factura' && paying ? 'Cargar compra y pago' : FAMILY_TITLES[family]
  const canPickParty = party?.kind !== 'new'
  const hasParty = party !== null
  const partyDetail = existing
    ? [
        existing.ivaCondition === 'sin_datos' ? null : CONDITION_LABELS[existing.ivaCondition],
        existing.taxId ? `CUIT ${formatCuit(existing.taxId)}` : null,
        existing.paymentTermDays > 0 ? `Le pagás a ${existing.paymentTermDays} días` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  // Lo que pide el papel sigue a la letra que se ve, aunque todavía falte confirmarla.
  const shownNeedsNumber = shownType ? voucherNumberRequired(shownType) : true
  const showTiqueFields =
    shownType === 'tique' && (tiqueNumber || voucherNumber.number !== '' || Boolean(errors.number))
  const showNumber = shownType !== null && (shownNeedsNumber || showTiqueFields)

  return (
    <SimplePage className="pb-6 md:pb-6">
      <form
        ref={formRef}
        onSubmit={(e) => submit(e, another)}
        onKeyDown={onFormKeyDown}
        noValidate
        // En oscuro, el `Checkbox` tildado de `components/ui` pierde el relleno y parece destildado (ver
        // BACKLOG): «Cargar otra» arranca tildado, así que acá tiene que verse.
        className="grid gap-3.5 dark:[&_[role=checkbox][data-state=checked]]:bg-primary"
      >
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2 h-11 shrink-0 gap-0.5 px-2 text-muted-foreground md:h-8"
            >
              <Link href={returnHref}>
                <ChevronLeft className="size-4" aria-hidden />
                Volver
              </Link>
            </Button>
            <h1 className="min-w-0 font-serif text-2xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
          </div>
          {isCreditNote ? null : (
            // biome-ignore lint/a11y/useSemanticElements: un grupo de botones, no un fieldset de formulario
            <div role="group" aria-label="Qué cargás" className={SEGMENT_LIST}>
              <button
                type="button"
                aria-pressed={!paying}
                className={segmentOption(!paying)}
                onClick={() => setPaying(false)}
              >
                Compra
              </button>
              <button
                type="button"
                aria-pressed={paying}
                className={cn(segmentOption(paying), 'border-l border-border/70')}
                onClick={() => setPaying(true)}
              >
                Compra y pago
              </button>
              <button
                type="button"
                aria-pressed={false}
                className={cn(segmentOption(false), 'border-l border-border/70')}
                onClick={() => openAction('pagar')}
              >
                Pago
              </button>
            </div>
          )}
        </header>

        {lastSaved ? (
          // Con `key`, el tilde se vuelve a dibujar con cada una que se carga.
          <SavedNote key={lastSaved.count}>
            Cargada{lastSaved.text ? `: ${lastSaved.text}` : ''}.
            {lastSaved.count > 1 ? ` Llevás ${lastSaved.count}.` : null}
          </SavedNote>
        ) : null}

        {/* Dos columnas recién con lugar para las dos: la factura necesita su ancho. Más abajo, la foto
            va primero: con el papel en la mano, es lo primero que se hace. */}
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_286px] xl:items-start">
          <div className="@container min-w-0 overflow-clip rounded-xl border border-border/70 bg-card shadow-xs">
            {/* ── Arriba: proveedor · letra · número y fechas ── */}
            <div className="grid grid-cols-[minmax(0,1fr)_104px] @2xl:grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)]">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1.5 p-3">
                {party?.kind === 'new' ? (
                  <PaperField
                    id={ids('np-name')}
                    label="Proveedor nuevo"
                    required
                    error={errors.newPartyName}
                  >
                    <Input
                      id={ids('np-name')}
                      value={party.name}
                      maxLength={120}
                      autoComplete="off"
                      placeholder="La razón social"
                      aria-invalid={errors.newPartyName ? true : undefined}
                      onChange={(e) => setParty({ ...party, name: e.target.value })}
                      className={cn(COMPACT_INPUT, 'placeholder:text-muted-foreground/50')}
                    />
                    <button type="button" className={PAPER_LINK} onClick={() => setParty(null)}>
                      <X className="size-3" aria-hidden />
                      Elegir uno que ya está
                    </button>
                  </PaperField>
                ) : (
                  <PaperField
                    id={ids('party')}
                    label="Proveedor"
                    optional={paying && family === 'factura'}
                    required={!paying || family !== 'factura'}
                    error={errors.party}
                    aside={
                      existing && paying && family === 'factura' ? (
                        <button
                          type="button"
                          className={PAPER_LINK}
                          onClick={() => choosePartyId(null)}
                        >
                          Sin proveedor
                        </button>
                      ) : null
                    }
                  >
                    <FlashCell delay={flashDelay('party')}>
                      <PartyCombobox
                        id={ids('party')}
                        value={partyId}
                        onValueChange={(id) => choosePartyId(id)}
                        parties={partyOptions}
                        onCreate={(name) => startNewParty(name)}
                        placeholder="Nombre o CUIT"
                        invalid={Boolean(errors.party)}
                        className="md:h-9"
                      />
                    </FlashCell>
                    {partyDetail ? (
                      <p className="text-xs text-muted-foreground text-pretty">{partyDetail}</p>
                    ) : null}
                  </PaperField>
                )}

                {/* La categoría: de la ficha del proveedor, o se pregunta */}
                {party === null && !paying ? (
                  <p className="text-xs text-muted-foreground">
                    La cuenta sale sola del proveedor.
                  </p>
                ) : accountMode === 'fixed' && accountName ? (
                  <SupplierAccountLine
                    accountName={accountName}
                    onChange={() => {
                      setAccountChanging(true)
                      requestAnimationFrame(() => document.getElementById(ids('account'))?.focus())
                    }}
                  />
                ) : (
                  <PaperField id={ids('account')} label="Va a" required error={errors.account}>
                    <CategoryCombobox
                      id={ids('account')}
                      value={accountId}
                      selectedName={accountName}
                      options={categories.options}
                      featured={categories.featured}
                      pinned={categories.pinned}
                      invalid={Boolean(errors.account)}
                      onChange={(next) => {
                        touched.current.account = true
                        setAccountId(next)
                        posting.clearFieldErrors()
                      }}
                    />
                    {accountChanging && defaultAccountId !== null ? (
                      <p className="text-xs text-muted-foreground text-pretty">
                        Solo para esta compra.{' '}
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
                  </PaperField>
                )}

                {priorDebt !== null && priorDebt > 0 ? (
                  <p className="text-xs text-pretty">
                    Hoy le debés{' '}
                    <span className="font-semibold whitespace-nowrap tabular-nums">
                      {formatCentsShort(priorDebt)}
                    </span>
                  </p>
                ) : null}

                {cuitOffer && canPickParty ? (
                  <InlineNotice
                    tone="info"
                    action={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-8"
                        onClick={() =>
                          startNewParty('', {
                            taxId: formatCuit(cuitOffer.cuit),
                            condition: cuitOffer.condition,
                          })
                        }
                      >
                        Crear el proveedor
                      </Button>
                    }
                  >
                    La CUIT {formatCuit(cuitOffer.cuit)} no está entre tus proveedores.
                  </InlineNotice>
                ) : null}

                <RecurringPicker
                  id={ids('recurring')}
                  options={recurringToPick}
                  onPick={pickRecurring}
                />

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
              </div>

              <div className="flex flex-col items-center gap-1.5 border-l border-border/70 @2xl:border-x">
                <FlashCell delay={flashDelay('letter')} className="rounded-none rounded-b-sm">
                  <LetterStamp box={letterBox} />
                </FlashCell>
                <PaperPicks
                  picks={picks}
                  value={shownType}
                  invalid={Boolean(errors.voucherType)}
                  onPick={chooseVoucher}
                />
                {errors.voucherType && askInvoiced ? (
                  <p role="alert" className="px-2 pb-2 text-center text-xs text-destructive">
                    {errors.voucherType}
                  </p>
                ) : null}
              </div>

              <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1.5 border-t border-border/70 p-3 @2xl:col-span-1 @2xl:border-t-0">
                <p className="text-[13px] font-bold tracking-[0.07em]">{letterBox.title}</p>

                {/* Un organismo no tiene letra: se elige de la lista. */}
                {isTaxAgency && family === 'factura'
                  ? voucherSelect(voucherOptions, '¿Qué comprobante es?', true)
                  : null}

                {showNumber ? (
                  <PaperField
                    id={ids('number')}
                    label="Punto de venta y número"
                    required={shownNeedsNumber}
                    optional={!shownNeedsNumber}
                    error={errors.number}
                    hint={lastVoucher ? `La última fue ${lastVoucher}.` : undefined}
                  >
                    {/* Los ejemplos van apagados: apurado, el ejemplo parecía un número ya puesto. */}
                    <FlashCell
                      delay={flashDelay('number')}
                      className="[&_input]:placeholder:text-muted-foreground/50 md:[&_input]:h-9"
                    >
                      <VoucherNumberInput
                        id={ids('number')}
                        value={voucherNumber}
                        onChange={(next) => {
                          setVoucherNumber(next)
                          posting.clearFieldErrors()
                        }}
                        invalid={Boolean(errors.number)}
                        describedBy={lastVoucher ? `${ids('number')}-hint` : undefined}
                      />
                    </FlashCell>
                  </PaperField>
                ) : shownType === 'sin_comprobante' ? (
                  <PaperField id={ids('remito')} label="N.º de remito (si tiene)">
                    <Input
                      id={ids('remito')}
                      value={remito}
                      maxLength={REMITO_MAX}
                      autoComplete="off"
                      placeholder="Opcional"
                      onChange={(e) => {
                        setRemito(e.target.value)
                        posting.clearFieldErrors()
                      }}
                      className={cn(
                        COMPACT_INPUT,
                        'tabular-nums placeholder:text-muted-foreground/50',
                      )}
                    />
                  </PaperField>
                ) : shownType === 'tique' ? (
                  <button
                    type="button"
                    className={PAPER_LINK}
                    onClick={() => {
                      setTiqueNumber(true)
                      requestAnimationFrame(() => document.getElementById(ids('number'))?.focus())
                    }}
                  >
                    <Plus className="size-3" aria-hidden />
                    Tiene número: entra al Libro IVA
                  </button>
                ) : null}

                <div className="@container grid gap-2">
                  <div className="grid gap-2 @[17rem]:grid-cols-2">
                    <PaperField
                      id={ids('issueDate')}
                      label="Fecha"
                      required
                      error={errors.issueDate}
                      hint={closedMonth ?? undefined}
                    >
                      <FlashCell delay={flashDelay('date')}>
                        <DateInput
                          id={ids('issueDate')}
                          value={issueDate}
                          onValueChange={(next) => {
                            setIssueDate(next)
                            posting.clearFieldErrors()
                          }}
                          min={data.booksStartDate}
                          max={today}
                          today={today}
                          shortcuts={false}
                          invalid={Boolean(errors.issueDate)}
                          aria-describedby={closedMonth ? `${ids('issueDate')}-hint` : undefined}
                        />
                      </FlashCell>
                    </PaperField>
                    {!paying && !isCreditNote ? (
                      <PaperField id={ids('dueDate')} label="Vence" error={errors.dueDate}>
                        <DateInput
                          id={ids('dueDate')}
                          value={dueDate}
                          onValueChange={(next) => {
                            touched.current.due = true
                            setDueTouched(true)
                            setTermOverride(null)
                            setTermText(null)
                            setDueDate(next)
                            if (party?.kind === 'new') setParty({ ...party, paymentTermDays: 0 })
                            posting.clearFieldErrors()
                          }}
                          min={issueDate ?? undefined}
                          today={today}
                          shortcuts={false}
                          invalid={Boolean(errors.dueDate)}
                        />
                      </PaperField>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Proveedor nuevo: lo que falta saber de él ── */}
            {party?.kind === 'new' ? (
              <div className="grid gap-3 border-t border-border/70 bg-secondary/30 p-3.5">
                <div className="grid gap-3 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                  <PaperField
                    id={ids('np-cuit')}
                    label="Su CUIT"
                    required={voucherType !== null && entersIvaBook(voucherType)}
                    optional={!(voucherType !== null && entersIvaBook(voucherType))}
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
                        className={cn(
                          COMPACT_INPUT,
                          'tabular-nums placeholder:text-muted-foreground/50',
                        )}
                      />
                    </ArcaLookupTrigger>
                  </PaperField>
                  <div className="grid gap-1">
                    <span id={ids('np-cond')} className="text-xs font-medium text-muted-foreground">
                      ¿Cómo te factura?
                    </span>
                    <RadioChips
                      labelledBy={ids('np-cond')}
                      value={party.ivaCondition}
                      options={ivaOptionsWith(INVOICING_CHOICES, party.ivaCondition)}
                      onChange={(next) => {
                        if (!touched.current.voucher) setVoucherType(null)
                        setNewPartyIvaTouched(true)
                        setAsking(null)
                        setParty({ ...party, ivaCondition: next })
                      }}
                    />
                  </div>
                </div>
                <ArcaLookupPanel lookup={arca} />
                {/* Lo que contestó no coincide con el papel que tiene en la mano. */}
                {asking ? (
                  <InlineNotice
                    action={
                      conditionForVoucher(asking) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 md:h-8"
                          onClick={() => {
                            const next = conditionForVoucher(asking)
                            if (!next) return
                            pendingVoucher.current = asking
                            setNewPartyIvaTouched(true)
                            setParty({ ...party, ivaCondition: next })
                          }}
                        >
                          Es {conditionNoun(conditionForVoucher(asking) ?? party.ivaCondition)}
                        </Button>
                      ) : undefined
                    }
                  >
                    Dijiste que es {conditionNoun(party.ivaCondition)}, y así no da{' '}
                    {VOUCHER_CATALOG[asking].label}.
                  </InlineNotice>
                ) : null}
              </div>
            ) : null}

            {/* ── Lo que falta saber del proveedor para cargarle ese papel ── */}
            {existing && shownGap ? (
              <div className="border-t border-border/70 p-3.5">
                <SupplierInvoicingAsk
                  key={`${existing.id}:${shownGap.kind}:${asking ?? ''}`}
                  tenantSlug={tenantSlug}
                  party={existing}
                  gap={shownGap}
                  paper={paperOfVoucher(shownType)}
                  onSaved={() => {
                    // La letra que tocó queda marcada cuando lleguen las opciones nuevas.
                    pendingVoucher.current = asking
                    router.refresh()
                  }}
                  onCancel={askedGap ? () => setAsking(null) : undefined}
                />
              </div>
            ) : null}

            {/* ── Nota de crédito: qué compra corrige ── */}
            {isCreditNote ? (
              <div className="grid gap-1.5 border-t border-border/70 p-3.5">
                <span id={ids('related')} className="text-xs font-medium text-muted-foreground">
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
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-9"
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

            {/* ── Abajo: los totales y cómo queda ── */}
            <div className="grid gap-2.5 border-t border-border/70 p-3">
              <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,19.5rem)] @xl:items-start">
                {/* Los avisos van al lado de los totales: no empujan el resto para abajo. */}
                <div className="order-last grid content-start gap-2 @xl:order-none">
                  {duplicate ? (
                    <InlineNotice
                      action={
                        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
                          <Link href={documentHref(tenantSlug, duplicate.documentId)}>
                            Ir al comprobante
                          </Link>
                        </Button>
                      }
                    >
                      {duplicate.match === 'number'
                        ? `Ya cargaste ${duplicate.label}${duplicate.partyName ? ` de ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` el ${formatIsoDay(duplicate.accountingDate)}` : ''}.`
                        : `Ya hay un comprobante de ${duplicate.totalCents !== null ? formatCentsShort(duplicate.totalCents) : 'ese importe'}${duplicate.partyName ? ` de ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` del ${formatIsoDay(duplicate.accountingDate)}` : ''} (${duplicate.label}). ¿Es otro?`}
                    </InlineNotice>
                  ) : null}
                  {looksOff && existing && defaults?.medianTotalCents ? (
                    <InlineNotice>
                      ¿Seguro? Con {supplierName} solés gastar alrededor de{' '}
                      {formatCentsShort(defaults.medianTotalCents)}.
                    </InlineNotice>
                  ) : null}
                  {voucherHint && !asking ? (
                    <p className="text-xs text-muted-foreground text-pretty">{voucherHint}</p>
                  ) : null}
                  {/* Con un importe a la vista: antes no hay nada que «figure como vencido». */}
                  {dueSameDayWarning({ issueDate, dueDate, paying }) &&
                  !isCreditNote &&
                  dueAnswered &&
                  total !== null ? (
                    <InlineNotice tone="info">
                      Así, desde mañana va a figurar como vencida. Si le pagás más adelante, poné a
                      cuántos días.
                    </InlineNotice>
                  ) : null}
                </div>

                <div className="grid gap-0.5 text-sm">
                  {amountMode === 'total' ? (
                    <>
                      {vat ? (
                        <>
                          <TotalLine
                            label="Neto gravado"
                            value={split ? formatCents(split.netCents) : '–'}
                          />
                          <TotalLine
                            label={
                              <span className="inline-flex items-center gap-1.5">
                                IVA
                                <Select
                                  value={String(vatRateBp)}
                                  onValueChange={(v) => {
                                    setVatRateBp(Number(v) as VatRateBp)
                                    setVatAdjust(0)
                                  }}
                                >
                                  <SelectTrigger
                                    size="sm"
                                    aria-label="Alícuota de IVA"
                                    aria-invalid={errors.vatRate ? true : undefined}
                                    className="gap-1 px-2 text-xs tabular-nums data-[size=sm]:h-11 md:data-[size=sm]:h-7"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {VAT_RATES.map((rate) => (
                                      <SelectItem
                                        key={rate}
                                        value={String(rate)}
                                        className="min-h-11 md:min-h-8"
                                      >
                                        {vatRateLabel(rate)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {split && !recovers ? (
                                  <span className="text-xs">va al costo</span>
                                ) : null}
                              </span>
                            }
                            value={split ? formatCents(split.vatCents) : '–'}
                          />
                          {errors.vatRate ? (
                            <p role="alert" className="text-xs text-destructive">
                              {errors.vatRate}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      {extrasCents > 0 ? (
                        <TotalLine
                          label="Percepciones e impuestos"
                          value={formatCents(extrasCents)}
                        />
                      ) : null}
                      <div className="mt-1 flex items-center justify-between gap-3 border-t border-foreground border-b-[3px] border-b-foreground/80 [border-bottom-style:double] py-1.5 font-semibold">
                        <label htmlFor={ids('total')}>
                          Total
                          <span aria-hidden="true" className="ml-0.5 text-destructive">
                            *
                          </span>
                          <span className="sr-only">, en pesos</span>
                        </label>
                        <FlashCell delay={flashDelay('total')} className="w-44">
                          <MoneyInput
                            id={ids('total')}
                            value={totalCents}
                            align="end"
                            required
                            invalid={Boolean(errors.total)}
                            aria-describedby={errors.total ? `${ids('total')}-error` : undefined}
                            onValueChange={(cents) => {
                              setTotalCents(cents)
                              posting.clearFieldErrors()
                            }}
                            className="[&_input]:text-lg [&_input]:font-semibold md:[&_input]:h-9"
                          />
                        </FlashCell>
                      </div>
                      {errors.total ? (
                        <p
                          id={`${ids('total')}-error`}
                          role="alert"
                          className="text-right text-xs text-destructive"
                        >
                          {errors.total}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <TotalLine
                        label={vat ? 'Neto' : 'Importe'}
                        value={detail.netCents > 0 ? formatCents(detail.netCents) : '–'}
                      />
                      {vat ? (
                        <TotalLine
                          label="IVA"
                          value={detail.vatCents > 0 ? formatCents(detail.vatCents) : '–'}
                        />
                      ) : null}
                      {detail.otherCents > 0 ? (
                        <TotalLine label="Otros" value={formatCents(detail.otherCents)} />
                      ) : null}
                      <div className="mt-1 flex min-h-10 items-center justify-between gap-3 border-t border-foreground border-b-[3px] border-b-foreground/80 [border-bottom-style:double] py-1.5 text-lg font-semibold">
                        <span className="text-sm">Total</span>
                        <span className="tabular-nums">
                          {detail.totalCents > 0 ? formatCents(detail.totalCents) : '–'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* La nota de crédito no se paga: queda a favor. */}
              {isCreditNote ? null : (
                <PayOptions
                  paying={paying}
                  onChange={setPaying}
                  debtLine={
                    <DueTermLine
                      id={ids('term')}
                      term={dueTerm}
                      editable={!paying}
                      value={shownTerm}
                      invalid={Boolean(errors.dueDate)}
                      onChange={(text) => {
                        setTermText(text)
                        const days = parseTermDays(text)
                        if (days !== null) applyTerm(days)
                      }}
                      onBlur={() => setTermText(null)}
                      onNoDate={setNoDue}
                      onSuggestion={applyTerm}
                      onPutTerm={() => applyTerm(Math.max(0, termDays))}
                    />
                  }
                  paidLine={
                    <span className="text-xs text-muted-foreground">
                      {paying && !hasParty
                        ? 'Sin proveedor: un gasto de contado'
                        : 'Es una compra y pago'}
                    </span>
                  }
                />
              )}

              {/* «Pagarle siempre a N días», solo con un plazo que la persona acaba de escribir */}
              {offeredTerm !== null && existing && existing.paymentTermDays === 0 ? (
                <button
                  type="button"
                  className={PAPER_LINK}
                  disabled={savingTerm}
                  onClick={() => void saveTerm(offeredTerm)}
                >
                  {savingTerm ? 'Guardando…' : `Pagarle siempre a ${offeredTerm} días`}
                </button>
              ) : null}
              {party?.kind === 'new' && offeredTerm !== null ? (
                <label
                  htmlFor={ids('np-term')}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground md:min-h-0"
                >
                  <Checkbox
                    id={ids('np-term')}
                    checked={party.paymentTermDays === offeredTerm}
                    onCheckedChange={(checked) =>
                      setParty({ ...party, paymentTermDays: checked === true ? offeredTerm : 0 })
                    }
                  />
                  Pagarle siempre a {offeredTerm} días
                </label>
              ) : null}

              {/* «Salió de» y lo poco que un pago puede necesitar además */}
              {paying && payNow ? (
                <div className="grid gap-x-4 gap-y-2 @lg:grid-cols-[minmax(0,16.25rem)_minmax(0,1fr)] @lg:items-start">
                  <PaperField
                    id={ids('payTreasury')}
                    label="Salió de"
                    required
                    error={errors.payTreasury}
                  >
                    <TreasurySelect
                      id={ids('payTreasury')}
                      value={payNow.treasuryAccountId}
                      onValueChange={(next) => {
                        touched.current.treasury = true
                        setPayNow({ ...payNow, treasuryAccountId: next })
                        posting.clearFieldErrors()
                      }}
                      treasuries={data.treasuries}
                      invalid={Boolean(errors.payTreasury)}
                      className="md:data-[size=default]:h-9"
                    />
                    {bankTaxCents > 0 && taxSettings ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Impuesto al cheque {bpLabel(taxSettings.bankTaxBp)}:{' '}
                        <span className="font-medium text-foreground">
                          {formatCents(bankTaxCents)}
                        </span>
                      </p>
                    ) : null}
                    {payTreasury && canNameTreasury ? (
                      <p
                        className={cn(
                          'text-xs text-pretty',
                          treasuryShort ? 'text-warning-text' : 'text-muted-foreground',
                        )}
                      >
                        <TreasuryAfterHint treasury={payTreasury} amountCents={payAmount} />
                        {treasuryShort
                          ? '. Con lo cargado no alcanza; lo podés guardar igual.'
                          : null}
                      </p>
                    ) : null}
                  </PaperField>

                  {/* Sin proveedor es un gasto de contado: nada de esto aplica. */}
                  {hasParty ? (
                    <div className="grid content-start gap-2 @lg:pt-5">
                      {payPartial || payNow.amountCents !== null || errors.payAmount ? (
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
                              : undefined
                          }
                        />
                      ) : null}
                      {payDateOpen || payNow.date !== today || errors.payDate ? (
                        <PaperField
                          id={ids('payDate')}
                          label="Fecha del pago"
                          error={errors.payDate}
                        >
                          <DateInput
                            id={ids('payDate')}
                            value={payNow.date}
                            onValueChange={(next) => setPayNow({ ...payNow, date: next })}
                            min={issueDate ?? data.booksStartDate}
                            max={today}
                            today={today}
                            shortcuts={false}
                            invalid={Boolean(errors.payDate)}
                          />
                        </PaperField>
                      ) : null}
                      {showPayReference || payNow.reference || errors.payReference ? (
                        <PaperField
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
                            className={COMPACT_INPUT}
                          />
                        </PaperField>
                      ) : null}
                      <div className="flex flex-wrap gap-x-3">
                        {payPartial || payNow.amountCents !== null ? null : (
                          <button
                            type="button"
                            className={PAPER_LINK}
                            onClick={() => {
                              setPayPartial(true)
                              requestAnimationFrame(() =>
                                document.getElementById(ids('payAmount'))?.focus(),
                              )
                            }}
                          >
                            <Plus className="size-3" aria-hidden />
                            Pagué solo una parte
                          </button>
                        )}
                        {payDateOpen || payNow.date !== today ? null : (
                          <button
                            type="button"
                            className={PAPER_LINK}
                            onClick={() => {
                              setPayDateOpen(true)
                              requestAnimationFrame(() =>
                                document.getElementById(ids('payDate'))?.focus(),
                              )
                            }}
                          >
                            <Plus className="size-3" aria-hidden />
                            Otra fecha de pago
                          </button>
                        )}
                        {showPayReference || payNow.reference ? null : (
                          <button
                            type="button"
                            className={PAPER_LINK}
                            onClick={() => {
                              setShowPayReference(true)
                              requestAnimationFrame(() =>
                                document.getElementById(ids('payReference'))?.focus(),
                              )
                            }}
                          >
                            <Plus className="size-3" aria-hidden />
                            N.º de transferencia
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ── El asiento, plegado ── */}
            <EntryPreview
              entries={entries}
              label="Ver el asiento"
              emptyText={
                total === null
                  ? 'Escribí el total y lo ves acá.'
                  : 'Completá lo que falta y lo ves acá.'
              }
              className="rounded-none border-x-0 border-t border-b-0 border-border/70 bg-transparent before:hidden md:[&_button]:min-h-9 md:[&>div:first-child]:min-h-0 md:[&>div:first-child]:py-0"
            />

            {/* ── Lo que no se usa todos los días ── */}
            <div className="border-t border-border/70">
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls={ids('more')}
                onClick={() => setMoreOpen((open) => !open)}
                className="flex min-h-11 w-full items-center gap-1.5 px-4 text-left text-sm font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:min-h-9"
              >
                <Plus
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                    moreOpen && 'rotate-45',
                  )}
                  aria-hidden
                />
                Más opciones
                {moreInUse.length > 0 && !moreOpen ? (
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    · {moreInUse.join(', ')}
                  </span>
                ) : null}
              </button>

              {moreOpen ? (
                <div id={ids('more')} className="adm-rise grid gap-5 px-4 pt-1 pb-4">
                  {/* El papel */}
                  <div className="grid gap-3 @lg:grid-cols-2 @lg:items-start">
                    {family === 'factura' && !isTaxAgency && otherTypes.length > 0
                      ? voucherSelect(otherTypes, 'Es otro papel', false)
                      : null}
                    <div className="grid content-start gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {family === 'factura'
                          ? '¿No es una compra?'
                          : `Estás cargando ${FAMILY_WORDS[family]}.`}
                      </span>
                      <div className="flex flex-wrap gap-x-3">
                        {family === 'factura' ? (
                          <>
                            <button
                              type="button"
                              className={PAPER_LINK}
                              onClick={() => switchFamily('nc')}
                            >
                              Es una nota de crédito
                            </button>
                            <button
                              type="button"
                              className={PAPER_LINK}
                              onClick={() => switchFamily('nd')}
                            >
                              Es una nota de débito
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={PAPER_LINK}
                            onClick={() => switchFamily('factura')}
                          >
                            Es una compra común
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* El ajuste de centavos del IVA */}
                  {split && vatRateBp !== 0 && amountMode === 'total' ? (
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
                          onClick={() => setVatAdjust((v) => Math.max(-VAT_ADJUST_LIMIT, v - 1))}
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
                          onClick={() => setVatAdjust((v) => Math.min(VAT_ADJUST_LIMIT, v + 1))}
                        >
                          +1¢
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={PAPER_LINK}
                        onClick={() => setShowVatAdjust(true)}
                      >
                        ¿El IVA del papel no coincide por centavos?
                      </button>
                    )
                  ) : null}

                  {/* Más renglones */}
                  {amountMode === 'total' ? (
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
                  ) : (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p className="text-sm font-semibold">
                          Renglón por renglón, como está en el papel
                        </p>
                        <button
                          type="button"
                          className={PAPER_LINK}
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
                                className="grid gap-2 @lg:grid-cols-2 @lg:items-start"
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
                      <MoneyField
                        id={ids('controlTotal')}
                        label="Total según el papel"
                        optional
                        value={controlTotalCents}
                        align="end"
                        onValueChange={setControlTotalCents}
                        error={errors.controlTotal ?? null}
                        hint="Para controlar que cargaste todo."
                        fieldClassName="@lg:max-w-[50%]"
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
                  )}

                  {/* Percepciones e impuestos (los dos modos) */}
                  {showExtras ||
                  percIvaCents ||
                  percIibbCents ||
                  percGananciasCents ||
                  otherTaxesCents ? (
                    <div className="grid gap-3">
                      <p className="text-sm font-semibold">
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
                        <MoneyField
                          id={ids('percIibb')}
                          label="Percepción de Ingresos Brutos"
                          optional
                          value={percIibbCents}
                          align="end"
                          onValueChange={setPercIibbCents}
                          error={errors.percIibb ?? null}
                        />
                        <PaperField
                          id={ids('percIibbJurisdiction')}
                          label="Provincia"
                          error={errors.percIibbJurisdiction}
                          className="@lg:pt-[3px]"
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
                        </PaperField>
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
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowExtras(true)} className={ADD_LINK}>
                      <Plus className="size-3.5" aria-hidden />
                      Tiene percepciones u otros impuestos
                    </button>
                  )}

                  {/* La nota */}
                  <PaperField id={ids('notes')} label="Nota" optional error={errors.notes}>
                    <Textarea
                      id={ids('notes')}
                      value={notes}
                      maxLength={detailRoom(
                        remitoActive ? remito : '',
                        hasParty ? NOTES_MAX : QUICK_DETAIL_MAX,
                      )}
                      rows={2}
                      onChange={(e) => setNotes(e.target.value)}
                      className="text-base md:text-sm"
                    />
                  </PaperField>
                </div>
              ) : null}
            </div>

            {unknownPreviewError || posting.banner ? (
              <div className="grid gap-2 border-t border-border/70 p-3.5">
                {unknownPreviewError ? (
                  <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
                ) : null}
                <FormBanner banner={posting.banner} />
              </div>
            ) : null}

            {/* ── El pie: en el celular queda siempre a mano ── */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:bg-card md:bg-secondary/40">
              <label
                htmlFor={ids('another')}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground md:min-h-0"
              >
                <Checkbox
                  id={ids('another')}
                  checked={another}
                  onCheckedChange={(checked) => setAnother(checked === true)}
                />
                Cargar otra
              </label>
              {/* En el celular, el botón en su propio renglón: con el importe no entra al lado del tilde. */}
              <div className="flex min-w-0 flex-1 items-center justify-end gap-3 max-sm:basis-full">
                <span
                  className="hidden text-[11px] text-muted-foreground lg:inline"
                  title="⇧⌘↵ guarda y deja lista otra"
                >
                  ⌘↵ guarda
                </span>
                <Button
                  type="submit"
                  className="h-11 max-sm:w-full md:h-9"
                  disabled={posting.pending || attaching}
                >
                  {posting.pending ? 'Guardando…' : attaching ? 'Subiendo la foto…' : submitLabel}
                </Button>
              </div>
            </div>
          </div>

          <aside className="order-first min-w-0 xl:sticky xl:top-28 xl:order-none">
            <FotoPanel
              key={panelNonce}
              tenantSlug={tenantSlug}
              files={files}
              onFiles={setFiles}
              onRead={applyRead}
              takeDropped={takeDropped}
              disabled={posting.pending}
            />
          </aside>
        </div>
      </form>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onConfirm={posting.confirmWarnings}
        onCancel={posting.dismissWarnings}
      />
    </SimplePage>
  )
}
