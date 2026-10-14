'use client'

import { ChevronRight, ListPlus, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ADD_LINK, TEXT_LINK } from '@/components/administracion/acciones/sheet-parts'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { newClientRef } from '@/components/administracion/cajas-ventas/client-ref'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import { DateField } from '@/components/administracion/date-input'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import { StepCard, type StepState } from '@/components/administracion/kit/step'
import { WALLET_ICONS } from '@/components/administracion/kit/wallet-card'
import { MoneyField } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ACC_UNREACHABLE, issuePath } from '@/lib/accounting/action-state'
import type { SavedParty } from '@/lib/accounting/actions/master'
import { postOpening, skipOpening } from '@/lib/accounting/actions/setup'
import { engineErrorsState, type WarningCopy } from '@/lib/accounting/errors'
import { treasuryTones } from '@/lib/accounting/home'
import { buildOpening } from '@/lib/accounting/posting/opening'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { openingSchema } from '@/lib/accounting/schemas'
import type {
  EntryPreview as EntryPreviewModel,
  PartyKind,
  PartyRef,
  PostingContext,
  Side,
  TreasuryKind,
  WarningKey,
} from '@/lib/accounting/types'
import { formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { INPUT_CLASS } from '../../ajustes/_components/inputs'
import { TreasuryDialog } from '../../ajustes/_components/treasury-dialog'
import {
  emptyItemRow,
  emptyOtherRow,
  hasAnyOpeningValue,
  initialOpeningState,
  isBlankItem,
  type OpeningFormState,
  type OpeningItemRow,
  type OpeningOtherRow,
  type OpeningPayload,
  type OpeningTreasury,
  openingFieldKey,
  openingPayload,
  openingStateFromDraft,
  openingTotals,
} from '../_lib/opening'
import { OPENING_ITEMS_MAX } from '../_lib/opening-import'
import { isImplicitSubmit } from '../_lib/wizard'
import { NewPartyDialog, type NewPartyKind } from './new-party-dialog'
import { type ImportedPayable, OpeningImportDialog } from './opening-import-dialog'
import { OpeningTicket } from './opening-ticket'

const PAYABLE_KINDS: ReadonlySet<PartyKind> = new Set([
  'supplier',
  'tax_agency',
  'payroll',
  'partner',
  'bank',
  'other',
])
const RECEIVABLE_KINDS: ReadonlySet<PartyKind> = new Set([
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
])

/** El hash todavía no calculado: la acción no lo mira hasta armar su propio asiento. */
const NO_HASH = '0'.repeat(64)

/** «Otros saldos»: en palabras de dueño; los valores (`debit` / `credit`) son los de siempre. */
const SIDE_OPTIONS = [
  { value: 'debit' as const, label: 'Lo tenían' },
  { value: 'credit' as const, label: 'Lo debían' },
]

/** La ayuda de cada caja: de dónde se saca el número. */
const TREASURY_HINT: Readonly<Record<TreasuryKind, string>> = {
  cash: 'Los billetes contados ese día.',
  wallet: 'El saldo de la app al empezar el día.',
  bank: 'El saldo del resumen de ese día.',
  credit_card: 'Lo que faltaba pagar.',
  other: 'Lo que había al empezar el día.',
}

/** El alta de una caja desde acá (una referencia estable: no reinicia el diálogo al redibujar). */
const ADD_TREASURY = { row: null } as const

type Banner = { tone: 'error' | 'info'; message: string }
type ItemList = 'payables' | 'receivables'

function draftKey(slug: string): string {
  return `hub:acc:draft:apertura:${slug}`
}

function partyRefOf(saved: SavedParty): PartyRef {
  return {
    id: saved.id,
    kind: saved.kind,
    name: saved.name,
    tradeName: saved.tradeName,
    taxIdType: saved.taxIdType,
    taxId: saved.taxId,
    ivaCondition: saved.ivaCondition,
    paymentTermDays: saved.paymentTermDays,
    payableAccountId: saved.payableAccountId ?? '',
    receivableAccountId: saved.receivableAccountId ?? '',
    commissionVatMode: saved.commissionVatMode,
    rates: {
      commissionBp: saved.commissionBp,
      iibbWithholdingBp: saved.iibbWithholdingBp,
      vatWithholdingBp: saved.vatWithholdingBp,
      incomeTaxWithholdingBp: saved.incomeTaxWithholdingBp,
      sircupaBp: saved.sircupaBp,
    },
    active: saved.active,
  }
}

function partyOption(p: PartyRef): PartyOption {
  return {
    id: p.id,
    name: p.name,
    tradeName: p.tradeName,
    taxId: p.taxId,
    active: p.active,
    description: p.kind === 'supplier' ? null : (PARTY_KIND_LABELS[p.kind] ?? null),
  }
}

/** Errores de zod o del motor (con ruta) → claves de campo de la pantalla. */
function mapErrors(
  fieldErrors: Readonly<Record<string, string>>,
  index: OpeningPayload['index'],
  fallback: string | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, message] of Object.entries(fieldErrors)) {
    const key = openingFieldKey(path, index)
    if (!(key in out)) out[key] = message
  }
  if (Object.keys(out).length === 0 && fallback) out.form = fallback
  return out
}

/** «12 deudas por $ 1.234.567». */
function countLine(count: number, cents: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many} por ${formatCentsShort(cents)}`
}

/**
 * Los saldos iniciales (el paso 6 de la puesta en marcha): lo que había en cada
 * caja y lo que se debía el primer día → `postOpening`, o «Arrancar en cero»
 * (`skipOpening`). Se carga UNA sola vez.
 *
 * Tiene la forma del cierre del día: secciones numeradas, todas a la vista,
 * que se tildan solas, y un ticket que se arma solo al costado (en el celular,
 * detrás de «Ver resumen»). El estado, el envío, la vista previa armada por el
 * mismo motor, el `clientRef`, los avisos confirmables y el borrador son los de
 * siempre: cambió cómo se recorre, no lo que se guarda.
 */
export function OpeningStep({
  tenantSlug,
  booksStartDate,
  treasuries,
  ctx,
  accounts,
  otherAccountIds,
  loadedSinceStart = false,
}: {
  tenantSlug: string
  booksStartDate: string
  treasuries: OpeningTreasury[]
  ctx: PostingContext
  /** El plan entero (para las rutas del combo de «Otros saldos»). */
  accounts: AccountOption[]
  /** Las cuentas que se pueden usar en «Otros saldos». */
  otherAccountIds: string[]
  /**
   * Ya hay comprobantes cargados desde la fecha de arranque (HUB arrancó con dos compras del
   * mismo día): se avisa que esas NO van acá, para que no se anoten dos veces.
   */
  loadedSinceStart?: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState<OpeningFormState>(() =>
    initialOpeningState({ payable: 'pay_1', receivable: 'rec_1' }),
  )
  const [clientRef] = useState(newClientRef)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<Banner | null>(null)
  const [warnings, setWarnings] = useState<WarningCopy[] | null>(null)
  const [acks, setAcks] = useState<WarningKey[]>([])
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [restored, setRestored] = useState(false)
  const [done, setDone] = useState(false)
  const [extraParties, setExtraParties] = useState<PartyRef[]>([])
  const [creating, setCreating] = useState<{
    kind: NewPartyKind
    list: ItemList
    rowId: string
    name: string
  } | null>(null)
  /** Renglones con «vencimiento y comprobante» desplegados. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [addingTreasury, setAddingTreasury] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [draftLoaded, setDraftLoaded] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)
  const counter = useRef(2)

  // ─── Borrador ──────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(tenantSlug))
      if (raw) {
        const parsed = openingStateFromDraft(JSON.parse(raw))
        if (parsed && hasAnyOpeningValue(parsed)) {
          setForm(parsed)
          setRestored(true)
          // Los ids nuevos siguen después del más alto del borrador (nunca se repiten).
          const suffixes = [...parsed.payables, ...parsed.receivables, ...parsed.others].map(
            (row) => Number(/_(\d+)$/.exec(row.id)?.[1] ?? 0),
          )
          counter.current = Math.max(2, ...suffixes)
        }
      }
    } catch {
      // Sin localStorage o un borrador roto: se arranca de cero.
    }
    setDraftLoaded(true)
  }, [tenantSlug])

  useEffect(() => {
    // Hasta leer el borrador no se escribe nada (si no, el formulario vacío lo pisaría).
    if (!draftLoaded || done) return
    try {
      if (hasAnyOpeningValue(form)) {
        window.localStorage.setItem(draftKey(tenantSlug), JSON.stringify(form))
      } else {
        window.localStorage.removeItem(draftKey(tenantSlug))
      }
    } catch {
      // Sin espacio o sin permiso: el formulario sigue andando igual.
    }
  }, [form, tenantSlug, done, draftLoaded])

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey(tenantSlug))
    } catch {
      // nada que limpiar
    }
  }

  // Con errores, el foco va al primer campo marcado.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  // ─── Contexto del motor (+ los que se crearon recién) ──────────────────────
  const engineCtx = useMemo<PostingContext>(() => {
    const missing = extraParties.filter((p) => !ctx.parties.has(p.id))
    if (missing.length === 0) return ctx
    const parties = new Map(ctx.parties)
    for (const p of missing) parties.set(p.id, p)
    return { ...ctx, parties }
  }, [ctx, extraParties])

  const allParties = useMemo(() => [...engineCtx.parties.values()], [engineCtx])
  const payableParties = useMemo(
    () => allParties.filter((p) => PAYABLE_KINDS.has(p.kind)),
    [allParties],
  )
  const payableOptions = useMemo(() => payableParties.map(partyOption), [payableParties])
  const receivableOptions = useMemo(
    () => allParties.filter((p) => RECEIVABLE_KINDS.has(p.kind)).map(partyOption),
    [allParties],
  )
  const allowedOthers = useMemo(() => new Set(otherAccountIds), [otherAccountIds])
  const tones = useMemo(() => treasuryTones(treasuries), [treasuries])

  // ─── Vista previa: lo completo, armado por el motor ────────────────────────
  const preview = useMemo(() => {
    const payload = openingPayload(form, treasuries, { completeOnly: true })
    const totals = openingTotals(payload.values, treasuries)
    let entries: EntryPreviewModel[] = []
    const parsed = openingSchema.safeParse({
      clientRef,
      previewHash: NO_HASH,
      warningsAck: [],
      ...payload.values,
    })
    if (parsed.success) {
      const { clientRef: ref, previewHash: _hash, ...input } = parsed.data
      try {
        const built = buildOpening(input, engineCtx, { clientRef: ref })
        if (built.ok) entries = built.preview
      } catch {
        entries = []
      }
    }
    return { entries, totals, values: payload.values }
  }, [form, treasuries, engineCtx, clientRef])

  // ─── Cambios ───────────────────────────────────────────────────────────────
  const nextId = (prefix: string) => {
    counter.current += 1
    return `${prefix}_${counter.current}`
  }
  const clearError = (...keys: string[]) =>
    setErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev
      const next = { ...prev }
      for (const k of keys) delete next[k]
      return next
    })
  const setTreasury = (id: string, cents: number | null) => {
    setForm((f) => ({ ...f, treasuries: { ...f.treasuries, [id]: cents } }))
    clearError(`treasuries.${id}`, 'form')
  }
  const updateItem = (list: ItemList, id: string, patch: Partial<OpeningItemRow>) => {
    setForm((f) => ({ ...f, [list]: f[list].map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    clearError(...Object.keys(patch).map((k) => `${list}.${id}.${k}`), 'form')
  }
  const updateOther = (id: string, patch: Partial<OpeningOtherRow>) => {
    setForm((f) => ({ ...f, others: f.others.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    clearError(...Object.keys(patch).map((k) => `others.${id}.${k}`), 'form')
  }
  const removeRow = (list: ItemList | 'others', id: string) =>
    setForm((f) => ({ ...f, [list]: f[list].filter((r) => r.id !== id) }))

  /** «Pegar la lista de mi planilla»: las deudas pegadas quedan como renglones, para revisarlas. */
  const importPayables = (lines: ImportedPayable[], created: SavedParty[]) => {
    if (created.length > 0) {
      const ids = new Set(created.map((p) => p.id))
      setExtraParties((list) => [...list.filter((p) => !ids.has(p.id)), ...created.map(partyRefOf)])
      router.refresh()
    }
    const rows = lines.map((l) => ({
      id: nextId('pay'),
      partyId: l.partyId,
      amountCents: l.amountCents,
      dueDate: l.dueDate,
      reference: l.reference,
    }))
    setForm((f) => ({ ...f, payables: [...f.payables.filter((r) => !isBlankItem(r)), ...rows] }))
    clearError('form', 'treasuries')
    toast.success(
      rows.length === 1
        ? 'Se cargó 1 deuda. Revisala antes de guardar.'
        : `Se cargaron ${rows.length} deudas. Revisalas antes de guardar.`,
    )
  }

  // ─── Guardar ───────────────────────────────────────────────────────────────
  const finish = (message: string) => {
    clearDraft()
    toast.success(message)
    // El ticket queda con su tilde y la página pasa sola a «Listo».
    setDone(true)
    router.refresh()
  }

  const submit = (accepted: WarningKey[]) => {
    if (pending || done) return
    setBanner(null)
    const payload = openingPayload(form, treasuries)
    const parsed = openingSchema.safeParse({
      clientRef,
      previewHash: NO_HASH,
      warningsAck: accepted,
      ...payload.values,
    })
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const path = issuePath(issue.path)
        if (!(path in fieldErrors)) fieldErrors[path] = issue.message
      }
      setErrors(mapErrors(fieldErrors, payload.index, parsed.error.issues[0]?.message ?? null))
      return
    }
    const { clientRef: ref, previewHash: _hash, ...input } = parsed.data
    const built = buildOpening(input, engineCtx, { clientRef: ref })
    if (!built.ok) {
      const state = engineErrorsState(built.errors)
      setErrors(mapErrors(state.fieldErrors ?? {}, payload.index, state.message))
      return
    }
    setErrors({})
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof postOpening>>
      try {
        result = await postOpening(tenantSlug, {
          ...payload.values,
          clientRef,
          previewHash: built.hash,
          warningsAck: accepted,
        })
      } catch {
        setBanner({ tone: 'error', message: ACC_UNREACHABLE.offline })
        return
      }
      if (result.ok) {
        finish(result.message)
        return
      }
      if (result.code === 'needs_confirmation' && result.warnings?.length) {
        setWarnings(result.warnings)
        return
      }
      if (result.code === 'preview_stale') {
        // Cambió algo en la base (un proveedor, una cuenta): se trae el contexto nuevo y se revisa.
        setBanner({ tone: 'info', message: result.message })
        router.refresh()
        return
      }
      const key = typeof result.detail?.key === 'string' ? result.detail.key : null
      if (key === 'opening_exists') {
        setBanner({ tone: 'info', message: result.message })
        router.refresh()
        return
      }
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
        setErrors(mapErrors(result.fieldErrors, payload.index, result.message))
        return
      }
      setBanner({ tone: 'error', message: result.message })
    })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit(acks)
  }

  const skip = () => {
    setConfirmSkip(false)
    setBanner(null)
    startTransition(async () => {
      try {
        const result = await skipOpening(tenantSlug)
        if (result.ok) finish(result.message)
        else setBanner({ tone: 'error', message: result.message })
      } catch {
        setBanner({ tone: 'error', message: ACC_UNREACHABLE.offline })
      }
    })
  }

  const onPartyCreated = (saved: SavedParty) => {
    const target = creating
    setExtraParties((list) => [...list.filter((p) => p.id !== saved.id), partyRefOf(saved)])
    if (target) updateItem(target.list, target.rowId, { partyId: saved.id })
    toast.success(`${saved.name} quedó cargado.`)
    router.refresh()
  }

  // ─── Lo que se ve ──────────────────────────────────────────────────────────
  const err = (key: string) => errors[key] ?? null
  const startDate = formatIsoDay(booksStartDate)
  const { totals, values } = preview
  const busy = pending || done

  // El ticket: las cajas con plata, y aparte lo que se debía de la tarjeta de la empresa.
  const kinds = new Map(treasuries.map((t) => [t.id, t]))
  const boxes = values.treasuries
    .map((t) => ({
      id: t.treasuryAccountId,
      treasury: kinds.get(t.treasuryAccountId),
      cents: t.balanceCents,
    }))
    .filter((t) => t.treasury && t.treasury.kind !== 'credit_card')
    .map((t) => ({ id: t.id, name: t.treasury?.name ?? '', cents: t.cents }))
  const boxesCents = boxes.reduce((sum, b) => sum + b.cents, 0)
  const cards = values.treasuries.filter(
    (t) => kinds.get(t.treasuryAccountId)?.kind === 'credit_card',
  )
  const payablesCents = values.payables.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)
  const receivablesCents = values.receivables.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)
  const youOwed = {
    count: values.payables.length + cards.length,
    cents: payablesCents + cards.reduce((sum, c) => sum + c.balanceCents, 0),
  }
  const owedToYou = { count: values.receivables.length, cents: receivablesCents }
  const forAccountant = (values.shareCapitalCents ?? 0) > 0 || values.others.length > 0
  const anything = values.treasuries.length > 0 || youOwed.count > 0 || owedToYou.count > 0

  const state = (isDone: boolean, otherwise: StepState): StepState => (isDone ? 'done' : otherwise)

  const ticket = (showBooks: boolean) => (
    <OpeningTicket
      startDate={startDate}
      boxes={boxes}
      boxesCents={boxesCents}
      owedToYou={owedToYou}
      youOwed={youOwed}
      totals={totals}
      entries={preview.entries}
      saved={done}
      showBooks={showBooks}
    />
  )

  const itemRows = (list: ItemList) => {
    const rows = form[list]
    const isPayable = list === 'payables'
    return (
      <ul className="grid gap-2.5">
        {rows.map((row) => {
          const id = `op-${row.id}`
          const partyError = err(`${list}.${row.id}.partyId`)
          const amountError = err(`${list}.${row.id}.amountCents`)
          const dueError = err(`${list}.${row.id}.dueDate`)
          const refError = err(`${list}.${row.id}.reference`)
          // Lo que ya tiene dato (o un error) no se esconde.
          const open =
            expanded.has(row.id) ||
            row.dueDate !== null ||
            row.reference.trim() !== '' ||
            Boolean(dueError) ||
            Boolean(refError)
          return (
            <li key={row.id} className="rounded-xl bg-secondary/50 p-3">
              {/* En el celular: quién, y debajo el importe con el tacho al lado (no en un renglón
                  aparte: con doce deudas pegadas eran doce huecos). */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:gap-x-3">
                <Field
                  id={`${id}-party`}
                  label={isPayable ? 'Proveedor' : 'Quién te debía'}
                  error={partyError}
                  className="col-span-2 sm:col-span-1"
                >
                  <PartyCombobox
                    id={`${id}-party`}
                    value={row.partyId}
                    parties={isPayable ? payableOptions : receivableOptions}
                    placeholder={isPayable ? 'Elegí un proveedor' : 'Elegí quién te debía'}
                    invalid={Boolean(partyError)}
                    aria-describedby={describedBy(`${id}-party`, null, partyError)}
                    onValueChange={(partyId) => updateItem(list, row.id, { partyId })}
                    onCreate={(name) =>
                      setCreating({
                        kind: isPayable ? 'supplier' : 'customer',
                        list,
                        rowId: row.id,
                        name,
                      })
                    }
                  />
                </Field>
                <MoneyField
                  id={`${id}-amount`}
                  label="Importe"
                  value={row.amountCents}
                  error={amountError}
                  onValueChange={(cents) => updateItem(list, row.id, { amountCents: cents })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-[1.375rem] size-11 text-muted-foreground hover:text-destructive md:size-10"
                  aria-label={isPayable ? 'Quitar esta deuda' : 'Quitar este renglón'}
                  onClick={() => removeRow(list, row.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {open ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <DateField
                    id={`${id}-due`}
                    label={isPayable ? 'Vence' : 'Se cobra el'}
                    optional
                    shortcuts={false}
                    value={row.dueDate}
                    error={dueError}
                    onValueChange={(iso) => updateItem(list, row.id, { dueDate: iso })}
                  />
                  {isPayable ? (
                    <Field id={`${id}-ref`} label="Comprobante" optional error={refError}>
                      <Input
                        id={`${id}-ref`}
                        value={row.reference}
                        maxLength={60}
                        placeholder="Factura A 0003-00001234"
                        onChange={(e) => updateItem(list, row.id, { reference: e.target.value })}
                        className={INPUT_CLASS}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className={cn(ADD_LINK, 'mt-1')}
                  onClick={() => setExpanded((prev) => new Set(prev).add(row.id))}
                >
                  <Plus className="size-3.5" aria-hidden />
                  {isPayable ? 'vencimiento y comprobante' : 'cuándo se cobra'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="space-y-6">
      {restored ? (
        <Callout
          tone="info"
          action={
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => {
                clearDraft()
                setForm(initialOpeningState({ payable: 'pay_1', receivable: 'rec_1' }))
                setErrors({})
                setRestored(false)
              }}
            >
              Descartar
            </Button>
          }
        >
          Recuperamos lo que estabas cargando.
        </Callout>
      ) : null}

      <form
        ref={formRef}
        onSubmit={onSubmit}
        // Los saldos se guardan con el botón: un Enter suelto en un monto no
        // puede registrar la apertura a medias.
        onKeyDown={(event) => {
          const el = event.target
          if (el instanceof HTMLInputElement && isImplicitSubmit(event.key, el.tagName, el.type)) {
            event.preventDefault()
          }
        }}
        noValidate
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="min-w-0 space-y-4">
            {/* 1 · Las cajas */}
            <StepCard
              open
              n={1}
              title="¿Cuánta plata había en cada caja?"
              state={state(boxes.length > 0 || cards.length > 0, 'current')}
              summary={
                boxes.length > 0
                  ? boxes.map((b) => `${b.name} ${formatCentsShort(b.cents)}`).join(' · ')
                  : `Lo que había al empezar el día ${startDate}. Si una estaba vacía, dejala así.`
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {treasuries.map((t) => {
                  const Icon = WALLET_ICONS[t.kind]
                  return (
                    <div
                      key={t.id}
                      className="flex items-start gap-3 rounded-xl bg-secondary/50 p-3"
                    >
                      <span
                        aria-hidden
                        className="relative mt-6 flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground shadow-2xs"
                      >
                        <Icon className="size-4" />
                        <span
                          className={cn(
                            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
                            treasuryToneSwatch(tones[t.id]),
                          )}
                        />
                      </span>
                      <MoneyField
                        id={`op-t-${t.id}`}
                        fieldClassName="min-w-0 flex-1"
                        label={t.kind === 'credit_card' ? `Lo que debías de ${t.name}` : t.name}
                        hint={TREASURY_HINT[t.kind]}
                        value={form.treasuries[t.id] ?? null}
                        error={err(`treasuries.${t.id}`)}
                        onValueChange={(cents) => setTreasury(t.id, cents)}
                      />
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setAddingTreasury(true)}
                  className="flex min-h-[5.5rem] items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm font-medium outline-none transition-colors hover:border-primary/40 hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-4" aria-hidden />
                  Falta una caja o cuenta
                </button>
              </div>
            </StepCard>

            {/* 2 · Lo que debías */}
            <StepCard
              open
              n={2}
              title="¿A quién le debías?"
              state={state(values.payables.length > 0, 'todo')}
              summary={
                values.payables.length > 0
                  ? countLine(values.payables.length, payablesCents, 'deuda', 'deudas')
                  : loadedSinceStart
                    ? `Lo que debías de antes del ${startDate}. Las compras que ya cargaste desde ese día no van acá: ya están.`
                    : `Las facturas que quedaron sin pagar al ${startDate}. Si no le debías a nadie, dejalo así.`
              }
            >
              <div className="grid gap-3">
                {/* El camino de la planilla va primero: es como tienen las deudas hoy. */}
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2.5 text-sm text-pretty">
                    <ListPlus
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span>
                      <span className="font-medium">¿Las tenés en una planilla?</span>{' '}
                      <span className="text-muted-foreground">
                        Pegá la lista entera: un proveedor y su monto por renglón.
                      </span>
                    </span>
                  </p>
                  <div className="shrink-0 [&>button]:h-11 [&>button]:w-full [&>button]:rounded-full [&>button]:px-4 sm:[&>button]:w-auto">
                    <OpeningImportDialog
                      tenantSlug={tenantSlug}
                      parties={payableParties}
                      room={OPENING_ITEMS_MAX - form.payables.filter((r) => !isBlankItem(r)).length}
                      onImport={importPayables}
                    />
                  </div>
                </div>
                {itemRows('payables')}
                <button
                  type="button"
                  className={ADD_LINK}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      payables: [...f.payables, emptyItemRow(nextId('pay'))],
                    }))
                  }
                >
                  <Plus className="size-3.5" aria-hidden />
                  Agregar de a una
                </button>
                <p className="text-xs text-muted-foreground text-pretty">
                  ¿No está en la lista? Escribí el nombre y elegí «Crear».
                </p>
              </div>
            </StepCard>

            {/* 3 · Lo que te debían */}
            <StepCard
              open
              n={3}
              title="¿Quién te debía?"
              state={state(values.receivables.length > 0, 'todo')}
              summary={
                values.receivables.length > 0
                  ? countLine(
                      values.receivables.length,
                      receivablesCents,
                      'cobro pendiente',
                      'cobros pendientes',
                    )
                  : 'Lo que vendiste con tarjeta o por una app antes de ese día y todavía no te habían depositado, y los clientes con cuenta.'
              }
            >
              <div className="grid gap-3">
                {itemRows('receivables')}
                <button
                  type="button"
                  className={ADD_LINK}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      receivables: [...f.receivables, emptyItemRow(nextId('rec'))],
                    }))
                  }
                >
                  <Plus className="size-3.5" aria-hidden />
                  Agregar otro
                </button>
              </div>
            </StepCard>

            {/* 4 · Para la contadora */}
            <StepCard
              open
              n={4}
              title="Para la contadora (opcional)"
              state={state(forAccountant, 'todo')}
              summary="El capital social y otros saldos. Si no los sabés, dejalo así: los ajusta ella."
            >
              <details
                className="group/acc rounded-xl bg-secondary/50"
                open={
                  forAccountant ||
                  form.others.length > 0 ||
                  Boolean(err('shareCapitalCents')) ||
                  undefined
                }
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-4 text-muted-foreground transition-transform group-open/acc:rotate-90 motion-reduce:transition-none"
                  />
                  Capital social y otros saldos
                </summary>
                <div className="grid gap-4 px-3 pb-3">
                  <MoneyField
                    id="op-capital"
                    label="Capital social"
                    optional
                    value={form.shareCapitalCents}
                    error={err('shareCapitalCents')}
                    hint="Lo dice el estatuto. Si no lo sabés, dejalo vacío: la contadora lo ajusta."
                    onValueChange={(cents) => {
                      setForm((f) => ({ ...f, shareCapitalCents: cents }))
                      clearError('shareCapitalCents', 'form')
                    }}
                    fieldClassName="sm:max-w-xs"
                  />
                  <div className="grid gap-3 border-t border-border/60 pt-3">
                    <div>
                      <p className="text-sm font-medium">Otros saldos</p>
                      <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                        Cualquier otra cuenta con saldo al {startDate}: bienes de uso, préstamos,
                        anticipos.
                      </p>
                    </div>
                    {form.others.length > 0 ? (
                      <ul className="grid gap-2.5">
                        {form.others.map((row) => {
                          const id = `op-${row.id}`
                          const accountError = err(`others.${row.id}.accountId`)
                          return (
                            <li key={row.id} className="grid gap-3 rounded-xl bg-card p-3">
                              <Field id={`${id}-account`} label="Cuenta" error={accountError}>
                                <AccountCombobox
                                  id={`${id}-account`}
                                  value={row.accountId}
                                  accounts={accounts}
                                  filter={(a) => allowedOthers.has(a.id)}
                                  invalid={Boolean(accountError)}
                                  aria-describedby={describedBy(
                                    `${id}-account`,
                                    null,
                                    accountError,
                                  )}
                                  onValueChange={(accountId) => updateOther(row.id, { accountId })}
                                />
                              </Field>
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:gap-x-3">
                                <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                                  <span id={`${id}-side-label`} className="text-sm font-medium">
                                    ¿Lo tenían o lo debían?
                                  </span>
                                  <ChoiceChips<Side>
                                    options={SIDE_OPTIONS}
                                    value={row.side}
                                    labelledBy={`${id}-side-label`}
                                    onChange={(side) => updateOther(row.id, { side })}
                                  />
                                </div>
                                <MoneyField
                                  id={`${id}-amount`}
                                  label="Importe"
                                  value={row.amountCents}
                                  error={err(`others.${row.id}.amountCents`)}
                                  onValueChange={(cents) =>
                                    updateOther(row.id, { amountCents: cents })
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-11 text-muted-foreground hover:text-destructive md:size-10"
                                  aria-label="Quitar este saldo"
                                  onClick={() => removeRow('others', row.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                    <button
                      type="button"
                      className={ADD_LINK}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          others: [...f.others, emptyOtherRow(nextId('oth'))],
                        }))
                      }
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Agregar un saldo
                    </button>
                  </div>
                </div>
              </details>
            </StepCard>

            {/* 5 · Guardar */}
            <StepCard
              open
              n={5}
              id="op-guardar"
              title="Revisá y guardá"
              state={done ? 'done' : anything ? 'current' : 'todo'}
              summary="Se guarda una sola vez: mirá el resumen antes. Después, una caja se corrige con «Contar la caja»."
            >
              <div className="grid gap-4">
                {banner ? <Callout tone={banner.tone}>{banner.message}</Callout> : null}
                {err('form') ? <Callout tone="error">{err('form')}</Callout> : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="submit"
                    className="h-12 min-w-[220px] px-6 text-base"
                    disabled={busy}
                  >
                    {done ? 'Guardado' : pending ? 'Guardando…' : 'Guardar los saldos iniciales'}
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(
                      TEXT_LINK,
                      'text-sm disabled:pointer-events-none disabled:opacity-50',
                    )}
                    onClick={() => setConfirmSkip(true)}
                  >
                    No tengo los números: arrancar todo en cero
                  </button>
                </div>
              </div>
            </StepCard>
          </div>

          {/* En la compu, el ticket acompaña mientras se carga. */}
          <aside className="hidden lg:sticky lg:top-20 lg:block">{ticket(true)}</aside>
        </div>

        {/* Sin lugar para el ticket al costado: el total a la vista y el ticket a un toque. */}
        <div className="sticky bottom-0 z-30 -mx-4 mt-6 -mb-4 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md sm:-mx-6 sm:-mb-8 sm:px-6 lg:hidden">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                En las cajas
              </p>
              <p
                className={cn(
                  'mt-0.5 font-serif leading-none font-semibold tracking-tight whitespace-nowrap',
                  boxesCents >= 100_000_000_00 ? 'text-xl' : 'text-2xl',
                )}
              >
                {boxes.length > 0 ? (
                  <MoneyTicker
                    cents={boxesCents}
                    decimals={boxesCents % 100 === 0 ? 0 : 2}
                    durationMs={380}
                  />
                ) : (
                  <span className="text-muted-foreground">
                    <span aria-hidden>—</span>
                    <span className="sr-only">Todavía sin importes</span>
                  </span>
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 gap-2 rounded-full px-4"
              onClick={() => setTicketOpen(true)}
            >
              <ReceiptText className="size-4" aria-hidden />
              Ver resumen
            </Button>
          </div>
        </div>
      </form>

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
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
            <SheetTitle>Lo que había al {startDate}</SheetTitle>
            <SheetDescription>
              Lo que cargaste hasta ahora. Se guarda con el botón del último paso.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm">{ticket(true)}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Arrancás todo en cero?</AlertDialogTitle>
            <AlertDialogDescription>
              Las cajas y las deudas arrancan en $ 0 y los saldos iniciales ya no se pueden cargar
              después. Si más adelante una caja no coincide, se corrige con «Contar la caja».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {/* Es lo único de la puesta en marcha que no tiene vuelta: va con el tono de lo que
                no se deshace (el mismo de «Sacar acceso»), no como la acción recomendada. */}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={skip}
            >
              Arrancar en cero
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={warnings !== null}
        onOpenChange={(open) => (open ? null : setWarnings(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revisá antes de guardar</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5">
                {(warnings ?? []).map((w) => (
                  <li key={w.key}>{w.message}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = [...new Set([...acks, ...(warnings ?? []).map((w) => w.key)])]
                setAcks(next)
                setWarnings(null)
                submit(next)
              }}
            >
              Guardar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        kind={creating?.kind ?? 'supplier'}
        initialName={creating?.name ?? ''}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        onCreated={onPartyCreated}
      />

      {/* Falta una caja: se agrega acá mismo y aparece su renglón (lo cargado no se pierde). */}
      <TreasuryDialog
        tenantSlug={tenantSlug}
        target={addingTreasury ? ADD_TREASURY : null}
        onClose={() => setAddingTreasury(false)}
        afterCreate="none"
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
