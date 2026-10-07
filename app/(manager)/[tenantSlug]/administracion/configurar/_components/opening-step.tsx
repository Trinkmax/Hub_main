'use client'

import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { newClientRef } from '@/components/administracion/cajas-ventas/client-ref'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
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
import { ACC_UNREACHABLE, issuePath } from '@/lib/accounting/action-state'
import type { SavedParty } from '@/lib/accounting/actions/master'
import { postOpening, skipOpening } from '@/lib/accounting/actions/setup'
import { engineErrorsState, type WarningCopy } from '@/lib/accounting/errors'
import { buildOpening } from '@/lib/accounting/posting/opening'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { openingSchema } from '@/lib/accounting/schemas'
import type {
  EntryPreview as EntryPreviewModel,
  PartyKind,
  PartyRef,
  PostingContext,
  Side,
  WarningKey,
} from '@/lib/accounting/types'
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { INPUT_CLASS } from '../../ajustes/_components/inputs'
import {
  emptyItemRow,
  emptyOtherRow,
  hasAnyOpeningValue,
  initialOpeningState,
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
import { NewPartyDialog, type NewPartyKind } from './new-party-dialog'
import { SetupDone } from './setup-done'
import { WizardProgress } from './wizard-progress'

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

const SIDE_OPTIONS = [
  { value: 'debit' as const, label: 'Debe (lo tienen)' },
  { value: 'credit' as const, label: 'Haber (lo deben)' },
]

type Banner = { tone: 'error' | 'info'; message: string }

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

/**
 * Paso 3 de la puesta en marcha (H.3): los saldos al primer día de los libros
 * → asiento de apertura (`postOpening`), o «Arrancar en cero»
 * (`skipOpening`). La vista previa la arma el mismo motor que la acción, con
 * el contexto que trajo la página.
 */
export function OpeningStep({
  tenantSlug,
  booksStartDate,
  firstMonthName,
  treasuries,
  ctx,
  accounts,
  otherAccountIds,
}: {
  tenantSlug: string
  booksStartDate: string
  /** «octubre»: el mes que tiene que seguir abierto para cargar la apertura después. */
  firstMonthName: string
  treasuries: OpeningTreasury[]
  ctx: PostingContext
  /** El plan entero (para las rutas del combo de «Otros saldos»). */
  accounts: AccountOption[]
  /** Las cuentas que se pueden usar en «Otros saldos». */
  otherAccountIds: string[]
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
  const [othersOpen, setOthersOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  const [done, setDone] = useState(false)
  const [extraParties, setExtraParties] = useState<PartyRef[]>([])
  const [creating, setCreating] = useState<{
    kind: NewPartyKind
    list: 'payables' | 'receivables'
    rowId: string
    name: string
  } | null>(null)
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
  const payableOptions = useMemo(
    () => allParties.filter((p) => PAYABLE_KINDS.has(p.kind)).map(partyOption),
    [allParties],
  )
  const receivableOptions = useMemo(
    () => allParties.filter((p) => RECEIVABLE_KINDS.has(p.kind)).map(partyOption),
    [allParties],
  )
  const allowedOthers = useMemo(() => new Set(otherAccountIds), [otherAccountIds])

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
    return { entries, totals }
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
  const updateItem = (
    list: 'payables' | 'receivables',
    id: string,
    patch: Partial<OpeningItemRow>,
  ) => {
    setForm((f) => ({ ...f, [list]: f[list].map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    clearError(...Object.keys(patch).map((k) => `${list}.${id}.${k}`), 'form')
  }
  const updateOther = (id: string, patch: Partial<OpeningOtherRow>) => {
    setForm((f) => ({ ...f, others: f.others.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    clearError(...Object.keys(patch).map((k) => `others.${id}.${k}`), 'form')
  }
  const removeRow = (list: 'payables' | 'receivables' | 'others', id: string) =>
    setForm((f) => ({ ...f, [list]: f[list].filter((r) => r.id !== id) }))

  // ─── Guardar ───────────────────────────────────────────────────────────────
  const finish = (message: string) => {
    clearDraft()
    toast.success(message)
    setDone(true)
    router.refresh()
  }

  const submit = (accepted: WarningKey[]) => {
    if (pending) return
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

  if (done) return <SetupDone tenantSlug={tenantSlug} />

  const err = (key: string) => errors[key] ?? null
  const startDate = formatIsoDay(booksStartDate)
  const { totals } = preview

  const itemRows = (list: 'payables' | 'receivables') => {
    const rows = form[list]
    const isPayable = list === 'payables'
    return (
      <ul className="space-y-3">
        {rows.map((row) => {
          const id = `op-${row.id}`
          const partyError = err(`${list}.${row.id}.partyId`)
          const amountError = err(`${list}.${row.id}.amountCents`)
          const dueError = err(`${list}.${row.id}.dueDate`)
          return (
            <li
              key={row.id}
              className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <Field
                  id={`${id}-party`}
                  label={isPayable ? 'Proveedor' : 'Quién te debía'}
                  error={partyError}
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
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
                  <Field
                    id={`${id}-ref`}
                    label="Comprobante"
                    optional
                    error={err(`${list}.${row.id}.reference`)}
                  >
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
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 text-muted-foreground hover:text-destructive md:h-8"
                  onClick={() => removeRow(list, row.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Quitar
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="space-y-6">
      <WizardProgress current={2} />
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

      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6">
        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">
              Plata en cada caja y cuenta
            </h2>
            <p className="text-xs text-muted-foreground text-pretty">
              Lo que había al empezar el día {startDate}. Mirá la app o el resumen del banco. Si una
              está vacía, dejala así.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            {treasuries.map((t) => (
              <MoneyField
                key={t.id}
                id={`op-t-${t.id}`}
                label={t.kind === 'credit_card' ? `Deuda de ${t.name}` : t.name}
                optional
                value={form.treasuries[t.id] ?? null}
                error={err(`treasuries.${t.id}`)}
                onValueChange={(cents) => setTreasury(t.id, cents)}
              />
            ))}
          </div>
        </section>

        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">
              Deudas con proveedores
            </h2>
            <p className="text-xs text-muted-foreground text-pretty">
              Facturas que quedaron sin pagar al {startDate}. ¿No está en la lista? Escribí el
              nombre y elegí «Crear».
            </p>
          </header>
          {itemRows('payables')}
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-9"
            onClick={() =>
              setForm((f) => ({ ...f, payables: [...f.payables, emptyItemRow(nextId('pay'))] }))
            }
          >
            <Plus className="size-4" aria-hidden />
            Agregar otra deuda
          </Button>
        </section>

        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Lo que te debían</h2>
            <p className="text-xs text-muted-foreground text-pretty">
              Ventas con tarjeta o por plataformas que todavía no se acreditaron, y clientes que
              debían.
            </p>
          </header>
          {itemRows('receivables')}
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-9"
            onClick={() =>
              setForm((f) => ({
                ...f,
                receivables: [...f.receivables, emptyItemRow(nextId('rec'))],
              }))
            }
          >
            <Plus className="size-4" aria-hidden />
            Agregar otro
          </Button>
        </section>

        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
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

          <div className="rounded-lg border border-border/60">
            <button
              type="button"
              aria-expanded={othersOpen}
              aria-controls="op-others"
              onClick={() => setOthersOpen((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>
                Otros saldos{' '}
                <span className="font-normal text-muted-foreground">(para la contadora)</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  othersOpen && 'rotate-180',
                )}
              />
            </button>
            <div
              id="op-others"
              hidden={!othersOpen}
              className="space-y-3 border-t border-border/60 p-4"
            >
              <p className="text-xs text-muted-foreground">
                Cualquier otra cuenta con saldo al {startDate}: bienes de uso, préstamos, anticipos.
              </p>
              {form.others.length > 0 ? (
                <ul className="space-y-3">
                  {form.others.map((row) => {
                    const id = `op-${row.id}`
                    const accountError = err(`others.${row.id}.accountId`)
                    return (
                      <li
                        key={row.id}
                        className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3"
                      >
                        <Field id={`${id}-account`} label="Cuenta" error={accountError}>
                          <AccountCombobox
                            id={`${id}-account`}
                            value={row.accountId}
                            accounts={accounts}
                            filter={(a) => allowedOthers.has(a.id)}
                            invalid={Boolean(accountError)}
                            aria-describedby={describedBy(`${id}-account`, null, accountError)}
                            onValueChange={(accountId) => updateOther(row.id, { accountId })}
                          />
                        </Field>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
                          <div className="grid gap-1.5">
                            <span id={`${id}-side-label`} className="text-sm font-medium">
                              Lado
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
                            onValueChange={(cents) => updateOther(row.id, { amountCents: cents })}
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-11 gap-1.5 text-muted-foreground hover:text-destructive md:h-8"
                            onClick={() => removeRow('others', row.id)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Quitar
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 md:h-9"
                onClick={() =>
                  setForm((f) => ({ ...f, others: [...f.others, emptyOtherRow(nextId('oth'))] }))
                }
              >
                <Plus className="size-4" aria-hidden />
                Agregar saldo
              </Button>
            </div>
          </div>
        </section>

        <section
          className="card-hairline space-y-3 rounded-xl border bg-card p-6"
          aria-live="polite"
        >
          <h2 className="font-serif text-lg font-semibold tracking-tight">Patrimonio inicial</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Lo que tienen</dt>
              <dd className="tabular-nums">{formatCents(totals.assetsCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Lo que deben</dt>
              <dd className="tabular-nums">{formatCents(totals.liabilitiesCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border/60 pt-2 font-medium">
              <dt>
                {totals.equityCents < 0 ? 'Patrimonio inicial negativo' : 'Patrimonio inicial'}
              </dt>
              <dd className="tabular-nums">{formatCents(Math.abs(totals.equityCents))}</dd>
            </div>
            {totals.capitalCents > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Capital social</dt>
                <dd className="tabular-nums">{formatCents(totals.capitalCents)}</dd>
              </div>
            ) : null}
          </dl>
          {totals.unassignedCents !== 0 ? (
            <p className="text-xs text-muted-foreground text-pretty">
              {formatCents(Math.abs(totals.unassignedCents))} quedan en «Saldo de apertura a
              asignar»: la contadora los pasa a capital o a resultados.
            </p>
          ) : null}
        </section>

        <EntryPreview
          entries={preview.entries}
          emptyText="Cargá algún saldo para ver el asiento de apertura."
        />

        {banner ? <Callout tone={banner.tone}>{banner.message}</Callout> : null}
        {err('form') ? <Callout tone="error">{err('form')}</Callout> : null}

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-border/60 bg-background/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={pending}
            onClick={() => setConfirmSkip(true)}
          >
            Arrancar en cero
          </Button>
          <Button type="submit" className="h-11 min-w-[180px] md:h-9" disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar saldos iniciales'}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Arrancás en cero?</AlertDialogTitle>
            <AlertDialogDescription>
              No vas a cargar saldos iniciales. Podés hacerlo después mientras {firstMonthName} siga
              abierto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={skip}>Arrancar en cero</AlertDialogAction>
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
    </div>
  )
}
