'use client'

import { Plus } from 'lucide-react'
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
import {
  ExpenseTargetPicker,
  payableParties,
  type TargetAccountPlan,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/expense-target-picker'
import {
  FormBanner,
  InlineNotice,
  RadioChips,
  SheetLoadError,
  SheetSkeleton,
  WarningsDialog,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/form-feedback'
import { rememberSupplierAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-account'
import { SupplierInvoicingAsk } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-invoicing-ask'
import {
  type SavedState,
  useDocumentPosting,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-document-posting'
import { useSheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-sheet-data'
import {
  padNumber,
  padPos,
  VoucherNumberInput,
  type VoucherNumberValue,
  voucherPart,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/voucher-number-input'
import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import { documentHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { invoicingGap } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase-paper'
import {
  amountAfterRecurring,
  buildQuickExpenseValues,
  detailRoom,
  type ExpenseTarget,
  isInvoiceVoucher,
  isQuickVatRate,
  QUICK_DETAIL_MAX,
  QUICK_VAT_RATES,
  type QuickExpenseFormValues,
  type QuickVatRate,
  type QuickVoucher,
  quickExpenseOutcome,
  quickVoucherInvoiced,
  REMITO_MAX,
  recurringPrefill,
  sortRecurringForSheet,
  splitTotal,
  suggestQuickVatRate,
  suggestQuickVoucher,
  VAT_ADJUST_LIMIT,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  findDuplicate,
  loadPartyDefaults,
  loadSheetData,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions'
import type {
  QuickSuggestion,
  SheetData,
  SheetDuplicate,
  SheetParty,
  SheetPartyDefaults,
  SheetRecurring,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import {
  accountAsk,
  accountToRemember,
  supplierDefaultAccount,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-account'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postQuickExpense } from '@/lib/accounting/actions/documents'
import { amountLooksOff, pickTreasury } from '@/lib/accounting/defaults'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { IvaCondition } from '@/lib/accounting/types'
import { formatDayLabel, formatIsoDay, formatMonthYear } from '@/lib/dates'
import { EMPTY_VALUE, formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ACTION_SHEET_QUESTION,
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
  ActionSheetRequiredMark,
} from '../action-sheet'
import { AttachmentPicker } from '../adjuntos/attachment-picker'
import { attachPendingFiles } from '../adjuntos/upload'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { MoneyField } from '../money-input'
import { TreasurySelect } from '../treasury-select'
import {
  exactAmountText,
  missingForSummary,
  paidFromWords,
  paperConsequence,
  paperOutcomeNote,
  paperStamp,
  recoveredVatFromPreview,
  recoversVat,
  ticketTotalLabel,
  treasuryMoneyText,
} from './gasto-papel'
import {
  FooterSummary,
  GastoTicket,
  type GastoTicketRow,
  PaperChoices,
  SavedNote,
  TreasuryAfterHint,
  TreasuryAfterLine,
} from './gasto-piezas'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.gasto
const DESCRIPTION = 'Lo que pagaste en el momento, con o sin factura.'
const LAST_TREASURY_KEY = 'hub_acc_gasto_caja:'

/**
 * El envoltorio de cada pregunta. Una sola columna que se puede achicar
 * (`minmax(0, 1fr)`): con la columna automática de un `grid` pelado, un nombre
 * largo en la tarjeta de lo elegido la estiraba y «Cambiar» se salía de la hoja.
 */
const QUESTION_BLOCK = 'grid grid-cols-[minmax(0,1fr)] gap-2.5'

/**
 * «¿En qué se gastó?» por fuera (`ExpenseTargetPicker` no es de esta hoja):
 * - aire entre las píldoras y «Buscar otro…» (el `m-0` de su `fieldset` le pisaba el margen);
 * - en el celular, las seis primeras píldoras (los gastos fijos que vencen y lo más usado):
 *   las demás siguen en «Buscar otro…», que las lista. Con nueve eran una pantalla entera;
 * - los ejemplos de los campos vacíos (el CUIT de un proveedor nuevo), más apagados para
 *   que no parezcan un dato ya cargado;
 * - en el celular, «Va a «…» · Cambiar» sin el hueco que le dejaban sus 44 px de toque
 *   (el área de toque no cambia: se compensa con margen negativo);
 * - en la tarjeta de lo elegido, un nombre largo baja a dos renglones antes de cortarse, y
 *   en el celular «Gasto fijo «…» · vence el …» baja entero en vez de perder la fecha.
 */
const TARGET_BLOCK = cn(
  QUESTION_BLOCK,
  '[&_fieldset]:mb-2.5',
  'max-sm:[&_fieldset>button:nth-of-type(n+7)]:hidden',
  '[&_input]:placeholder:text-muted-foreground/50',
  "max-md:[&_button[aria-label^='Cambiar_la_cuenta']]:-my-3",
  '[&_p.truncate.font-medium]:line-clamp-2 [&_p.truncate.font-medium]:whitespace-normal',
  'max-sm:[&_p>span.truncate]:whitespace-normal',
)

/** El ejemplo de un campo vacío («0001-00001234»): apagado, para que no parezca un dato ya cargado. */
const FAINT_EXAMPLE = 'placeholder:text-muted-foreground/50'

/** Un link de texto dentro del formulario. 44 px de alto en el celular y foco a la vista. */
const TEXT_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/** «＋ Agregar …»: abre un campo opcional que casi nunca hace falta. */
const ADD_LINK =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/**
 * Una de las cuatro decisiones de la hoja: se lee como pregunta (Fraunces, la voz que
 * comparten las seis hojas); lo demás, como campos. El `id` es el que usa su grupo como etiqueta.
 */
function Question({
  id,
  required = false,
  children,
}: {
  id: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <span id={id} className={ACTION_SHEET_QUESTION}>
      {children}
      {required ? <ActionSheetRequiredMark /> : null}
    </span>
  )
}

/** Hasta cuántas cajas se muestran como chips (más: un desplegable). */
const MAX_TREASURY_CHIPS = 4

/** Los campos que este formulario dibuja (el resto del error va arriba de los botones). */
const KNOWN_FIELDS = new Set([
  'amountCents',
  'target',
  'target.partyId',
  'target.accountId',
  'newParty',
  'newParty.name',
  'newParty.taxId',
  'treasuryAccountId',
  'voucher',
  'vatRateBp',
  'vatAdjustCents',
  'pointOfSale',
  'number',
  'date',
  'detail',
])

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

/** Hoja «Nuevo gasto» (H.5): lo de todos los días, con o sin factura, pagado en el momento. */
export function GastoSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetData(
    () => loadSheetData(tenantSlug, { suggestions: true, recurring: true }),
    tenantSlug,
  )
  if (!load.data) {
    return (
      <>
        <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
        <ActionSheetBody>
          {load.status === 'error' ? (
            <SheetLoadError message={load.message} onRetry={load.reload} />
          ) : (
            <SheetSkeleton />
          )}
        </ActionSheetBody>
      </>
    )
  }
  return <GastoForm {...props} data={load.data} reload={load.reload} />
}

type FormProps = ActionSheetProps & { data: SheetData; reload: () => void }

function GastoForm({ tenantSlug, params, close, setDirty, data, reload }: FormProps) {
  const router = useRouter()
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<HTMLDivElement>(null)

  const activeTreasuries = useMemo(() => data.treasuries.filter((t) => t.active), [data.treasuries])
  const partyById = useMemo(() => new Map(data.parties.map((p) => [p.id, p])), [data.parties])
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts])
  const imputable = useMemo(
    () => new Set(data.accounts.filter(isPurchaseImputation).map((a) => a.id)),
    [data.accounts],
  )
  // Gastos fijos que se pueden elegir (con proveedor o cuenta que sirvan), los pendientes primero.
  const recurringUsable = useMemo(
    () => ({
      payablePartyIds: new Set(payableParties(data.parties).map((p) => p.id)),
      imputableAccountIds: imputable,
      activeTreasuryIds: new Set(activeTreasuries.map((t) => t.id)),
    }),
    [data.parties, imputable, activeTreasuries],
  )
  const recurringOptions = useMemo(
    () =>
      sortRecurringForSheet(
        data.recurring.filter((r) => recurringPrefill(r, recurringUsable) !== null),
      ),
    [data.recurring, recurringUsable],
  )

  const defaultTreasury = useCallback(
    (lastWithParty: string | null) =>
      pickTreasury({
        treasuries: activeTreasuries,
        lastUsedWithParty: lastWithParty,
        myLastQuickExpense: rememberedTreasury(tenantSlug),
        order: data.treasuries.map((t) => t.id),
      }),
    [activeTreasuries, data.treasuries, tenantSlug],
  )

  const [amount, setAmount] = useState<number | null>(null)
  const [target, setTarget] = useState<ExpenseTarget | null>(null)
  const [treasuryId, setTreasuryId] = useState<string | null>(() => defaultTreasury(null))
  const [voucher, setVoucher] = useState<QuickVoucher>('none')
  const [vatRate, setVatRate] = useState<QuickVatRate>(2100)
  const [vatAdjust, setVatAdjust] = useState(0)
  const [voucherNumber, setVoucherNumber] = useState<VoucherNumberValue>({ pos: '', number: '' })
  const [date, setDate] = useState<string | null>(data.today)
  const [detail, setDetail] = useState('')
  const [showDetail, setShowDetail] = useState(false)
  // «N.º de remito» (opcional, con «No se factura»): va adelante del detalle.
  const [remito, setRemito] = useState('')
  const [showRemito, setShowRemito] = useState(false)
  // La cuenta sale de la ficha del proveedor: [Cambiar] la abre solo para este gasto.
  const [accountChanging, setAccountChanging] = useState(false)
  // «Usar siempre para …»: tildado si el proveedor todavía no tiene cuenta habitual.
  const [rememberAccount, setRememberAccount] = useState(true)
  // Lo que hay que hacer después de guardar, tal como estaba al tocar «Cargar gasto».
  const rememberOnSave = useRef<{ party: SheetParty; accountId: string } | null>(null)
  // La foto o el PDF del comprobante: se elige acá y se sube después de guardar.
  const [files, setFiles] = useState<File[]>([])
  // Subiendo esos archivos: `closing` = la hoja espera para cerrarse; `staying` = «Cargar otro después».
  const [attaching, setAttaching] = useState<'closing' | 'staying' | null>(null)
  const mounted = useRef(true)
  const [loadAnother, setLoadAnother] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Sube cada vez que la persona elige un papel: el sello del ticket entra de nuevo.
  const [stampNonce, setStampNonce] = useState(0)
  // El ajuste de ±1¢ del IVA queda plegado hasta que haga falta.
  const [showVatAdjust, setShowVatAdjust] = useState(false)
  // Con «Cargar otro después»: lo último que se cargó y cuántos van, para no perder el hilo.
  const [lastSaved, setLastSaved] = useState<{ text: string; count: number } | null>(null)
  // `?gasto-fijo=` trajo uno que ya no se puede cargar desde acá (se dio de baja o quedó sin
  // proveedor ni categoría que sirvan).
  const [recurringMissing, setRecurringMissing] = useState(false)
  const [defaults, setDefaults] = useState<SheetPartyDefaults | null>(null)
  const [duplicate, setDuplicate] = useState<SheetDuplicate | null>(null)
  // Lo que la persona tocó a mano no lo pisa lo que el sistema recuerda.
  const touched = useRef({ voucher: false, treasury: false })
  const defaultsSeq = useRef(0)
  // El gasto fijo elegido en «¿En qué?»: va al guardar (queda «Cargado» y avanza su vencimiento).
  const [recurringId, setRecurringId] = useState<string | null>(null)
  // Lo que trajo el gasto fijo tampoco lo pisa lo que el sistema recuerda del proveedor.
  const fromRecurring = useRef({ voucher: false, treasury: false, vatRate: false })
  // La cuenta y el monto que puso el gasto fijo (cambiar la cuenta lo desvincula; el monto se reemplaza solo si nadie lo tocó).
  const recurringAccount = useRef<string | null>(null)
  const prefilledAmount = useRef<number | null>(null)

  const partyId = target?.kind === 'party' ? target.partyId : null
  const party = partyId ? (partyById.get(partyId) ?? null) : null
  const condition: IvaCondition | null =
    target?.kind === 'new' ? target.ivaCondition : (party?.ivaCondition ?? null)
  const hasParty = target?.kind === 'party' || target?.kind === 'new'
  const pointOfSale = voucherPart(voucherNumber.pos)
  const number = voucherPart(voucherNumber.number)
  // Cómo se nombra lo elegido en el ticket y en «recién cargado»: el proveedor (como se lo
  // conoce) y, aparte, su categoría; sin proveedor, la categoría sola.
  const targetAccount = target?.accountId ? accountById.get(target.accountId) : undefined
  const targetName =
    target === null
      ? null
      : target.kind === 'party'
        ? party
          ? (party.tradeName ?? party.name)
          : null
        : target.kind === 'new'
          ? target.name.trim() || 'Proveedor nuevo'
          : (targetAccount?.name ?? null)
  const categoryName =
    target !== null && target.kind !== 'account' ? targetAccount?.name : undefined

  // ── Lo que el sistema recuerda de un proveedor (H.5) ──
  const applyPartyDefaults = useCallback(
    async (id: string, suggestion: QuickSuggestion | null) => {
      const seq = ++defaultsSeq.current
      const known = partyById.get(id)
      setDefaults(null)
      setDuplicate(null)
      // Al toque, con lo que ya está en el catálogo (y el chip). El «Comprobante habitual» de la
      // ficha manda; si no tiene, el último que se le cargó.
      if (!touched.current.voucher && !fromRecurring.current.voucher) {
        setVoucher(
          suggestQuickVoucher({
            hasParty: true,
            habitualVoucherType: known?.defaultVoucherType ?? null,
            lastVoucherType: suggestion?.voucherType ?? null,
            condition: known?.ivaCondition ?? null,
          }),
        )
      }
      if (
        !touched.current.treasury &&
        !fromRecurring.current.treasury &&
        suggestion?.treasuryAccountId
      ) {
        setTreasuryId(defaultTreasury(suggestion.treasuryAccountId))
      }
      let result: Awaited<ReturnType<typeof loadPartyDefaults>>
      try {
        result = await loadPartyDefaults(tenantSlug, id)
      } catch {
        return
      }
      if (seq !== defaultsSeq.current || !result.ok || !result.data) return
      const d = result.data
      setDefaults(d)
      setTarget((prev) =>
        prev?.kind === 'party' && prev.partyId === id && prev.accountId === null
          ? {
              ...prev,
              accountId: d.accountId && imputable.has(d.accountId) ? d.accountId : null,
            }
          : prev,
      )
      if (!touched.current.voucher && !fromRecurring.current.voucher) {
        setVoucher(
          suggestQuickVoucher({
            hasParty: true,
            habitualVoucherType: known?.defaultVoucherType ?? null,
            lastVoucherType: d.voucherType,
            condition: known?.ivaCondition ?? null,
          }),
        )
      }
      if (!fromRecurring.current.vatRate) setVatRate(suggestQuickVatRate(d.vatRateBp))
      if (d.pointOfSale !== null) {
        setVoucherNumber((prev) =>
          prev.pos === '' ? { ...prev, pos: padPos(String(d.pointOfSale)) } : prev,
        )
      }
      if (!touched.current.treasury && !fromRecurring.current.treasury && d.treasuryAccountId) {
        setTreasuryId(defaultTreasury(d.treasuryAccountId))
      }
    },
    [defaultTreasury, imputable, partyById, tenantSlug],
  )

  /** Desvincula el gasto fijo (se eligió otra cosa o se cambió la cuenta). */
  const unlinkRecurring = () => {
    setRecurringId(null)
    recurringAccount.current = null
    fromRecurring.current = { voucher: false, treasury: false, vatRate: false }
  }

  /** Otra elección en «¿En qué?»: la cuenta vuelve a salir de la ficha y el remito se vacía. */
  const resetAccountChoice = () => {
    setAccountChanging(false)
    setRememberAccount(true)
    setRemito('')
    setShowRemito(false)
  }

  const pickTarget = (next: ExpenseTarget, suggestion: QuickSuggestion | null) => {
    unlinkRecurring()
    resetAccountChoice()
    touched.current.voucher = false
    setVatAdjust(0)
    setVoucherNumber({ pos: '', number: '' })
    posting.clearFieldErrors()
    if (next.kind === 'party') {
      setTarget(next)
      void applyPartyDefaults(next.partyId, suggestion)
    } else if (next.kind === 'new') {
      defaultsSeq.current += 1
      setDefaults(null)
      setDuplicate(null)
      setTarget(next)
      setVoucher(suggestQuickVoucher({ hasParty: true, condition: next.ivaCondition }))
    } else {
      defaultsSeq.current += 1
      setDefaults(null)
      setDuplicate(null)
      setTarget(next)
      setVoucher('none')
      if (!touched.current.treasury && suggestion?.treasuryAccountId) {
        setTreasuryId(defaultTreasury(suggestion.treasuryAccountId))
      }
    }
  }

  // ── Un gasto fijo: su proveedor o su cuenta, y lo habitual (todo se puede cambiar) ──
  const pickRecurring = (r: SheetRecurring) => {
    const prefill = recurringPrefill(r, recurringUsable)
    if (!prefill) return
    const treasuryFromRecurring =
      prefill.treasuryAccountId !== null && !touched.current.treasury
        ? prefill.treasuryAccountId
        : null
    // Primero lo de cualquier elección (vacía el número, desvincula el anterior); después, lo suyo.
    pickTarget(prefill.target, null)
    setRecurringId(r.id)
    recurringAccount.current = prefill.target.accountId
    fromRecurring.current = {
      voucher: prefill.voucher !== null,
      treasury: treasuryFromRecurring !== null,
      vatRate: prefill.vatRateBp !== null,
    }
    if (prefill.voucher !== null) setVoucher(prefill.voucher)
    if (prefill.vatRateBp !== null) setVatRate(prefill.vatRateBp)
    if (treasuryFromRecurring !== null) setTreasuryId(treasuryFromRecurring)
    const nextAmount = amountAfterRecurring({
      current: amount,
      prefilled: prefilledAmount.current,
      recurring: prefill.amountCents,
    })
    if (nextAmount !== amount) setAmount(nextAmount)
    prefilledAmount.current = nextAmount === prefill.amountCents ? prefill.amountCents : null
  }

  // «Pagar» de un gasto fijo (?gasto-fijo=): arranca con ese gasto fijo elegido, igual que si se
  // lo hubiera tocado en «¿En qué se gastó?». «Nuevo gasto con este proveedor» (?proveedor=):
  // arranca con el proveedor elegido. Si vienen los dos, manda el gasto fijo (trae su proveedor).
  const initialRecurring = params['gasto-fijo']
  const initialParty = params.proveedor
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir la hoja
  useEffect(() => {
    if (initialRecurring) {
      const found = recurringOptions.find((r) => r.id === initialRecurring)
      if (found) {
        pickRecurring(found)
        return
      }
      setRecurringMissing(true)
    }
    if (!initialParty) return
    const known = partyById.get(initialParty)
    if (!known?.active) return
    const account = supplierDefaultAccount(known.defaultAccountId, imputable)
    setTarget({ kind: 'party', partyId: known.id, accountId: account })
    void applyPartyDefaults(known.id, null)
  }, [])

  // El foco arranca en el monto (meta: 7 segundos).
  useEffect(() => {
    const frame = requestAnimationFrame(() => amountRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Si la hoja se cerró a mano mientras subía la foto, al terminar no se toca nada.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // ── La vista previa, armada en el navegador con el mismo código que la acción ──
  const built = useMemo(
    () =>
      buildQuickExpenseValues({
        amountCents: amount,
        target,
        treasuryAccountId: treasuryId,
        voucher,
        vatRateBp: vatRate,
        vatAdjustCents: vatAdjust,
        pointOfSale,
        number,
        date,
        detail,
        remito,
        recurringExpenseId: recurringId,
      }),
    [
      amount,
      target,
      treasuryId,
      voucher,
      vatRate,
      vatAdjust,
      pointOfSale,
      number,
      date,
      detail,
      remito,
      recurringId,
    ],
  )
  const key = built.values ? JSON.stringify(built.values) : ''
  const preview = useMemo(
    () =>
      built.values
        ? previewDocumentForm('quick_expense', built.values, data.ctx, {
            firstOpenDate: data.firstOpenDate,
          })
        : null,
    [built.values, data.ctx, data.firstOpenDate],
  )

  /**
   * Lo que sigue a un gasto YA cargado. Nada de acá lo deshace: si algo falla,
   * se avisa y el gasto queda. `documentId` es el comprobante nuevo (el gasto,
   * o la compra si fue con factura): lo que haya que colgarle después de
   * guardar (la foto del comprobante) va acá.
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
    if (treasuryId) rememberTreasury(tenantSlug, treasuryId)
    posting.undoToast(saved.message, saved)
    const remember = rememberOnSave.current
    rememberOnSave.current = null
    const picked = files
    const followUp = afterPosted({
      documentId: saved.result.documents[0]?.id ?? null,
      remember,
      files: picked,
    })
    router.refresh()
    if (!loadAnother) {
      if (picked.length === 0) {
        close()
        return
      }
      // Con foto, la hoja espera a que suba y recién ahí se cierra.
      setAttaching('closing')
      void followUp.finally(() => {
        if (mounted.current) close()
      })
      return
    }
    // «Cargar otro después»: vacía la hoja y conserva la fecha y la caja. Arriba queda lo que se
    // acaba de cargar (el toast con «Deshacer» sale igual).
    const savedText = [amount !== null ? exactAmountText(amount) : null, targetName]
      .filter((part) => part !== null)
      .join(' · ')
    setLastSaved((prev) => ({ text: savedText, count: (prev?.count ?? 0) + 1 }))
    setRecurringMissing(false)
    setStampNonce(0)
    setShowVatAdjust(false)
    defaultsSeq.current += 1
    touched.current.voucher = false
    unlinkRecurring()
    resetAccountChoice()
    prefilledAmount.current = null
    setAmount(null)
    setTarget(null)
    setVoucher('none')
    setVatRate(2100)
    setVatAdjust(0)
    setVoucherNumber({ pos: '', number: '' })
    setDetail('')
    setShowDetail(false)
    setSubmitted(false)
    setDefaults(null)
    setDuplicate(null)
    setFiles([])
    // El próximo gasto se puede ir cargando; se guarda cuando terminó de subir la foto de este.
    if (picked.length > 0) setAttaching('staying')
    // Los datos se vuelven a traer cuando terminó lo de después (la ficha ya tiene su cuenta).
    void followUp.finally(() => {
      if (mounted.current) setAttaching(null)
      reload()
    })
    requestAnimationFrame(() => {
      // Arriba de todo: ahí queda «Cargado: …» y el monto del que sigue.
      formRef.current?.querySelector('[data-slot="action-sheet-body"]')?.scrollTo({ top: 0 })
      amountRef.current?.focus()
    })
  }

  const posting = useDocumentPosting<QuickExpenseFormValues>({
    tenantSlug,
    action: postQuickExpense,
    onSaved: (saved) => onSaved(saved),
    formRef,
    isKnownField: (k) => KNOWN_FIELDS.has(k),
  })

  // Con el gasto ya guardado y la hoja esperando la foto para cerrarse, no hay nada que perder.
  const dirty =
    attaching !== 'closing' &&
    (amount !== null ||
      target !== null ||
      detail.trim() !== '' ||
      voucherNumber.number !== '' ||
      remito.trim() !== '' ||
      files.length > 0)
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  // ── ¿Ya está cargado? (al tener proveedor, comprobante con número e importe) ──
  const voucherType =
    voucher === 'a'
      ? 'factura_a'
      : voucher === 'bc'
        ? invoiceLetterFor(condition ?? 'sin_datos')
        : voucher === 'ticket'
          ? 'tique'
          : null
  useEffect(() => {
    if (!partyId || amount === null || !date || !voucherType || number === null) {
      setDuplicate(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const result = await findDuplicate(tenantSlug, {
          partyId,
          totalCents: amount,
          issueDate: date,
          voucherType,
          pointOfSale,
          number,
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
  }, [partyId, amount, date, voucherType, pointOfSale, number, tenantSlug])

  // ── Errores ──
  const clientErrors: Record<string, string> = submitted
    ? { ...built.missing, ...(preview && !preview.ok ? (preview.fieldErrors ?? {}) : {}) }
    : {}
  const errors: Record<string, string> = { ...clientErrors, ...posting.fieldErrors }
  const unknownPreviewError =
    submitted &&
    preview &&
    !preview.ok &&
    Object.keys(preview.fieldErrors ?? {}).every((k) => !KNOWN_FIELDS.has(k))
      ? preview.message
      : null

  // ── La cuenta: de la ficha del proveedor, o se pregunta (12/10/2026) ──
  const defaultAccountId = party ? supplierDefaultAccount(party.defaultAccountId, imputable) : null
  const ask = accountAsk({
    existingParty: target?.kind === 'party' && party !== null,
    defaultAccountId,
    accountId: target?.kind === 'party' ? target.accountId : null,
    recurringLinked: recurringId !== null,
    changing: accountChanging,
  })
  const accountPlan: TargetAccountPlan = {
    ask,
    changing: accountChanging && defaultAccountId !== null,
    onChange: () => setAccountChanging(true),
    onUseDefault: () => {
      setAccountChanging(false)
      setTarget((prev) =>
        prev?.kind === 'party' ? { ...prev, accountId: defaultAccountId } : prev,
      )
      posting.clearFieldErrors()
    },
    remember: rememberAccount,
    onRememberChange: setRememberAccount,
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    // Mientras sube la foto del gasto anterior no se guarda otro (ese ya quedó cargado).
    if (posting.pending || attaching !== null) return
    setSubmitted(true)
    if (!built.values || !preview?.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    // Lo de después de guardar se decide ahora, con lo que se está mandando.
    const accountToSave = accountToRemember({
      ask,
      remember: rememberAccount,
      accountId: target?.kind === 'party' ? target.accountId : null,
    })
    rememberOnSave.current = party && accountToSave ? { party, accountId: accountToSave } : null
    posting.submit(built.values, preview.hash, key)
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  // ── Textos que acompañan ──
  const split = voucher === 'a' ? splitTotal(amount, vatRate, vatAdjust) : null
  // «Remito o nada» es `none`: se guarda sin factura y sin número (el del remito va en el detalle).
  const invoiced = quickVoucherInvoiced(voucher)
  const outcome = quickExpenseOutcome({
    voucher,
    hasParty,
    hasNumber: pointOfSale !== null && number !== null,
  })
  /**
   * La persona eligió un papel. Escribe lo mismo que escribían «¿Se factura?»
   * y los chips de comprobante: el valor de la tarjeta y el ajuste de IVA en
   * cero; desde acá, lo que el sistema recuerde del proveedor ya no lo pisa.
   * Tocar la que ya estaba elegida solo confirma.
   */
  const choosePaper = (next: QuickVoucher) => {
    touched.current.voucher = true
    if (next === voucher) return
    setVoucher(next)
    setVatAdjust(0)
    setShowVatAdjust(false)
    posting.clearFieldErrors()
    setStampNonce((n) => n + 1)
  }
  const closedMonth =
    date && data.firstOpenDate && date < data.firstOpenDate
      ? `${capitalize(formatMonthYear(date))} está cerrado: lo cargamos el ${formatIsoDay(data.firstOpenDate)} (el IVA va a ${formatMonthYear(data.firstOpenDate)}).`
      : null
  const looksOff =
    amount !== null && party && defaults?.medianTotalCents
      ? amountLooksOff(amount, defaults.medianTotalCents)
      : false
  // Lo que falta saber del proveedor para cargarle ese papel: cómo factura (de quien entró
  // por una lista no lo sabemos, y el motor no le acepta una factura) o su CUIT.
  const invoicing =
    target?.kind === 'party' && party !== null
      ? invoicingGap({
          paper: voucher,
          condition: party.ivaCondition,
          hasTaxId: Boolean(party.taxId),
          entersIvaBook: isInvoiceVoucher(voucher),
        })
      : null
  const lastVoucher =
    defaults && defaults.pointOfSale !== null && defaults.lastNumber !== null
      ? `${padPos(String(defaults.pointOfSale))}-${padNumber(String(defaults.lastNumber))}`
      : null
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const treasury = treasuryId ? data.treasuries.find((t) => t.id === treasuryId) : undefined

  // ── El IVA de una Factura A: ¿se recupera?, ¿cuánto? ──
  const recovers = recoversVat({ condition, sasCondition: data.ctx.settings.ivaCondition })
  const previewVat = preview?.ok
    ? recoveredVatFromPreview(preview.preview, data.ctx.sys.vat_credit.id)
    : 0
  // Lo que da la vista previa; si todavía falta algo para armarla (el número de la factura), la
  // misma cuenta que hace el motor con el total y la alícuota.
  const recoveredVat =
    voucher === 'a' && recovers ? (previewVat > 0 ? previewVat : (split?.vatCents ?? null)) : null

  // ── El ticket: lo que va a pasar, en palabras ──
  const stamp = paperStamp({ voucher, hasParty, condition })
  // Las tres respuestas sin las que no hay nada que resumir.
  const unanswered = {
    amount: amount === null || amount <= 0,
    // Un proveedor sin categoría todavía no dice en qué se gastó.
    target: target === null || (target.kind !== 'account' && target.accountId === null),
    treasury: treasury === undefined,
  }
  // Lo que falta para poder cargarlo: mientras falte, el ticket queda en borrador y lo dice.
  // Si no es nada de lo que se sabe nombrar pero todavía no hay asiento (un dato de un
  // proveedor nuevo, la fecha), se avisa igual: el ticket nunca promete lo que no se puede guardar.
  const missing =
    missingForSummary({
      ...unanswered,
      invoiceNumber: isInvoiceVoucher(voucher) && (pointOfSale === null || number === null),
    }) ?? (entries.length === 0 ? 'Todavía falta completar un dato.' : null)
  const answered = !unanswered.amount && !unanswered.target && !unanswered.treasury
  const linkedRecurring = recurringId ? data.recurring.find((r) => r.id === recurringId) : undefined
  const ticketRows: GastoTicketRow[] = split
    ? [
        { key: 'neto', label: 'Neto', value: formatCents(split.netCents) },
        {
          key: 'iva',
          label: `IVA ${vatRateLabel(vatRate)}`,
          hint: recovers ? 'Lo recuperás' : 'Va al costo',
          value: formatCents(split.vatCents),
        },
      ]
    : []
  const ticketNote =
    missing ??
    [
      paperOutcomeNote({ voucher, outcome, recovers }),
      linkedRecurring ? `El gasto fijo «${linkedRecurring.name}» queda cargado.` : null,
    ]
      .filter((part) => part !== null)
      .join(' ')

  const treasuryChips = activeTreasuries.length <= MAX_TREASURY_CHIPS
  const ids = {
    amount: `${uid}-monto`,
    target: `${uid}-en-que`,
    targetLabel: `${uid}-en-que-label`,
    treasury: `${uid}-caja`,
    treasuryLabel: `${uid}-caja-label`,
    paper: `${uid}-papel`,
    paperLabel: `${uid}-papel-label`,
    remito: `${uid}-remito`,
    vatLabel: `${uid}-iva-label`,
    vatAdjust: `${uid}-iva-ajuste`,
    number: `${uid}-numero`,
    date: `${uid}-fecha`,
    detail: `${uid}-detalle`,
    another: `${uid}-otro`,
  }
  // El botón dice el importe tal cual se guarda: con centavos si los tiene, como el ticket.
  const submitLabel =
    amount !== null && amount > 0 ? `Cargar gasto · ${exactAmountText(amount)}` : 'Cargar gasto'

  if (activeTreasuries.length === 0) {
    return (
      <>
        <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
        <ActionSheetBody>
          <SheetLoadError
            message="No hay cajas ni cuentas activas para pagar. Activá una en Ajustes › Cajas y cuentas."
            onRetry={reload}
          />
        </ActionSheetBody>
      </>
    )
  }

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
      >
        <ActionSheetBody>
          {lastSaved ? (
            // Con `key`, el tilde se vuelve a dibujar con cada gasto que se carga.
            <SavedNote key={lastSaved.count}>
              Cargado{lastSaved.text ? `: ${lastSaved.text}` : ''}.
              {lastSaved.count > 1 ? ` Llevás ${lastSaved.count} gastos cargados.` : null}
            </SavedNote>
          ) : null}
          {recurringMissing && target === null ? (
            <InlineNotice tone="info">
              Ese gasto fijo ya no se puede cargar desde acá. Elegí en qué se gastó y seguí.
            </InlineNotice>
          ) : null}

          {/* ¿Cuánto?: el número grande de la hoja, con foco al abrir */}
          <MoneyField
            id={ids.amount}
            inputRef={amountRef}
            label="¿Cuánto gastaste?"
            required
            value={amount}
            onValueChange={(cents) => {
              setAmount(cents)
              posting.clearFieldErrors()
            }}
            error={errors.amountCents ?? null}
            hint="Con IVA incluido, tal cual el ticket o la factura."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                event.preventDefault()
                targetRef.current?.querySelector<HTMLElement>('button')?.focus()
              }
            }}
            // La etiqueta va como las otras preguntas (Fraunces) y su asterisco, chico como el de ellas.
            fieldClassName={ACTION_SHEET_QUESTION_FIELD}
            className="[&_input]:h-16 [&_input]:rounded-2xl [&_input]:bg-card [&_input]:pl-11 [&_input]:font-serif [&_input]:text-[2rem] [&_input]:font-semibold [&_input]:tracking-tight [&>span]:left-4 [&>span]:font-serif [&>span]:text-2xl"
          />
          {looksOff && party && defaults?.medianTotalCents ? (
            <InlineNotice>
              ¿Seguro? Con {party.tradeName ?? party.name} solés gastar alrededor de{' '}
              {formatCentsShort(defaults.medianTotalCents)}.
            </InlineNotice>
          ) : null}

          {/* ¿En qué se gastó?: un proveedor, un gasto fijo o una categoría */}
          <div className={TARGET_BLOCK} ref={targetRef}>
            <Question id={ids.targetLabel} required>
              ¿En qué se gastó?
            </Question>
            <ExpenseTargetPicker
              id={ids.target}
              suggestions={data.suggestions}
              recurring={recurringOptions}
              linkedRecurringId={recurringId}
              today={data.today}
              parties={data.parties}
              accounts={data.accounts}
              value={target}
              accountPlan={accountPlan}
              onPick={pickTarget}
              onPickRecurring={pickRecurring}
              onAccountChange={(accountId) => {
                setTarget((prev) =>
                  prev && prev.kind !== 'account' ? { ...prev, accountId } : prev,
                )
                // Otra cuenta que la del gasto fijo: ya no es ese gasto fijo.
                if (recurringAccount.current !== null && accountId !== recurringAccount.current) {
                  unlinkRecurring()
                }
                posting.clearFieldErrors()
              }}
              onNewPartyChange={(patch) => {
                setTarget((prev) => (prev?.kind === 'new' ? { ...prev, ...patch } : prev))
                if (patch.ivaCondition && !touched.current.voucher) {
                  setVoucher(suggestQuickVoucher({ hasParty: true, condition: patch.ivaCondition }))
                }
                posting.clearFieldErrors()
              }}
              onClear={() => {
                defaultsSeq.current += 1
                unlinkRecurring()
                resetAccountChoice()
                setTarget(null)
                setDefaults(null)
                setDuplicate(null)
                touched.current.voucher = false
                setVoucher('none')
                setVoucherNumber({ pos: '', number: '' })
              }}
              errors={{
                target: errors.target ?? errors['target.partyId'] ?? errors.newParty,
                'target.accountId': errors['target.accountId'],
                'newParty.name': errors['newParty.name'],
                'newParty.taxId': errors['newParty.taxId'],
              }}
              needsTaxId={isInvoiceVoucher(voucher)}
            />
          </div>

          {/* ¿Con qué pagaste?: la caja y cómo queda después de este gasto */}
          <div className={QUESTION_BLOCK}>
            <Question id={ids.treasuryLabel} required>
              ¿Con qué pagaste?
            </Question>
            {treasuryChips ? (
              <RadioChips
                labelledBy={ids.treasuryLabel}
                value={treasuryId}
                invalid={Boolean(errors.treasuryAccountId)}
                onChange={(next) => {
                  touched.current.treasury = true
                  setTreasuryId(next)
                  posting.clearFieldErrors()
                }}
                options={activeTreasuries.map((t) => ({
                  value: t.id,
                  ariaLabel: `${t.name}, ${treasuryMoneyText(t.kind, t.balanceCents)}`,
                  label: (
                    <>
                      <span className="truncate">{t.name}</span>
                      <span
                        className={cn(
                          'text-xs font-normal tabular-nums opacity-75',
                          t.kind !== 'credit_card' &&
                            t.balanceCents < 0 &&
                            'text-destructive opacity-100',
                        )}
                      >
                        {treasuryMoneyText(t.kind, t.balanceCents)}
                      </span>
                    </>
                  ),
                }))}
              />
            ) : (
              <TreasurySelect
                id={ids.treasury}
                aria-labelledby={ids.treasuryLabel}
                value={treasuryId}
                onValueChange={(next) => {
                  touched.current.treasury = true
                  setTreasuryId(next)
                  posting.clearFieldErrors()
                }}
                treasuries={data.treasuries}
                invalid={Boolean(errors.treasuryAccountId)}
              />
            )}
            {errors.treasuryAccountId ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.treasuryAccountId}
              </p>
            ) : null}
            {treasury ? <TreasuryAfterLine treasury={treasury} amountCents={amount} /> : null}
          </div>

          {/* ¿Qué papel te dieron?: cuatro papeles; debajo, lo que pide el elegido */}
          <div className={QUESTION_BLOCK}>
            <Question id={ids.paperLabel}>¿Qué papel te dieron?</Question>
            <PaperChoices
              name={ids.paper}
              labelledBy={ids.paperLabel}
              value={voucher}
              onPick={choosePaper}
              consequenceFor={(option) =>
                paperConsequence(option, {
                  selected: voucher,
                  recovers,
                  recoveredVatCents: recoveredVat,
                })
              }
            />

            {invoiced ? null : showRemito || remito ? (
              <div className="grid gap-1.5">
                <Label htmlFor={ids.remito}>
                  N.º de remito{' '}
                  <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id={ids.remito}
                  value={remito}
                  maxLength={REMITO_MAX}
                  autoComplete="off"
                  placeholder="0001-00001234"
                  aria-describedby={`${ids.remito}-hint`}
                  onChange={(e) => {
                    setRemito(e.target.value)
                    posting.clearFieldErrors()
                  }}
                  className={cn('h-11 text-base tabular-nums md:h-10 md:text-sm', FAINT_EXAMPLE)}
                />
                <p id={`${ids.remito}-hint`} className="text-xs text-muted-foreground">
                  Queda anotado en el detalle del gasto.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowRemito(true)
                  // El botón desaparece: el foco sigue en el campo que lo reemplaza.
                  requestAnimationFrame(() => document.getElementById(ids.remito)?.focus())
                }}
                className={ADD_LINK}
              >
                <Plus className="size-3.5" aria-hidden />
                Agregar n.º de remito
              </button>
            )}

            {voucher === 'a' ? (
              <div className="grid gap-2.5 rounded-xl bg-secondary/50 p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span id={ids.vatLabel} className="text-sm font-medium">
                    IVA de la factura
                  </span>
                  <RadioChips
                    labelledBy={ids.vatLabel}
                    value={String(vatRate)}
                    onChange={(next) => {
                      const rate = Number(next)
                      if (!isQuickVatRate(rate)) return
                      setVatRate(rate)
                      setVatAdjust(0)
                    }}
                    options={QUICK_VAT_RATES.map((r) => ({
                      value: String(r),
                      label: vatRateLabel(r),
                    }))}
                  />
                </div>
                {split ? (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Neto {formatCents(split.netCents)} · IVA {formatCents(split.vatCents)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Neto e IVA salen del total.</p>
                )}
                {split && (showVatAdjust || vatAdjust !== 0) ? (
                  <div id={ids.vatAdjust} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Sumale o restale centavos al IVA hasta que coincida:
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 px-3 tabular-nums md:h-8"
                      disabled={vatAdjust <= -VAT_ADJUST_LIMIT}
                      aria-label="Restar un centavo al IVA"
                      onClick={() => setVatAdjust((v) => Math.max(-VAT_ADJUST_LIMIT, v - 1))}
                    >
                      −1¢
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 px-3 tabular-nums md:h-8"
                      disabled={vatAdjust >= VAT_ADJUST_LIMIT}
                      aria-label="Sumar un centavo al IVA"
                      onClick={() => setVatAdjust((v) => Math.min(VAT_ADJUST_LIMIT, v + 1))}
                    >
                      +1¢
                    </Button>
                    {vatAdjust !== 0 ? (
                      <button
                        type="button"
                        className={cn(TEXT_LINK, 'text-xs')}
                        onClick={() => setVatAdjust(0)}
                      >
                        Volver al calculado
                      </button>
                    ) : null}
                  </div>
                ) : split ? (
                  <button
                    type="button"
                    className={cn(TEXT_LINK, 'justify-self-start text-xs')}
                    onClick={() => {
                      setShowVatAdjust(true)
                      // El link desaparece: el foco sigue en los botones que lo reemplazan.
                      requestAnimationFrame(() =>
                        document
                          .getElementById(ids.vatAdjust)
                          ?.querySelector<HTMLElement>('button')
                          ?.focus(),
                      )
                    }}
                  >
                    ¿El IVA de la factura no coincide por centavos?
                  </button>
                ) : null}
              </div>
            ) : null}

            {invoiced ? (
              <div className="grid gap-1.5">
                <Label htmlFor={ids.number}>
                  Número
                  {isInvoiceVoucher(voucher) ? (
                    <span aria-hidden="true" className="ml-0.5 text-destructive">
                      *
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                  )}
                </Label>
                {/* Los ejemplos («0003 – 00001290») van apagados: con Factura A el número es
                    obligatorio y, apurado, el ejemplo parecía un número ya puesto. */}
                <div className="[&_input]:placeholder:text-muted-foreground/50">
                  <VoucherNumberInput
                    id={ids.number}
                    value={voucherNumber}
                    onChange={(next) => {
                      setVoucherNumber(next)
                      posting.clearFieldErrors()
                    }}
                    invalid={Boolean(errors.number ?? errors.pointOfSale)}
                    describedBy={`${ids.number}-hint`}
                  />
                </div>
                <p id={`${ids.number}-hint`} className="text-xs text-muted-foreground text-pretty">
                  {lastVoucher
                    ? `La última fue ${lastVoucher}. Podés pegar «0003-00001290».`
                    : 'Punto de venta y número. Podés pegar «0003-00001290».'}
                  {voucher === 'ticket'
                    ? ' Con proveedor y número, el tique entra al Libro IVA.'
                    : null}
                </p>
                {(errors.number ?? errors.pointOfSale) ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.number ?? errors.pointOfSale}
                  </p>
                ) : null}
              </div>
            ) : null}

            {invoicing && party ? (
              <SupplierInvoicingAsk
                key={`${party.id}:${invoicing.kind}:${voucher}`}
                tenantSlug={tenantSlug}
                party={party}
                gap={invoicing}
                paper={voucher}
                // La ficha ya quedó guardada: la hoja vuelve a traer sus datos (lo cargado sigue).
                onSaved={() => reload()}
              />
            ) : null}

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
                  : `Ya cargaste ${duplicate.totalCents !== null ? formatCentsShort(duplicate.totalCents) : 'lo mismo'}${duplicate.partyName ? ` en ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` el ${formatIsoDay(duplicate.accountingDate)}` : ''} (${duplicate.label}). ¿Es otro gasto?`}
              </InlineNotice>
            ) : null}
          </div>

          {/* El ticket: lo que va a pasar, en palabras. Va pegado a «¿Qué papel te dieron?»: el
              sello cambia a la vista de quien acaba de elegir el papel, y se pasa por él antes
              de llegar a lo que casi nunca hace falta tocar. */}
          <GastoTicket
            title={targetName ?? 'Nuevo gasto'}
            subtitle={[date ? formatDayLabel(date) : null, categoryName]
              .filter((part) => Boolean(part))
              .join(' · ')}
            stamp={stamp}
            stampNonce={stampNonce}
            rows={ticketRows}
            totalLabel={ticketTotalLabel(treasury ?? null)}
            total={amount !== null && amount > 0 ? formatCents(amount) : EMPTY_VALUE}
            totalHint={
              treasury && amount !== null && amount > 0 ? (
                <TreasuryAfterHint treasury={treasury} amountCents={amount} />
              ) : undefined
            }
            note={ticketNote}
            pending={missing !== null}
          />

          {/* Lo demás: la foto, la fecha y el detalle. Una raya lo separa de las preguntas y su ticket. */}
          <div className="space-y-5 border-t border-border/60 pt-6">
            {/* Foto del comprobante: se sube después de guardar */}
            <AttachmentPicker
              value={files}
              onChange={setFiles}
              disabled={posting.pending || attaching !== null}
            />

            <DateField
              id={ids.date}
              label="Fecha"
              value={date}
              onValueChange={(next) => {
                setDate(next)
                posting.clearFieldErrors()
              }}
              min={data.booksStartDate}
              max={data.today}
              today={data.today}
              required
              error={errors.date ?? null}
              hint={closedMonth ?? undefined}
            />

            {showDetail || detail ? (
              <div className="grid gap-1.5">
                <Label htmlFor={ids.detail}>
                  Detalle{' '}
                  <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id={ids.detail}
                  value={detail}
                  maxLength={detailRoom(invoiced ? '' : remito, QUICK_DETAIL_MAX)}
                  rows={2}
                  placeholder="Por ejemplo: hielo para el evento del sábado."
                  onChange={(e) => setDetail(e.target.value)}
                  className="text-base md:text-sm"
                />
                {errors.detail ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.detail}
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowDetail(true)
                  // El botón desaparece: el foco sigue en el campo que lo reemplaza.
                  requestAnimationFrame(() => document.getElementById(ids.detail)?.focus())
                }}
                className={ADD_LINK}
              >
                <Plus className="size-3.5" aria-hidden />
                Agregar detalle
              </button>
            )}
          </div>

          {/* Para la contadora (y el curioso): el asiento, plegado y al final de todo. */}
          <EntryPreview
            entries={entries}
            label="Ver cómo queda en los libros"
            emptyText={
              missing !== null
                ? `${missing} Completalo y vas a ver cómo queda en los libros.`
                : undefined
            }
          />

          {unknownPreviewError ? (
            <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
          ) : null}
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>

        {/* En el celular, el tilde arriba y el botón a todo el ancho abajo, donde llega el pulgar.
            Entre los dos, apenas están las tres respuestas, el resumen de lo que se va a cargar. */}
        <ActionSheetFooter className="flex-col items-stretch gap-1 pt-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <label
            htmlFor={ids.another}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground"
          >
            <Checkbox
              id={ids.another}
              checked={loadAnother}
              onCheckedChange={(checked) => setLoadAnother(checked === true)}
            />
            Cargar otro después
          </label>
          {answered && treasury ? (
            <FooterSummary
              who={targetName ?? 'Gasto'}
              paper={stamp.text}
              from={paidFromWords(treasury)}
              missing={missing}
            />
          ) : null}
          <Button
            type="submit"
            disabled={posting.pending || attaching !== null}
            aria-describedby={treasury ? `${uid}-con` : undefined}
          >
            {posting.pending
              ? 'Guardando…'
              : attaching !== null
                ? 'Subiendo el comprobante…'
                : submitLabel}
          </Button>
          {treasury ? (
            <span id={`${uid}-con`} className="sr-only">
              Se paga con {treasury.name}
            </span>
          ) : null}
        </ActionSheetFooter>
      </form>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onConfirm={posting.confirmWarnings}
        onCancel={posting.dismissWarnings}
      />
    </>
  )
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}
