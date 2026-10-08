'use client'

import { ChevronRight, Plus, Trash2, X } from 'lucide-react'
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
  creditPairs,
  defaultDebtSelection,
  type MethodRow,
  type PlanCredit,
  type PlanDebt,
  planPayment,
  resolveMethods,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/payment-plan'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { allocateItems, postPayment } from '@/lib/accounting/actions/documents'
import { pickTreasury } from '@/lib/accounting/defaults'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { PaymentValues } from '@/lib/accounting/server/document-types'
import type { OpenItemRef, PostingContext } from '@/lib/accounting/types'
import { formatIsoDay } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { Amount } from '../amount'
import { DateField } from '../date-input'
import { DueStatus } from '../due-status'
import { EntryPreview } from '../entry-preview'
import { balanceText } from '../format'
import { MoneyField, MoneyInput } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasurySelect } from '../treasury-select'
import { VoucherText } from '../voucher-text'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.pagar
const DESCRIPTION = 'Elegí a quién, qué facturas y con qué pagás.'
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

let rowSeq = 0
function newRow(treasuryId: string | null, amountCents: number | null = null): MethodRow {
  rowSeq += 1
  return { key: `m${rowSeq}`, treasuryId, amountCents, reference: '' }
}

/** Hoja «Pagar» (H.8): proveedor → facturas (o un pago a cuenta) → con qué → listo. */
export function PagarSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetData(() => loadSheetData(tenantSlug, { balances: true }), tenantSlug)
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
  return <PagarForm {...props} data={load.data} />
}

function PagarForm({
  tenantSlug,
  params,
  close,
  setDirty,
  data,
}: ActionSheetProps & { data: SheetData }) {
  const uid = useId()
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

  const payables = useMemo(
    () => data.parties.filter((p) => PAYABLE_KINDS.has(p.kind) && (p.active || p.id === partyId)),
    [data.parties, partyId],
  )
  const balanceById = useMemo(
    () => new Map((data.balances ?? []).map((b) => [b.partyId, b])),
    [data.balances],
  )
  const withDebt = useMemo(
    () =>
      (data.balances ?? [])
        .filter((b) => b.debtCents > 0 && partyById.has(b.partyId))
        .sort(
          (a, b) =>
            b.overdueCents - a.overdueCents ||
            (a.nextDueDate ?? '9999-12-31').localeCompare(b.nextDueDate ?? '9999-12-31') ||
            b.debtCents - a.debtCents,
        )
        .slice(0, 6),
    [data.balances, partyById],
  )
  const options: PartyOption[] = useMemo(
    () =>
      payables.map((p) => {
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
    [payables, balanceById],
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
      <>
        <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
        <ActionSheetBody>
          {lineFromUrl && items.status === 'error' && items.message ? (
            <InlineNotice tone="info">{items.message}</InlineNotice>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-proveedor`}>¿A quién le pagás?</Label>
            <PartyCombobox
              id={`${uid}-proveedor`}
              value={null}
              onValueChange={(id) => setPartyId(id)}
              parties={options}
              placeholder="Elegí un proveedor"
            />
          </div>
          {withDebt.length > 0 ? (
            <section aria-labelledby={`${uid}-con-deuda`} className="space-y-2">
              <h3
                id={`${uid}-con-deuda`}
                className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
              >
                Lo más urgente
              </h3>
              <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                {withDebt.map((b) => {
                  const p = partyById.get(b.partyId)
                  if (!p) return null
                  return (
                    <li key={b.partyId}>
                      <button
                        type="button"
                        onClick={() => setPartyId(b.partyId)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-cream-tint focus-visible:bg-cream-tint"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{partyName(p)}</span>
                          <span
                            className={cn(
                              'block text-xs',
                              b.trafficLight === 'red'
                                ? 'text-destructive'
                                : b.trafficLight === 'yellow'
                                  ? 'text-warning-text'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {b.trafficText}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-sm">
                          <Amount cents={b.debtCents} decimals={0} className="font-medium" />
                          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : data.balances?.every((b) => b.debtCents === 0) ? (
            <p className="text-sm text-muted-foreground">
              No le debés nada a ningún proveedor. Igual podés elegir uno y dejarle un pago a
              cuenta.
            </p>
          ) : null}
        </ActionSheetBody>
      </>
    )
  }

  if (!items.data || items.data.partyId !== chosen.id) {
    return (
      <>
        <ActionSheetHeader title={`Pagar a ${partyName(chosen)}`} description={DESCRIPTION} />
        <ActionSheetBody>
          {items.status === 'error' ? (
            <SheetLoadError message={items.message} onRetry={items.reload} />
          ) : (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Cargando lo que le debés…</span>
              {['a', 'b', 'c'].map((k) => (
                <Skeleton key={k} className="h-14 w-full rounded-xl" />
              ))}
              <Skeleton className="h-11 w-full" />
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

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(defaultDebtSelection(debts, today, { extra: focusLine })),
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
        ? 'El saldo a favor ya cubre lo elegido: usalo con el botón de arriba.'
        : 'Escribí cuánto pagás o tildá qué facturas.'
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

  // «Usar el saldo a favor» sin pagar nada (lo elegido ya está cubierto).
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
        toast.success(`Listo: usaste el saldo a favor con ${name}.`)
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

  const partialsText = plan.partials
    .filter((p) => plan.applications.some((a) => a.lineId === p.lineId))
    .map((p) => `${p.label} queda con ${formatCents(p.pendingCents)} pendientes`)
  const untouchedDebts = plan.partials.filter(
    (p) => !plan.applications.some((a) => a.lineId === p.lineId),
  )
  const closedMonth = date && data.firstOpenDate && date < data.firstOpenDate
  const entries = posting.overrideFor(key) ?? (preview?.ok ? preview.preview : [])
  const debtTotal = debts.reduce((sum, d) => sum + d.openCents, 0)
  const creditTotal = credits.reduce((sum, c) => sum + c.openCents, 0)
  const multiRow = rows.length > 1
  const submitLabel = plan.amountCents > 0 ? `Pagar ${formatCentsShort(plan.amountCents)}` : 'Pagar'

  return (
    <>
      <ActionSheetHeader
        title={`Pagar a ${name}`}
        description={
          debtTotal > 0 || creditTotal > 0
            ? balanceText(debtTotal - creditTotal, 'payable')
            : `No le debés nada a ${name}. Podés dejar un pago a cuenta.`
        }
      >
        <button
          type="button"
          onClick={onChangeParty}
          className="inline-flex min-h-11 items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
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
          {accounts.length > 1 ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-cuenta`}>¿Qué le pagás?</Label>
              <Select
                value={accountId ?? undefined}
                onValueChange={(next) => {
                  setAccountId(next)
                  setSelected(new Set())
                  setTargets(new Map())
                  setCreditOn(
                    new Set(
                      partyItems.items
                        .filter((i) => i.side === 'debit' && i.accountId === next)
                        .map((i) => i.lineId),
                    ),
                  )
                }}
              >
                <SelectTrigger
                  id={`${uid}-cuenta`}
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="min-h-11 md:min-h-8">
                      {a.name}
                      {a.debt > 0 ? ` · ${formatCentsShort(a.debt)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Un pago cancela comprobantes de una sola cuenta.
              </p>
            </div>
          ) : null}

          {/* Facturas pendientes */}
          {debts.length > 0 ? (
            <section aria-labelledby={`${uid}-facturas`} className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <h3 id={`${uid}-facturas`} className="text-sm font-medium">
                  ¿Qué facturas pagás?
                </h3>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    const all = selected.size < debts.length
                    setSelected(all ? new Set(debts.map((d) => d.lineId)) : new Set())
                    posting.clearFieldErrors()
                  }}
                >
                  {selected.size < debts.length ? 'Tildar todas' : 'Destildar todas'}
                </button>
              </div>
              <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                {debts.map((d) => {
                  const on = selected.has(d.lineId)
                  const partial = partialOpen.has(d.lineId)
                  const target = targets.get(d.lineId) ?? null
                  const checkboxId = `${uid}-f-${d.lineId}`
                  return (
                    <li key={d.lineId} className="px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={checkboxId}
                          checked={on}
                          onCheckedChange={(checked) => toggleDebt(d.lineId, checked === true)}
                          className="mt-1"
                        />
                        <label
                          htmlFor={checkboxId}
                          className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-start justify-between gap-3"
                        >
                          <span className="min-w-0 space-y-0.5">
                            <span className="block text-sm font-medium text-pretty">
                              <VoucherText text={d.label} />
                            </span>
                            <DueStatus dueDate={d.dueDate} today={today} showDate />
                          </span>
                          <Amount cents={d.openCents} className="shrink-0 text-sm font-medium" />
                        </label>
                      </div>
                      {on ? (
                        partial ? (
                          <div className="mt-2 flex items-center gap-2 pl-7">
                            <Label
                              htmlFor={`${checkboxId}-parcial`}
                              className="shrink-0 text-xs text-muted-foreground"
                            >
                              Pagar de esta
                            </Label>
                            <MoneyInput
                              id={`${checkboxId}-parcial`}
                              size="sm"
                              align="end"
                              value={target}
                              maxCents={d.openCents}
                              onValueChange={(cents) => {
                                setTargets((prev) => {
                                  const next = new Map(prev)
                                  if (cents === null || cents >= d.openCents) next.delete(d.lineId)
                                  else next.set(d.lineId, cents)
                                  return next
                                })
                                posting.clearFieldErrors()
                              }}
                              className="w-40"
                            />
                            <button
                              type="button"
                              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
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
                            className="mt-1 ml-7 inline-flex min-h-9 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:min-h-0"
                            onClick={() => setPartialOpen((prev) => new Set(prev).add(d.lineId))}
                          >
                            Pagar solo una parte
                          </button>
                        )
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {/* Saldos a favor */}
          {credits.length > 0 ? (
            <section aria-labelledby={`${uid}-a-favor`} className="space-y-2">
              <h3 id={`${uid}-a-favor`} className="text-sm font-medium">
                Saldos a favor
              </h3>
              <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                {credits.map((c) => {
                  const checkboxId = `${uid}-c-${c.lineId}`
                  return (
                    <li key={c.lineId} className="flex items-start gap-3 px-3 py-2.5">
                      <Checkbox
                        id={checkboxId}
                        checked={creditOn.has(c.lineId)}
                        onCheckedChange={(checked) => {
                          setCreditOn((prev) => {
                            const next = new Set(prev)
                            if (checked === true) next.add(c.lineId)
                            else next.delete(c.lineId)
                            return next
                          })
                          posting.clearFieldErrors()
                        }}
                        className="mt-1"
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-start justify-between gap-3"
                      >
                        <span className="min-w-0">
                          {/* El número entero: truncado, «Nota de crédito A 0003-000…» no se distingue de otra. */}
                          <span className="block text-sm font-medium text-pretty">
                            <VoucherText text={c.label} />
                          </span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {formatIsoDay(c.entryDate)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm">
                          <span className="block text-[11px] text-muted-foreground">A favor</span>
                          <Amount cents={c.openCents} className="font-medium text-success" />
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Los saldos a favor tildados se descuentan primero.
              </p>
            </section>
          ) : null}

          {coveredByCredit ? (
            <InlineNotice
              tone="info"
              action={
                <Button
                  type="button"
                  size="sm"
                  className="h-9 md:h-7"
                  disabled={applying}
                  onClick={applyCredit}
                >
                  {applying ? 'Aplicando…' : `Usar ${formatCentsShort(plan.debtCents)} a favor`}
                </Button>
              }
            >
              El saldo a favor alcanza para lo que tildaste: no hace falta pagar nada.
            </InlineNotice>
          ) : null}

          {/* Monto */}
          <MoneyField
            id={`${uid}-monto`}
            label="Monto a pagar"
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
                ? `Facturas ${formatCents(plan.appliedCents)} − a favor ${formatCents(plan.creditUsedCents)}.`
                : debts.length === 0
                  ? 'Queda como pago a cuenta: se descuenta de la próxima factura.'
                  : undefined
            }
          >
            {amountTouched && plan.suggestedCents > 0 && amount !== plan.suggestedCents ? (
              <button
                type="button"
                className="justify-self-start text-xs font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setAmountTouched(false)
                  setAmount(null)
                }}
              >
                Pagar lo tildado: {formatCents(plan.suggestedCents)}
              </button>
            ) : null}
          </MoneyField>

          {partialsText.length > 0 ? (
            <InlineNotice tone="info">{partialsText.join(' · ')}.</InlineNotice>
          ) : null}
          {untouchedDebts.length > 0 && plan.appliedCents > 0 ? (
            <InlineNotice tone="info">
              Con este monto no alcanza para {untouchedDebts.map((p) => p.label).join(', ')}: queda
              pendiente.
            </InlineNotice>
          ) : null}
          {plan.onAccountCents > 0 ? (
            <InlineNotice tone="info">
              Quedan {formatCents(plan.onAccountCents)} a cuenta (pago adelantado): se descuentan de
              la próxima factura.
            </InlineNotice>
          ) : null}
          {plan.canWriteOff ? (
            <label
              htmlFor={`${uid}-dif`}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3 text-sm"
            >
              <Checkbox
                id={`${uid}-dif`}
                checked={writeOff}
                onCheckedChange={(checked) => setWriteOff(checked === true)}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">
                  Dar por cancelado el resto ({formatCents(plan.restCents)})
                </span>
                <span className="block text-xs text-muted-foreground">
                  Para diferencias chicas de redondeo (hasta $ 1.000). Queda como descuento
                  obtenido.
                </span>
              </span>
            </label>
          ) : null}

          {/* Con qué */}
          {/* Sin m-0: pisaba el space-y-5 del cuerpo y «Fecha del pago» quedaba pegada a «Otro medio» (el preflight ya saca el margen del fieldset). */}
          <fieldset className="grid min-w-0 gap-2 border-0 p-0">
            <legend className="mb-1.5 text-sm font-medium">
              ¿Con qué pagás?
              {/* ml-2.5: el mismo aire que el «*» de un <Label> (gap-2 + ml-0.5). */}
              <span aria-hidden="true" className="ml-2.5 text-destructive">
                *
              </span>
            </legend>
            {rows.map((row, index) => (
              <div
                key={row.key}
                className="grid gap-2 rounded-xl border border-border/70 bg-card/50 p-3"
              >
                <div className="flex items-center gap-2">
                  <TreasurySelect
                    aria-label={multiRow ? `Medio ${index + 1}` : 'Con qué pagás'}
                    value={row.treasuryId}
                    onValueChange={(next) => setRow(row.key, { treasuryId: next })}
                    treasuries={data.treasuries}
                    invalid={Boolean(methodsError) && !row.treasuryId}
                    className="min-w-0 flex-1"
                  />
                  {multiRow ? (
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
                  ) : null}
                </div>
                <div className={cn('grid gap-2', multiRow ? 'grid-cols-2' : 'grid-cols-1')}>
                  {multiRow ? (
                    <MoneyInput
                      aria-label={`Importe del medio ${index + 1}`}
                      value={row.amountCents}
                      align="end"
                      onValueChange={(cents) => setRow(row.key, { amountCents: cents })}
                      invalid={Boolean(methodsError) && (row.amountCents ?? 0) <= 0}
                    />
                  ) : null}
                  <Input
                    aria-label={multiRow ? `Referencia del medio ${index + 1}` : 'Referencia'}
                    value={row.reference}
                    maxLength={60}
                    autoComplete="off"
                    placeholder="Referencia (opcional): n° de transferencia"
                    onChange={(e) => setRow(row.key, { reference: e.target.value })}
                    className="h-11 text-base md:h-10 md:text-sm"
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 justify-self-start gap-1.5 text-muted-foreground md:h-8"
              onClick={addRow}
            >
              <Plus className="size-3.5" aria-hidden />
              Otro medio
            </Button>
            {multiRow && resolved.unassignedCents !== 0 && !methodsError ? (
              <p className="text-xs text-warning-text">
                {resolved.unassignedCents > 0
                  ? `Falta asignar ${formatCents(resolved.unassignedCents)} a un medio.`
                  : `Los medios suman ${formatCents(-resolved.unassignedCents)} más que el monto.`}
              </p>
            ) : null}
            {methodsError ? (
              <p role="alert" className="text-xs text-destructive">
                {methodsError}
              </p>
            ) : null}
          </fieldset>

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
              onClick={() => setShowNotes(true)}
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-0"
            >
              <Plus className="size-3.5" aria-hidden />
              Agregar una nota
            </button>
          )}

          <EntryPreview
            entries={entries}
            emptyText="Elegí qué pagás y con qué para ver el asiento."
          />

          {unknownPreviewError ? (
            <FormBanner banner={{ tone: 'error', message: unknownPreviewError }} />
          ) : null}
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>

        <ActionSheetFooter>
          <Button type="submit" className="h-11 w-full sm:w-auto md:h-9" disabled={posting.pending}>
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
