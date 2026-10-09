'use client'

import { Plus } from 'lucide-react'
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
  ExpenseTargetPicker,
  payableParties,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/expense-target-picker'
import {
  FormBanner,
  InlineNotice,
  RadioChips,
  SheetLoadError,
  SheetSkeleton,
  WarningsDialog,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/form-feedback'
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
import {
  amountAfterRecurring,
  buildQuickExpenseValues,
  type ExpenseTarget,
  isInvoiceVoucher,
  QUICK_VAT_RATES,
  QUICK_VOUCHER_LABELS,
  QUICK_VOUCHERS,
  type QuickExpenseFormValues,
  type QuickVatRate,
  type QuickVoucher,
  quickExpenseOutcome,
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
  SheetPartyDefaults,
  SheetRecurring,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { postQuickExpense } from '@/lib/accounting/actions/documents'
import { saveParty } from '@/lib/accounting/actions/master'
import { amountLooksOff, pickTreasury } from '@/lib/accounting/defaults'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { IvaCondition } from '@/lib/accounting/types'
import { formatIsoDay, formatMonthYear } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { MoneyField } from '../money-input'
import { TreasurySelect, treasuryBalanceText } from '../treasury-select'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.gasto
const DESCRIPTION = 'Lo que pagaste en el momento, con o sin factura.'
const LAST_TREASURY_KEY = 'hub_acc_gasto_caja:'

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
  const [loadAnother, setLoadAnother] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [defaults, setDefaults] = useState<SheetPartyDefaults | null>(null)
  const [duplicate, setDuplicate] = useState<SheetDuplicate | null>(null)
  const [cuitDraft, setCuitDraft] = useState<string | null>(null)
  const [cuitSaving, setCuitSaving] = useState(false)
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

  // ── Lo que el sistema recuerda de un proveedor (H.5) ──
  const applyPartyDefaults = useCallback(
    async (id: string, suggestion: QuickSuggestion | null) => {
      const seq = ++defaultsSeq.current
      const known = partyById.get(id)
      setDefaults(null)
      setDuplicate(null)
      setCuitDraft(null)
      // Al toque, con lo que ya está en el catálogo (y el chip).
      if (!touched.current.voucher && !fromRecurring.current.voucher) {
        setVoucher(
          suggestQuickVoucher({
            hasParty: true,
            lastVoucherType: suggestion?.voucherType ?? known?.defaultVoucherType ?? null,
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
            lastVoucherType: d.voucherType ?? known?.defaultVoucherType ?? null,
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

  const pickTarget = (next: ExpenseTarget, suggestion: QuickSuggestion | null) => {
    unlinkRecurring()
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

  // «Nuevo gasto con este proveedor» (?proveedor=): arranca con el proveedor elegido.
  const initialParty = params.proveedor
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir la hoja
  useEffect(() => {
    if (!initialParty) return
    const known = partyById.get(initialParty)
    if (!known?.active) return
    const account =
      known.defaultAccountId && imputable.has(known.defaultAccountId)
        ? known.defaultAccountId
        : null
    setTarget({ kind: 'party', partyId: known.id, accountId: account })
    void applyPartyDefaults(known.id, null)
  }, [])

  // El foco arranca en el monto (meta: 7 segundos).
  useEffect(() => {
    const frame = requestAnimationFrame(() => amountRef.current?.focus())
    return () => cancelAnimationFrame(frame)
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

  const onSaved = (saved: SavedState) => {
    if (treasuryId) rememberTreasury(tenantSlug, treasuryId)
    posting.undoToast(saved.message, saved)
    router.refresh()
    if (!loadAnother) {
      close()
      return
    }
    // «Cargar otro después»: vacía la hoja y conserva la fecha y la caja.
    defaultsSeq.current += 1
    touched.current.voucher = false
    unlinkRecurring()
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
    setCuitDraft(null)
    reload()
    requestAnimationFrame(() => amountRef.current?.focus())
  }

  const posting = useDocumentPosting<QuickExpenseFormValues>({
    tenantSlug,
    action: postQuickExpense,
    onSaved: (saved) => onSaved(saved),
    formRef,
    isKnownField: (k) => KNOWN_FIELDS.has(k),
  })

  const dirty =
    amount !== null || target !== null || detail.trim() !== '' || voucherNumber.number !== ''
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

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (posting.pending) return
    setSubmitted(true)
    if (!built.values || !preview?.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
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
  const outcome = quickExpenseOutcome({
    voucher,
    hasParty,
    hasNumber: pointOfSale !== null && number !== null,
  })
  const closedMonth =
    date && data.firstOpenDate && date < data.firstOpenDate
      ? `${capitalize(formatMonthYear(date))} está cerrado: lo cargamos el ${formatIsoDay(data.firstOpenDate)} (el IVA va a ${formatMonthYear(data.firstOpenDate)}).`
      : null
  const looksOff =
    amount !== null && party && defaults?.medianTotalCents
      ? amountLooksOff(amount, defaults.medianTotalCents)
      : false
  const cuitMissing =
    target?.kind === 'party' && party !== null && !party.taxId && isInvoiceVoucher(voucher)
  const lastVoucher =
    defaults && defaults.pointOfSale !== null && defaults.lastNumber !== null
      ? `${padPos(String(defaults.pointOfSale))}-${padNumber(String(defaults.lastNumber))}`
      : null
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const treasury = treasuryId ? data.treasuries.find((t) => t.id === treasuryId) : undefined

  const saveCuit = async () => {
    if (!party || cuitDraft === null) return
    setCuitSaving(true)
    try {
      const result = await saveParty(tenantSlug, {
        id: party.id,
        expectedUpdatedAt: party.updatedAt,
        kind: party.kind,
        name: party.name,
        taxIdType: 'cuit',
        taxId: cuitDraft,
      })
      if (!result.ok) {
        toast.error(result.code === 'stale' ? 'Recargá la hoja y probá de nuevo.' : result.message)
        return
      }
      toast.success(`Listo: ${party.name} ya tiene CUIT.`)
      setCuitDraft(null)
      reload()
    } catch {
      toast.error(ACC_UNREACHABLE.offline)
    } finally {
      setCuitSaving(false)
    }
  }

  const treasuryChips = activeTreasuries.length <= MAX_TREASURY_CHIPS
  const ids = {
    amount: `${uid}-monto`,
    target: `${uid}-en-que`,
    targetLabel: `${uid}-en-que-label`,
    treasury: `${uid}-caja`,
    treasuryLabel: `${uid}-caja-label`,
    voucherLabel: `${uid}-comprobante-label`,
    vat: `${uid}-iva`,
    number: `${uid}-numero`,
    date: `${uid}-fecha`,
    detail: `${uid}-detalle`,
    another: `${uid}-otro`,
  }
  const submitLabel =
    amount !== null && amount > 0 ? `Cargar gasto · ${formatCentsShort(amount)}` : 'Cargar gasto'

  if (activeTreasuries.length === 0) {
    return (
      <>
        <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
        <ActionSheetBody>
          <SheetLoadError
            message="No hay cajas ni cuentas activas para pagar. Activá una en Ajustes › Cajas y bancos."
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
          {/* Monto: grande y con foco al abrir */}
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
            className="[&>span]:text-xl [&_input]:h-14 [&_input]:pl-9 [&_input]:text-2xl [&_input]:font-semibold md:[&_input]:h-12 md:[&_input]:text-xl"
          />
          {looksOff && party && defaults?.medianTotalCents ? (
            <InlineNotice>
              ¿Seguro? Con {party.tradeName ?? party.name} solés gastar alrededor de{' '}
              {formatCentsShort(defaults.medianTotalCents)}.
            </InlineNotice>
          ) : null}

          {/* ¿En qué? */}
          <div className="grid gap-1.5" ref={targetRef}>
            <span id={ids.targetLabel} className="text-sm font-medium leading-none">
              ¿En qué?
              {/* ml-2.5: el mismo aire que el «*» de un <Label> (gap-2 + ml-0.5). */}
              <span aria-hidden="true" className="ml-2.5 text-destructive">
                *
              </span>
            </span>
            <ExpenseTargetPicker
              id={ids.target}
              suggestions={data.suggestions}
              recurring={recurringOptions}
              linkedRecurringId={recurringId}
              today={data.today}
              parties={data.parties}
              accounts={data.accounts}
              value={target}
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
                setTarget(null)
                setDefaults(null)
                setDuplicate(null)
                setCuitDraft(null)
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

          {/* ¿Con qué pagaste? */}
          <div className="grid gap-1.5">
            <span id={ids.treasuryLabel} className="text-sm font-medium leading-none">
              ¿Con qué pagaste?
              <span aria-hidden="true" className="ml-2.5 text-destructive">
                *
              </span>
            </span>
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
                  ariaLabel: `${t.name}, ${treasuryBalanceText(t)}`,
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
                        {treasuryBalanceText(t)}
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
          </div>

          {/* Comprobante */}
          <div className="grid gap-2">
            <span id={ids.voucherLabel} className="text-sm font-medium leading-none">
              Comprobante
            </span>
            <RadioChips
              labelledBy={ids.voucherLabel}
              value={voucher}
              onChange={(next) => {
                touched.current.voucher = true
                setVoucher(next)
                setVatAdjust(0)
                posting.clearFieldErrors()
              }}
              options={QUICK_VOUCHERS.map((v) => ({ value: v, label: QUICK_VOUCHER_LABELS[v] }))}
            />

            {voucher === 'a' ? (
              <div className="grid gap-2 rounded-xl border border-border/70 bg-card/50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Label htmlFor={ids.vat} className="text-xs text-muted-foreground">
                    IVA
                  </Label>
                  <Select
                    value={String(vatRate)}
                    onValueChange={(next) => {
                      setVatRate(Number(next) as QuickVatRate)
                      setVatAdjust(0)
                    }}
                  >
                    <SelectTrigger
                      id={ids.vat}
                      className="w-28 data-[size=default]:h-11 md:data-[size=default]:h-9"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUICK_VAT_RATES.map((r) => (
                        <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                          {vatRateLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {split ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      Neto {formatCents(split.netCents)} · IVA {formatCents(split.vatCents)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Neto e IVA salen del total.</p>
                  )}
                </div>
                {split ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      ¿El IVA de la factura difiere en un centavo?
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 px-2.5 tabular-nums md:h-7"
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
                      className="h-9 px-2.5 tabular-nums md:h-7"
                      disabled={vatAdjust >= VAT_ADJUST_LIMIT}
                      aria-label="Sumar un centavo al IVA"
                      onClick={() => setVatAdjust((v) => Math.min(VAT_ADJUST_LIMIT, v + 1))}
                    >
                      +1¢
                    </Button>
                    {vatAdjust !== 0 ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => setVatAdjust(0)}
                      >
                        Volver al calculado
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {voucher !== 'none' ? (
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
                <p id={`${ids.number}-hint`} className="text-xs text-muted-foreground">
                  {lastVoucher
                    ? `La última fue ${lastVoucher}. Podés pegar «0003-00001290».`
                    : 'Punto de venta y número. Podés pegar «0003-00001290».'}
                </p>
                {(errors.number ?? errors.pointOfSale) ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.number ?? errors.pointOfSale}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground text-pretty">
              {outcome === 'expense'
                ? voucher === 'ticket'
                  ? 'Sin proveedor o sin número, el tique va como gasto: no entra al Libro IVA.'
                  : 'Se guarda como gasto de contado, sin IVA.'
                : voucher === 'ticket'
                  ? 'Se guarda el tique y el pago: entra al Libro IVA y la cuenta del proveedor queda en cero.'
                  : voucher === 'bc' && condition === 'responsable_inscripto'
                    ? 'Con factura B no computás el IVA: va todo al costo. Pedí factura A si podés.'
                    : 'Se guarda la factura y el pago, así la cuenta del proveedor queda en cero.'}
            </p>

            {cuitMissing && party ? (
              <InlineNotice
                action={
                  cuitDraft === null ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 md:h-7"
                      onClick={() => setCuitDraft('')}
                    >
                      Agregar CUIT
                    </Button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`CUIT de ${party.name}`}
                        value={cuitDraft}
                        inputMode="numeric"
                        placeholder="30-71876543-5"
                        onChange={(e) => setCuitDraft(e.target.value)}
                        onBlur={(e) => {
                          const digits = e.target.value.replace(/\D/g, '')
                          if (digits.length === 11) setCuitDraft(formatCuit(digits))
                        }}
                        className="h-9 w-40 rounded-md border border-input bg-background px-2 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 md:h-7"
                        disabled={cuitSaving || cuitDraft.replace(/\D/g, '').length !== 11}
                        onClick={() => void saveCuit()}
                      >
                        {cuitSaving ? 'Guardando…' : 'Guardar CUIT'}
                      </Button>
                    </div>
                  )
                }
              >
                {party.name} no tiene CUIT cargado: el Libro IVA lo necesita.
              </InlineNotice>
            ) : null}

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
                  : `Ya cargaste ${duplicate.totalCents !== null ? formatCentsShort(duplicate.totalCents) : 'lo mismo'}${duplicate.partyName ? ` en ${duplicate.partyName}` : ''}${duplicate.accountingDate ? ` el ${formatIsoDay(duplicate.accountingDate)}` : ''} (${duplicate.label}). ¿Es otro gasto?`}
              </InlineNotice>
            ) : null}
          </div>

          {/* Fecha */}
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

          {/* Detalle */}
          {showDetail || detail ? (
            <div className="grid gap-1.5">
              <Label htmlFor={ids.detail}>
                Detalle{' '}
                <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id={ids.detail}
                value={detail}
                maxLength={280}
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
              onClick={() => setShowDetail(true)}
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-0"
            >
              <Plus className="size-3.5" aria-hidden />
              Agregar detalle
            </button>
          )}

          <EntryPreview
            entries={entries}
            emptyText="Completá el monto, en qué y con qué pagaste para ver el asiento."
          />

          {unknownPreviewError ? (
            <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
          ) : null}
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>

        <ActionSheetFooter className="sm:justify-between">
          <label
            htmlFor={ids.another}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground md:min-h-9"
          >
            <Checkbox
              id={ids.another}
              checked={loadAnother}
              onCheckedChange={(checked) => setLoadAnother(checked === true)}
            />
            Cargar otro después
          </label>
          <Button
            type="submit"
            className="h-11 w-full sm:w-auto md:h-9"
            disabled={posting.pending}
            aria-describedby={treasury ? `${uid}-con` : undefined}
          >
            {posting.pending ? 'Guardando…' : submitLabel}
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
