'use client'

import { Plus, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import {
  FormBanner,
  InlineNotice,
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
  dueRail,
  ledgerRail,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/libreta'
import { gastosFijosHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  activeQuick,
  payHeadline,
  paymentOutcome,
  payTicketRows,
  pendingRecurring,
  quickSelections,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-summary'
import {
  PAY_TARGETS,
  payAsksTarget,
  payTargetSheet,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-target'
import {
  creditPairs,
  defaultDebtSelection,
  type MethodRow,
  type PlanCredit,
  type PlanDebt,
  planPayment,
  resolveMethods,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/payment-plan'
import { pendingItemText } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase-paper'
import {
  loadPartyDefaults,
  loadPartyItems,
  loadSheetData,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions'
import type {
  SheetData,
  SheetParty,
  SheetPartyItems,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { allocateItems, postPayment } from '@/lib/accounting/actions/documents'
import { pickTreasury } from '@/lib/accounting/defaults'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { PaymentValues } from '@/lib/accounting/server/document-types'
import type { OpenItemRef, PostingContext } from '@/lib/accounting/types'
import { formatDayLabel, formatIsoDay } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useAccounting } from '../accounting-provider'
import {
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
} from '../action-sheet'
import { Amount } from '../amount'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { balanceText } from '../format'
import { LedgerList, LedgerRail, LedgerRow, Pill } from '../kit'
import { MoneyField, MoneyInput } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasuryPicker } from '../treasury-picker'
import { TreasurySelect } from '../treasury-select'
import { VoucherText } from '../voucher-text'
import { exactAmountText, ticketTotalLabel } from './gasto-papel'
import { TreasuryAfterHint, TreasuryAfterLine } from './gasto-piezas'
import {
  OtherThanSupplier,
  PayCover,
  PayTicket,
  type PayTicketRow,
  TickMark,
  type UrgentSupplier,
  UrgentSuppliers,
} from './pagar-piezas'
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  SHEET_QUESTION_BLOCK,
  SheetQuestion,
  TEXT_LINK,
} from './sheet-parts'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.pagar
const DESCRIPTION = 'A quién, qué le pagás y con qué.'
const LAST_TREASURY_KEY = 'hub_acc_pago_caja:'

/** Los que se pagan desde esta hoja: proveedores, organismos, sueldos, socios, bancos y otros. */
const PAYABLE_KINDS = new Set(['supplier', 'tax_agency', 'payroll', 'partner', 'bank', 'other'])

const KNOWN_FIELDS = new Set([
  'partyId',
  'date',
  'applications',
  'creditsUsed',
  'methods',
  'writeOffCents',
  'notes',
])

/** Las otras dos cosas que se pagan, con los textos de siempre (`PAY_TARGETS`). */
const FIXED_TARGET = PAY_TARGETS[1]
const OTHER_TARGET = PAY_TARGETS[2]

type PaymentFormValues = Omit<PaymentValues, 'clientRef' | 'previewHash' | 'warningsAck'>

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
    // Sin almacenamiento: la próxima vez se propone la caja.
  }
}

function partyName(p: Pick<SheetParty, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

/** El contexto del motor con las partidas del proveedor (las que va a cargar la acción). */
function withItems(ctx: PostingContext, items: readonly OpenItemRef[]): PostingContext {
  return { ...ctx, openItems: new Map(items.map((i) => [i.lineId, i])) }
}

/** Con centavos solo si los tiene. */
function exactDecimals(cents: number): 0 | 2 {
  return cents % 100 === 0 ? 0 : 2
}

let rowSeq = 0
function newRow(treasuryId: string | null, amountCents: number | null = null): MethodRow {
  rowSeq += 1
  return { key: `m${rowSeq}`, treasuryId, amountCents, reference: '' }
}

/**
 * Hoja «Pagar»: tachar renglones de la libreta.
 *
 *   ¿A quién le pagás?  →  ¿Qué le pagás?  ·  ¿Cuánto?  ·  ¿Con qué?  →  «Le quedás debiendo $ X»
 *
 * La primera pantalla junta lo que antes eran dos (qué se paga y después el
 * proveedor): lo más frecuente, pagarle a uno de los que más apuran, queda a un
 * toque, y las otras dos respuestas que pidieron los socios (un gasto fijo, otro
 * gasto) siguen ahí, abajo. Si se abrió desde un proveedor o una compra, no
 * pregunta.
 *
 * Mismas lecturas, misma cuenta (`planPayment`) y mismo envío (`postPayment`).
 */
export function PagarSheet(props: ActionSheetProps) {
  const { tenantSlug, params } = props
  // Los saldos y los gastos fijos se piden de entrada: la primera pantalla los muestra.
  const load = useSheetData(
    () => loadSheetData(tenantSlug, { balances: true, recurring: true }),
    tenantSlug,
  )

  if (!load.data) {
    // Mientras llega, la pregunta ya se ve y sus dos salidas de abajo ya se pueden tocar.
    if (payAsksTarget(params) && load.status !== 'error') {
      return <WhoScreen tenantSlug={tenantSlug} data={null} onPick={() => {}} />
    }
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
  return <PagarForm {...props} data={load.data} />
}

/**
 * Pantalla 1 — «¿A quién le pagás?»: lo más urgente arriba, el buscador, y las
 * otras dos cosas que se pagan. `data: null` = todavía cargando.
 */
function WhoScreen({
  tenantSlug,
  data,
  onPick,
  notice,
}: {
  tenantSlug: string
  data: SheetData | null
  onPick: (partyId: string) => void
  /** El aviso de una compra que ya no está pendiente (`?partida=`). */
  notice?: string | null
}) {
  const { openAction } = useAccounting()
  const uid = useId()
  const [fixedOpen, setFixedOpen] = useState(false)

  const partyById = useMemo(
    () => new Map((data?.parties ?? []).map((p) => [p.id, p])),
    [data?.parties],
  )
  const balanceById = useMemo(
    () => new Map((data?.balances ?? []).map((b) => [b.partyId, b])),
    [data?.balances],
  )
  const urgent: UrgentSupplier[] | null = useMemo(() => {
    if (!data) return null
    return (data.balances ?? [])
      .filter((b) => b.debtCents > 0 && partyById.has(b.partyId))
      .sort(
        (a, b) =>
          b.overdueCents - a.overdueCents ||
          (a.nextDueDate ?? '9999-12-31').localeCompare(b.nextDueDate ?? '9999-12-31') ||
          b.debtCents - a.debtCents,
      )
      .slice(0, 6)
      .flatMap((b) => {
        const p = partyById.get(b.partyId)
        return p
          ? [
              {
                partyId: b.partyId,
                name: partyName(p),
                rail: ledgerRail(b, data.today),
                debtCents: b.debtCents,
              },
            ]
          : []
      })
  }, [data, partyById])
  const options: PartyOption[] = useMemo(
    () =>
      (data?.parties ?? [])
        .filter((p) => PAYABLE_KINDS.has(p.kind) && p.active)
        .map((p) => {
          const balance = balanceById.get(p.id)
          return {
            id: p.id,
            name: p.name,
            tradeName: p.tradeName,
            taxId: p.taxId,
            active: p.active,
            meta:
              balance && balance.netCents !== 0
                ? balanceText(balance.netCents, 'payable', { decimals: 0 })
                : null,
          }
        }),
    [data?.parties, balanceById],
  )
  const fixed = useMemo(
    () =>
      data
        ? pendingRecurring(data.recurring).map((r) => ({
            id: r.id,
            name: r.name,
            nextDueDate: r.nextDueDate,
            amountCents: r.amountCents,
          }))
        : null,
    [data],
  )
  const nobodyOwed = data?.balances?.every((b) => b.debtCents === 0) ?? false

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <ActionSheetBody>
        {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}

        <section aria-labelledby={`${uid}-quien`} className={SHEET_QUESTION_BLOCK}>
          <SheetQuestion id={`${uid}-quien`}>¿A quién le pagás?</SheetQuestion>
          {urgent === null || urgent.length > 0 ? (
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Lo más urgente</p>
              <UrgentSuppliers rows={urgent} onPick={onPick} />
            </div>
          ) : nobodyOwed ? (
            <p className="rounded-xl bg-secondary/50 px-3.5 py-3 text-sm text-muted-foreground text-pretty">
              No le debés nada a ningún proveedor. Igual podés elegir uno y dejarle plata a cuenta.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label
              htmlFor={`${uid}-proveedor`}
              className="text-xs font-medium text-muted-foreground"
            >
              {urgent !== null && urgent.length > 0
                ? 'Buscar otro proveedor'
                : 'Buscar un proveedor'}
            </Label>
            <PartyCombobox
              id={`${uid}-proveedor`}
              value={null}
              onValueChange={(id) => (id ? onPick(id) : undefined)}
              parties={options}
              placeholder="Elegí un proveedor"
              disabled={data === null}
            />
          </div>
        </section>

        <section aria-labelledby={`${uid}-otra`} className={SHEET_QUESTION_BLOCK}>
          <SheetQuestion id={`${uid}-otra`}>¿No es a un proveedor?</SheetQuestion>
          <OtherThanSupplier
            fixedLabel={FIXED_TARGET.label}
            fixedHint={FIXED_TARGET.hint}
            otherLabel={OTHER_TARGET.label}
            otherHint={OTHER_TARGET.hint}
            open={fixedOpen}
            onToggle={() => setFixedOpen((v) => !v)}
            fixed={fixed}
            today={data?.today ?? null}
            // «Nuevo gasto» con ese gasto fijo ya elegido (`?gasto-fijo=`).
            onPickFixed={(id) => openAction('gasto', { 'gasto-fijo': id })}
            onOther={() => openAction(payTargetSheet(OTHER_TARGET.value))}
            sheetHref={gastosFijosHref(tenantSlug)}
          />
        </section>
      </ActionSheetBody>
    </>
  )
}

function PagarForm({
  tenantSlug,
  params,
  close,
  setDirty,
  data,
}: ActionSheetProps & { data: SheetData }) {
  const partyById = useMemo(() => new Map(data.parties.map((p) => [p.id, p])), [data.parties])
  const [partyId, setPartyId] = useState<string | null>(() => {
    const initial = params.proveedor ? partyById.get(params.proveedor) : undefined
    return initial && PAYABLE_KINDS.has(initial.kind) ? initial.id : null
  })
  // `?partida=`: esa factura llega tildada. Sin proveedor, la hoja averigua de quién es (una vez).
  const lineFromUrl = params.partida ?? null
  const [lineToResolve, setLineToResolve] = useState<string | null>(() =>
    partyId ? null : lineFromUrl,
  )

  const items = useSheetData(
    partyId
      ? () => loadPartyItems(tenantSlug, { partyId })
      : lineToResolve
        ? () => loadPartyItems(tenantSlug, { lineId: lineToResolve })
        : null,
    partyId ? `p:${partyId}` : lineToResolve ? `l:${lineToResolve}` : 'ninguno',
  )

  // Si vino solo la partida, el proveedor sale de ahí (y no se vuelve a resolver).
  useEffect(() => {
    if (partyId || !lineToResolve) return
    if (items.status === 'ready' && items.data) {
      const resolved = partyById.get(items.data.partyId)
      setLineToResolve(null)
      if (resolved && PAYABLE_KINDS.has(resolved.kind)) setPartyId(resolved.id)
    } else if (items.status === 'error') {
      setLineToResolve(null)
    }
  }, [items.status, items.data, partyId, lineToResolve, partyById])

  const chosen = partyId ? (partyById.get(partyId) ?? null) : null

  useEffect(() => {
    setDirty(false)
  }, [setDirty])

  if (!chosen) {
    if (lineToResolve) {
      return (
        <>
          <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
          <ActionSheetBody>
            <SheetSkeleton />
          </ActionSheetBody>
        </>
      )
    }
    return (
      <WhoScreen
        tenantSlug={tenantSlug}
        data={data}
        onPick={(id) => setPartyId(id)}
        notice={lineFromUrl && items.status === 'error' ? items.message : null}
      />
    )
  }

  if (!items.data || items.data.partyId !== chosen.id) {
    return (
      <>
        <ActionSheetHeader
          title={
            // Un renglón en el celular, como cuando llega lo que se le debe: el encabezado no salta.
            <span className="max-sm:block max-sm:truncate">Pagar a {partyName(chosen)}</span>
          }
          description={DESCRIPTION}
        />
        <ActionSheetBody>
          {items.status === 'error' ? (
            <SheetLoadError message={items.message} onRetry={items.reload} />
          ) : (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Cargando lo que le debés…</span>
              {['a', 'b', 'c'].map((k) => (
                <Skeleton key={k} className="h-14 w-full rounded-xl" />
              ))}
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          )}
        </ActionSheetBody>
      </>
    )
  }

  return (
    <PaymentForm
      key={chosen.id}
      tenantSlug={tenantSlug}
      data={data}
      party={chosen}
      partyItems={items.data}
      focusLine={lineFromUrl}
      onChangeParty={() => setPartyId(null)}
      close={close}
      setDirty={setDirty}
    />
  )
}

function PaymentForm({
  tenantSlug,
  data,
  party,
  partyItems,
  focusLine,
  onChangeParty,
  close,
  setDirty,
}: {
  tenantSlug: string
  data: SheetData
  party: SheetParty
  partyItems: SheetPartyItems
  focusLine: string | null
  onChangeParty: () => void
  close: () => void
  setDirty: (dirty: boolean) => void
}) {
  const router = useRouter()
  const today = data.today
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const rowsTouchedRef = useRef(false)
  const name = partyName(party)
  // Solo para dibujar: «Sin comprobante · Nombre» → «Compra sin factura» (el plan no cambia).
  const itemText = (label: string) => pendingItemText(label, [party.name, party.tradeName])

  // Las partidas por cuenta de control: un pago no mezcla cuentas (`mixed_control_accounts`).
  const accounts = useMemo(() => {
    const out = new Map<string, { debt: number; items: number }>()
    for (const item of partyItems.items) {
      const row = out.get(item.accountId) ?? { debt: 0, items: 0 }
      if (item.side === 'credit') row.debt += item.openCents
      row.items += 1
      out.set(item.accountId, row)
    }
    return [...out.entries()]
      .map(([id, row]) => ({ id, ...row, name: data.ctx.accounts.get(id)?.name ?? 'Cuenta' }))
      .sort((a, b) => b.debt - a.debt)
  }, [partyItems.items, data.ctx.accounts])
  const focusAccount = focusLine
    ? partyItems.items.find((i) => i.lineId === focusLine)?.accountId
    : undefined
  const [accountId, setAccountId] = useState<string | null>(focusAccount ?? accounts[0]?.id ?? null)

  const debts = useMemo(
    () =>
      partyItems.items
        .filter((i) => i.side === 'credit' && (accountId === null || i.accountId === accountId))
        .sort((a, b) => {
          const da = a.dueDate ?? '9999-12-31'
          const db = b.dueDate ?? '9999-12-31'
          return da < db ? -1 : da > db ? 1 : a.entryDate < b.entryDate ? -1 : 1
        }),
    [partyItems.items, accountId],
  )
  const credits = useMemo(
    () =>
      partyItems.items
        .filter((i) => i.side === 'debit' && (accountId === null || i.accountId === accountId))
        .sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1)),
    [partyItems.items, accountId],
  )

  // Con `?partida=` («Pagar» en un renglón de la libreta o en la ficha de un comprobante) se
  // tilda SOLO esa: quien tocó «Pagar» en una compra no quiere pagarle todo al proveedor.
  // Sin partida, lo vencido y lo de esta semana, como siempre.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
    focusLine && debts.some((d) => d.lineId === focusLine)
      ? new Set([focusLine])
      : new Set(defaultDebtSelection(debts, today)),
  )
  /** Importe a cancelar de cada factura tildada (`undefined` = todo lo pendiente). */
  const [targets, setTargets] = useState<ReadonlyMap<string, number | null>>(() => new Map())
  const [partialOpen, setPartialOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [creditOn, setCreditOn] = useState<ReadonlySet<string>>(
    () => new Set(credits.map((c) => c.lineId)),
  )
  const [amount, setAmount] = useState<number | null>(null)
  const [amountTouched, setAmountTouched] = useState(false)
  const [writeOff, setWriteOff] = useState(false)
  const [rows, setRows] = useState<MethodRow[]>(() => [
    newRow(
      pickTreasury({
        treasuries: data.treasuries.filter((t) => t.active),
        myLastQuickExpense: rememberedTreasury(tenantSlug),
        order: data.treasuries.map((t) => t.id),
      }),
    ),
  ])
  const [rowsTouched, setRowsTouched] = useState(false)
  const [date, setDate] = useState<string | null>(data.today)
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  /** «＋ Agregar n.º de transferencia», con un solo medio. */
  const [showReference, setShowReference] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [applying, startApplying] = useTransition()

  // Lo que el sistema recuerda: con qué se le pagó la última vez.
  useEffect(() => {
    let alive = true
    loadPartyDefaults(tenantSlug, party.id)
      .then((result) => {
        if (!alive || !result.ok || !result.data?.treasuryAccountId) return
        const remembered = result.data.treasuryAccountId
        if (!data.treasuries.some((t) => t.id === remembered && t.active)) return
        setRows((prev) =>
          prev.length === 1 && prev[0] && !rowsTouchedRef.current
            ? [{ ...prev[0], treasuryId: remembered }]
            : prev,
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tenantSlug, party.id, data.treasuries])
  rowsTouchedRef.current = rowsTouched

  // ── La cuenta del pago (FIFO por vencimiento, saldos a favor primero) ──
  const planDebts: PlanDebt[] = debts
    .filter((d) => selected.has(d.lineId))
    .map((d) => ({
      lineId: d.lineId,
      label: d.label,
      accountId: d.accountId,
      openCents: d.openCents,
      targetCents: targets.get(d.lineId) ?? d.openCents,
      dueDate: d.dueDate,
      entryDate: d.entryDate,
    }))
  const planCredits: PlanCredit[] = credits
    .filter((c) => creditOn.has(c.lineId))
    .map((c) => ({
      lineId: c.lineId,
      label: c.label,
      accountId: c.accountId,
      openCents: c.openCents,
      entryDate: c.entryDate,
    }))
  const plan = planPayment({
    debts: planDebts,
    credits: planCredits,
    amountCents: amountTouched ? amount : null,
    writeOff,
  })
  const shownAmount = amountTouched ? amount : plan.suggestedCents > 0 ? plan.suggestedCents : null
  const resolved = resolveMethods(rows, plan.amountCents)
  const coveredByCredit =
    plan.debtCents > 0 && plan.suggestedCents === 0 && plan.creditAvailableCents > 0

  const values: PaymentFormValues | null =
    date === null
      ? null
      : {
          partyId: party.id,
          date,
          applications: plan.applications,
          creditsUsed: plan.creditsUsed,
          methods: resolved.methods,
          writeOffCents: plan.writeOffCents,
          notes: notes.trim() === '' ? null : notes.trim(),
        }
  const key = values ? JSON.stringify(values) : ''
  const ctx = useMemo(() => withItems(data.ctx, partyItems.items), [data.ctx, partyItems.items])
  const movesMoney = plan.amountCents > 0 || plan.writeOffCents > 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` resume `values` (y si mueve plata)
  const preview = useMemo(
    () =>
      values && movesMoney
        ? previewDocumentForm('payment', values, ctx, { firstOpenDate: data.firstOpenDate })
        : null,
    [key, movesMoney, ctx, data.firstOpenDate],
  )

  const onSaved = (saved: SavedState) => {
    const first = rows[0]?.treasuryId
    if (first) rememberTreasury(tenantSlug, first)
    posting.undoToast(saved.message, saved)
    router.refresh()
    close()
  }

  const posting = useDocumentPosting<PaymentFormValues>({
    tenantSlug,
    action: postPayment,
    onSaved: (saved) => onSaved(saved),
    formRef,
    isKnownField: (k) => KNOWN_FIELDS.has(k) || k.startsWith('methods.'),
  })

  const dirty = amountTouched || rowsTouched || notes.trim() !== ''
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  // ── Errores propios (antes de mandar) ──
  const localErrors: Record<string, string> = {}
  if (submitted) {
    if (date === null) localErrors.date = 'Elegí la fecha.'
    if (plan.amountCents <= 0 && plan.writeOffCents <= 0) {
      localErrors.amount = coveredByCredit
        ? 'Lo que tenés a favor ya cubre lo tildado: usalo con el botón de arriba.'
        : 'Escribí cuánto pagás o tildá qué le pagás.'
    }
    if (resolved.missingTreasury) localErrors.methods = 'Elegí con qué pagás.'
    else if (resolved.unassignedCents > 0) {
      localErrors.methods = `Falta asignar ${formatCents(resolved.unassignedCents)} a un medio.`
    } else if (resolved.unassignedCents < 0) {
      localErrors.methods = `Los medios suman ${formatCents(-resolved.unassignedCents)} más que el monto.`
    }
  }
  const previewErrors = submitted && preview && !preview.ok ? (preview.fieldErrors ?? {}) : {}
  const errors: Record<string, string> = {
    ...previewErrors,
    ...localErrors,
    ...posting.fieldErrors,
  }
  const methodsError =
    errors.methods ?? Object.entries(errors).find(([k]) => k.startsWith('methods.'))?.[1]
  const unknownPreviewError =
    submitted &&
    preview &&
    !preview.ok &&
    Object.keys(preview.fieldErrors ?? {}).every(
      (k) => !KNOWN_FIELDS.has(k) && !k.startsWith('methods.'),
    )
      ? preview.message
      : null

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (posting.pending) return
    setSubmitted(true)
    const blocked =
      date === null ||
      (plan.amountCents <= 0 && plan.writeOffCents <= 0) ||
      resolved.missingTreasury ||
      resolved.unassignedCents !== 0
    if (blocked || !values || !preview?.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.hash, key)
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  // «Usar lo que tenés a favor» sin pagar nada (lo tildado ya está cubierto).
  const applyCredit = () =>
    startApplying(async () => {
      const pairs = creditPairs(planDebts, planCredits)
      if (pairs.length === 0) return
      try {
        const result = await allocateItems(tenantSlug, { pairs, date: date ?? data.today })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(`Listo: usaste lo que tenías a favor con ${name}.`)
        router.refresh()
        close()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  const toggleDebt = (lineId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(lineId)
      else next.delete(lineId)
      return next
    })
    posting.clearFieldErrors()
  }

  const setRow = (key: string, patch: Partial<MethodRow>) => {
    setRowsTouched(true)
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    posting.clearFieldErrors()
  }

  const addRow = () => {
    setRowsTouched(true)
    setRows((prev) => {
      // Al pasar de uno a dos medios, el primero queda con el monto que ya pagaba.
      const base =
        prev.length === 1 && prev[0]
          ? [{ ...prev[0], amountCents: plan.amountCents || null }]
          : prev
      const assigned = base.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)
      const rest = Math.max(0, plan.amountCents - assigned)
      const used = new Set(base.map((r) => r.treasuryId))
      const other = data.treasuries.find((t) => t.active && !used.has(t.id))?.id ?? null
      return [...base, newRow(other, rest > 0 ? rest : null)]
    })
  }

  const removeRow = (key: string) => {
    setRowsTouched(true)
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key)
      return next.length > 0 ? next : [newRow(null)]
    })
  }

  const closedMonth = date && data.firstOpenDate && date < data.firstOpenDate
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const debtTotal = debts.reduce((sum, d) => sum + d.openCents, 0)
  const creditTotal = credits.reduce((sum, c) => sum + c.openCents, 0)
  const multiRow = rows.length > 1
  const submitLabel = plan.amountCents > 0 ? `Pagar ${formatCentsShort(plan.amountCents)}` : 'Pagar'

  // ── Lo que se lee: los atajos, cómo queda la deuda y el ticket ──
  const quick = quickSelections(debts, today)
  const quickActive = activeQuick(selected, quick)
  const pickQuick = (ids: readonly string[]) => {
    setSelected(new Set(ids))
    posting.clearFieldErrors()
  }
  const outcome = paymentOutcome({ plan, debtTotalCents: debtTotal })
  const single = rows.length === 1 ? (rows[0] ?? null) : null
  const singleTreasury = single?.treasuryId
    ? (data.treasuries.find((t) => t.id === single.treasuryId) ?? null)
    : null
  const hasTreasuries = data.treasuries.some((t) => t.active)
  const labelOf = new Map(debts.map((d) => [d.lineId, d.label]))
  const ticketLines = payTicketRows(plan.applications, (lineId) => labelOf.get(lineId))
  const ticketRows: PayTicketRow[] = ticketLines.rows.map((row) => ({
    key: row.key,
    label: <VoucherText text={itemText(row.label)} />,
    cents: row.cents,
  }))
  const nothingYet = outcome.kind === 'nothing'
  const headline = payHeadline({
    debtCents: debtTotal,
    creditCents: creditTotal,
    count: debts.length,
  })

  return (
    <>
      {/* En el celular el encabezado fijo es UN renglón con el nombre (cortado si es largo) y
          «Elegir otro proveedor»: lo que se le debe baja al cuerpo y se va con el scroll. Con
          el título en dos renglones y la oración en otros dos, el marco se comía media pantalla. */}
      <ActionSheetHeader
        title={
          <span title={`Pagar a ${name}`} className="max-sm:block max-sm:truncate">
            Pagar a {name}
          </span>
        }
        description={<span className="max-sm:hidden">{headline}</span>}
      >
        <button
          type="button"
          onClick={onChangeParty}
          // 44 px de toque en el celular, sin sumarle alto al encabezado.
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:-my-2.5 md:min-h-0"
        >
          <X className="size-3" aria-hidden />
          Elegir otro proveedor
        </button>
      </ActionSheetHeader>
      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
      >
        <ActionSheetBody>
          <p className="text-sm text-muted-foreground text-pretty sm:hidden">{headline}</p>

          {/* ¿Qué le pagás?: los atajos y las compras sin pagar, cada una con su tilde */}
          {debts.length > 0 || accounts.length > 1 ? (
            <section aria-labelledby={`${uid}-que`} className={SHEET_QUESTION_BLOCK}>
              <SheetQuestion id={`${uid}-que`}>¿Qué le pagás?</SheetQuestion>

              {accounts.length > 1 ? (
                <div className="grid gap-1.5">
                  <p id={`${uid}-cuenta`} className="text-xs font-medium text-muted-foreground">
                    ¿De cuál?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {accounts.map((a) => (
                      <Pill
                        key={a.id}
                        size="touch"
                        active={a.id === accountId}
                        className="max-w-full md:pointer-fine:h-9"
                        onClick={() => {
                          if (a.id === accountId) return
                          setAccountId(a.id)
                          setSelected(new Set())
                          setTargets(new Map())
                          setCreditOn(
                            new Set(
                              partyItems.items
                                .filter((i) => i.side === 'debit' && i.accountId === a.id)
                                .map((i) => i.lineId),
                            ),
                          )
                        }}
                      >
                        <span className="truncate">{a.name}</span>
                        {a.debt > 0 ? (
                          <span className="ml-1.5 tabular-nums opacity-80">
                            {formatCentsShort(a.debt)}
                          </span>
                        ) : null}
                      </Pill>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Se paga de a una por vez.</p>
                </div>
              ) : null}

              {debts.length > 0 ? (
                <>
                  {/* En el celular las dos píldoras van lado a lado (de a una por renglón dejaban
                      entrar dos compras y media en la primera pantalla) y el link, en su renglón:
                      nada queda escondido detrás del borde. Con importes muy largos bajan de
                      renglón en vez de cortarse. */}
                  <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
                    <legend className="sr-only">Atajos para tildar</legend>
                    {quick.overdue.ids.length > 0 &&
                    quick.overdue.ids.length < quick.all.ids.length ? (
                      <Pill
                        size="touch"
                        active={quickActive === 'overdue'}
                        className="max-sm:px-3 md:pointer-fine:h-9"
                        onClick={() => pickQuick(quick.overdue.ids)}
                      >
                        Lo vencido
                        <span className="ml-1 tabular-nums opacity-80 sm:ml-1.5">
                          {formatCentsShort(quick.overdue.cents)}
                        </span>
                      </Pill>
                    ) : null}
                    <Pill
                      size="touch"
                      active={quickActive === 'all'}
                      className="max-sm:px-3 md:pointer-fine:h-9"
                      onClick={() => pickQuick(quick.all.ids)}
                    >
                      Todo
                      <span className="ml-1 tabular-nums opacity-80 sm:ml-1.5">
                        {formatCentsShort(quick.all.cents)}
                      </span>
                    </Pill>
                    {/* La salida rara, callada: un link, no una tercera píldora. */}
                    <button
                      type="button"
                      aria-pressed={quickActive === 'none'}
                      onClick={() => pickQuick([])}
                      className={cn(
                        TEXT_LINK,
                        'shrink-0 whitespace-nowrap px-1 text-sm',
                        quickActive === 'none' && 'font-medium text-foreground underline',
                      )}
                    >
                      Nada: le dejo plata a cuenta
                    </button>
                  </fieldset>

                  <LedgerList aria-label="Compras sin pagar">
                    {debts.map((d) => {
                      const on = selected.has(d.lineId)
                      const partial = partialOpen.has(d.lineId)
                      const target = targets.get(d.lineId) ?? null
                      const fieldId = `${uid}-f-${d.lineId}`
                      return (
                        <LedgerRow
                          key={d.lineId}
                          rail={<LedgerRail {...dueRail(d.dueDate, today)} />}
                          title={
                            <span className="inline-flex items-start gap-2.5 text-left">
                              <span className="mt-0.5">
                                <TickMark on={on} />
                              </span>
                              <span>
                                <VoucherText text={itemText(d.label)} />
                              </span>
                            </span>
                          }
                          onClick={() => toggleDebt(d.lineId, !on)}
                          pressed={on}
                          tint={on ? 'ok' : undefined}
                          amount={
                            <Amount cents={d.openCents} decimals={exactDecimals(d.openCents)} />
                          }
                        >
                          {on ? (
                            partial ? (
                              <div className="flex flex-wrap items-center gap-2 pb-1">
                                <Label
                                  htmlFor={`${fieldId}-parcial`}
                                  className="shrink-0 text-xs text-muted-foreground"
                                >
                                  Pagar de esta
                                </Label>
                                <MoneyInput
                                  id={`${fieldId}-parcial`}
                                  size="sm"
                                  align="end"
                                  value={target}
                                  maxCents={d.openCents}
                                  onValueChange={(cents) => {
                                    setTargets((prev) => {
                                      const next = new Map(prev)
                                      if (cents === null || cents >= d.openCents) {
                                        next.delete(d.lineId)
                                      } else next.set(d.lineId, cents)
                                      return next
                                    })
                                    posting.clearFieldErrors()
                                  }}
                                  className="w-40"
                                />
                                <button
                                  type="button"
                                  className={cn(TEXT_LINK, 'text-xs')}
                                  onClick={() => {
                                    setPartialOpen((prev) => {
                                      const next = new Set(prev)
                                      next.delete(d.lineId)
                                      return next
                                    })
                                    setTargets((prev) => {
                                      const next = new Map(prev)
                                      next.delete(d.lineId)
                                      return next
                                    })
                                  }}
                                >
                                  Toda
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={cn(TEXT_LINK, 'text-xs')}
                                onClick={() =>
                                  setPartialOpen((prev) => new Set(prev).add(d.lineId))
                                }
                              >
                                Pagar solo una parte
                              </button>
                            )
                          ) : null}
                        </LedgerRow>
                      )
                    })}
                  </LedgerList>
                </>
              ) : null}
            </section>
          ) : null}

          {/* A tu favor: se descuenta primero */}
          {credits.length > 0 ? (
            <section aria-labelledby={`${uid}-a-favor`} className="grid gap-2">
              <div>
                <h3 id={`${uid}-a-favor`} className="text-sm font-semibold">
                  A tu favor
                </h3>
                <p className="text-xs text-muted-foreground">Se descuenta primero.</p>
              </div>
              <LedgerList aria-label="A tu favor">
                {credits.map((c) => {
                  const on = creditOn.has(c.lineId)
                  return (
                    <LedgerRow
                      key={c.lineId}
                      rail={<LedgerRail label="a tu" value="favor" tone="ok" />}
                      title={
                        <span className="inline-flex items-start gap-2.5 text-left">
                          <span className="mt-0.5">
                            <TickMark on={on} />
                          </span>
                          <span>
                            {/* El número entero: truncado, «Nota de crédito A 0003-000…» no se distingue de otra. */}
                            <VoucherText text={itemText(c.label)} />
                          </span>
                        </span>
                      }
                      meta={<span className="tabular-nums">del {formatIsoDay(c.entryDate)}</span>}
                      onClick={() => {
                        setCreditOn((prev) => {
                          const next = new Set(prev)
                          if (on) next.delete(c.lineId)
                          else next.add(c.lineId)
                          return next
                        })
                        posting.clearFieldErrors()
                      }}
                      pressed={on}
                      amount={<Amount cents={c.openCents} decimals={exactDecimals(c.openCents)} />}
                    />
                  )
                })}
              </LedgerList>
            </section>
          ) : null}

          {coveredByCredit ? (
            <InlineNotice
              tone="info"
              action={
                <Button
                  type="button"
                  size="sm"
                  className="h-11 md:h-8"
                  disabled={applying}
                  onClick={applyCredit}
                >
                  {applying ? 'Usándolo…' : `Usar ${formatCentsShort(plan.debtCents)} a favor`}
                </Button>
              }
            >
              Lo que tenés a favor alcanza para lo que tildaste: no hace falta pagar nada.
            </InlineNotice>
          ) : null}

          {/* ¿Cuánto le pagás?: el importe y, debajo, lo que cubre */}
          <div className={SHEET_QUESTION_BLOCK}>
            <MoneyField
              id={`${uid}-monto`}
              label="¿Cuánto le pagás?"
              required
              value={shownAmount}
              onValueChange={(cents) => {
                setAmountTouched(true)
                setAmount(cents)
                posting.clearFieldErrors()
              }}
              error={errors.amount ?? null}
              hint={
                plan.creditUsedCents > 0
                  ? `Lo tildado ${exactAmountText(plan.appliedCents)} menos lo que tenés a favor ${exactAmountText(plan.creditUsedCents)}.`
                  : undefined
              }
              className={BIG_MONEY_FIELD}
              fieldClassName={ACTION_SHEET_QUESTION_FIELD}
            >
              {amountTouched && plan.suggestedCents > 0 && amount !== plan.suggestedCents ? (
                <button
                  type="button"
                  className={cn(TEXT_LINK, 'justify-self-start text-xs')}
                  onClick={() => {
                    setAmountTouched(false)
                    setAmount(null)
                  }}
                >
                  Volver a lo tildado: {exactAmountText(plan.suggestedCents)}
                </button>
              ) : null}
            </MoneyField>
            <PayCover outcome={outcome} />
            {plan.canWriteOff ? (
              <label
                htmlFor={`${uid}-dif`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-secondary/50 p-3 text-sm"
              >
                <Checkbox
                  id={`${uid}-dif`}
                  checked={writeOff}
                  onCheckedChange={(checked) => setWriteOff(checked === true)}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">
                    Dar por pagados los {exactAmountText(plan.restCents)} que faltan
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Para diferencias chicas de redondeo (hasta $ 1.000).
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {/* ¿Con qué pagás? */}
          {hasTreasuries ? (
            <div className={SHEET_QUESTION_BLOCK}>
              <SheetQuestion id={`${uid}-con-que`} required>
                ¿Con qué pagás?
              </SheetQuestion>
              {single ? (
                <>
                  <TreasuryPicker
                    id={`${uid}-caja`}
                    aria-labelledby={`${uid}-con-que`}
                    value={single.treasuryId}
                    onValueChange={(next) => setRow(single.key, { treasuryId: next })}
                    treasuries={data.treasuries}
                    invalid={Boolean(methodsError) && !single.treasuryId}
                  />
                  {singleTreasury ? (
                    <TreasuryAfterLine
                      treasury={singleTreasury}
                      amountCents={plan.amountCents > 0 ? plan.amountCents : null}
                    />
                  ) : null}
                  {showReference || single.reference ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-ref`}>
                        N.º de transferencia{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          (opcional)
                        </span>
                      </Label>
                      <Input
                        id={`${uid}-ref`}
                        value={single.reference}
                        maxLength={60}
                        autoComplete="off"
                        onChange={(e) => setRow(single.key, { reference: e.target.value })}
                        className="h-11 text-base md:h-10 md:text-sm"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-5">
                    {showReference || single.reference ? null : (
                      <button
                        type="button"
                        className={ADD_LINK}
                        onClick={() => {
                          setShowReference(true)
                          requestAnimationFrame(() =>
                            document.getElementById(`${uid}-ref`)?.focus(),
                          )
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        Agregar n.º de transferencia
                      </button>
                    )}
                    <button type="button" className={ADD_LINK} onClick={addRow}>
                      <Plus className="size-3.5" aria-hidden />
                      Pagar con dos medios
                    </button>
                  </div>
                </>
              ) : (
                <fieldset
                  aria-labelledby={`${uid}-con-que`}
                  className="grid min-w-0 gap-2 border-0 p-0"
                >
                  {rows.map((row, index) => (
                    <div key={row.key} className="grid gap-2 rounded-xl bg-secondary/50 p-3">
                      <div className="flex items-center gap-2">
                        <TreasurySelect
                          aria-label={`Medio ${index + 1}`}
                          value={row.treasuryId}
                          onValueChange={(next) => setRow(row.key, { treasuryId: next })}
                          treasuries={data.treasuries}
                          invalid={Boolean(methodsError) && !row.treasuryId}
                          className="min-w-0 flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11 shrink-0 text-muted-foreground md:size-9"
                          aria-label={`Quitar el medio ${index + 1}`}
                          onClick={() => removeRow(row.key)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <MoneyInput
                          aria-label={`Importe del medio ${index + 1}`}
                          value={row.amountCents}
                          align="end"
                          onValueChange={(cents) => setRow(row.key, { amountCents: cents })}
                          invalid={Boolean(methodsError) && (row.amountCents ?? 0) <= 0}
                        />
                        <Input
                          aria-label={`N.º de transferencia del medio ${index + 1}`}
                          value={row.reference}
                          maxLength={60}
                          autoComplete="off"
                          placeholder="N.º de transferencia"
                          onChange={(e) => setRow(row.key, { reference: e.target.value })}
                          className="h-11 text-base placeholder:text-muted-foreground/50 md:h-10 md:text-sm"
                        />
                      </div>
                    </div>
                  ))}
                  <button type="button" className={ADD_LINK} onClick={addRow}>
                    <Plus className="size-3.5" aria-hidden />
                    Otro medio
                  </button>
                  {resolved.unassignedCents !== 0 && !methodsError ? (
                    <p className="text-xs text-warning-text">
                      {resolved.unassignedCents > 0
                        ? `Falta asignar ${formatCents(resolved.unassignedCents)} a un medio.`
                        : `Los medios suman ${formatCents(-resolved.unassignedCents)} más que el monto.`}
                    </p>
                  ) : null}
                </fieldset>
              )}
              {methodsError ? (
                <p role="alert" className="text-xs text-destructive">
                  {methodsError}
                </p>
              ) : null}
            </div>
          ) : (
            <InlineNotice>
              No hay cajas ni cuentas activas para pagar. Activá una en Ajustes › Cajas y cuentas.
            </InlineNotice>
          )}

          {/* El ticket: lo que va a pasar, en palabras */}
          <PayTicket
            name={name}
            subtitle={date ? formatDayLabel(date) : 'Sin fecha'}
            rows={ticketRows}
            more={ticketLines.more}
            moreCents={ticketLines.moreCents}
            creditUsedCents={plan.creditUsedCents}
            writeOffCents={plan.writeOffCents}
            totalLabel={
              multiRow
                ? `Salen de ${rows.length} medios`
                : singleTreasury
                  ? ticketTotalLabel(singleTreasury)
                  : 'Pagás'
            }
            totalCents={plan.amountCents > 0 ? plan.amountCents : null}
            totalHint={
              singleTreasury && plan.amountCents > 0 ? (
                <TreasuryAfterHint treasury={singleTreasury} amountCents={plan.amountCents} />
              ) : undefined
            }
            note={[outcome.sentence, ...outcome.details].join(' ')}
            pending={nothingYet}
          />

          <DateField
            id={`${uid}-fecha`}
            label="Fecha del pago"
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
            hint={
              closedMonth && data.firstOpenDate
                ? `Ese mes está cerrado: el pago va el ${formatIsoDay(data.firstOpenDate)}.`
                : undefined
            }
          />

          {showNotes || notes ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-nota`}>
                Nota <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id={`${uid}-nota`}
                value={notes}
                maxLength={1000}
                rows={2}
                onChange={(e) => setNotes(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowNotes(true)
                requestAnimationFrame(() => document.getElementById(`${uid}-nota`)?.focus())
              }}
              className={ADD_LINK}
            >
              <Plus className="size-3.5" aria-hidden />
              Agregar una nota
            </button>
          )}

          <EntryPreview
            entries={entries}
            label="Ver cómo queda en los libros"
            emptyText="Elegí qué pagás y con qué para ver cómo queda en los libros."
          />

          {unknownPreviewError ? (
            <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
          ) : null}
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>

        <ActionSheetFooter>
          <Button type="submit" className="h-12 w-full sm:w-auto" disabled={posting.pending}>
            {posting.pending ? 'Guardando…' : submitLabel}
          </Button>
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
