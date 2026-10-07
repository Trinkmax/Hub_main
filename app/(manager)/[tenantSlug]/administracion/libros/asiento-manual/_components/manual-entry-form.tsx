'use client'

import { CircleAlert, CircleCheck, Info, Link2Off, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { DateField, DateInput } from '@/components/administracion/date-input'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postManualEntry } from '@/lib/accounting/actions/documents'
import { engineErrorsState } from '@/lib/accounting/errors'
import { payrollTemplateLines } from '@/lib/accounting/posting/manual'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { ManualEntryValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import { endOfMonth, formatIsoDay, formatMonthYear } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type EntryLine,
  emptyLine,
  entryTotals,
  hasContent,
  type InitialLine,
  type LineField,
  validateEntry,
} from '../_lib/manual-entry'

export type { InitialLine } from '../_lib/manual-entry'

export type ManualKind = 'adjustment' | 'payroll' | 'manual' | 'fy_adjustment'

const FIELD_RE = /^lines\.(\d+)\.(accountId|debitCents|creditCents|partyId|dueDate|memo)$/

const GRID =
  'lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_8.5rem_8.5rem_minmax(0,1.2fr)_9.5rem_2.75rem]'

/**
 * Asiento manual (H.13): tipo, fecha y concepto, y la grilla Cuenta ·
 * Proveedor o cliente · Debe · Haber · Leyenda · Vence que tiene que cuadrar.
 * El pie dice siempre cuánto falta y de qué lado; «Guardar asiento» no se
 * deshabilita: si no cuadra, frena el envío y lleva el foco al pie. Se guarda
 * con el mismo motor que la vista previa (E.7) y deja «Deshacer».
 */
export function ManualEntryForm({
  tenantSlug,
  ctx,
  accounts,
  parties,
  firstOpenDate,
  today,
  fyAdjustment,
  initialKind,
  initialLines,
  corrects,
}: {
  tenantSlug: string
  ctx: PostingContext
  accounts: readonly AccountOption[]
  parties: readonly PartyOption[]
  firstOpenDate: string | null
  today: string
  /** El ajuste de cierre del ejercicio en curso (fecha fija), si ya se puede cargar. */
  fyAdjustment: { endDate: string; label: string } | null
  initialKind: ManualKind
  initialLines: readonly InitialLine[]
  /** «Armar asiento de ajuste» de un comprobante de un mes cerrado. */
  corrects: { id: string; label: string; month: string | null; description: string } | null
}) {
  const router = useRouter()
  const base = `/${tenantSlug}/administracion`
  const formRef = useRef<HTMLFormElement>(null)
  const totalsRef = useRef<HTMLDivElement>(null)
  const counter = useRef(0)
  const newKey = () => {
    counter.current += 1
    return `l${counter.current}`
  }
  const dateId = useId()
  const descriptionId = useId()

  const [kind, setKind] = useState<ManualKind>(initialKind)
  const [date, setDate] = useState<string | null>(
    initialKind === 'fy_adjustment' && fyAdjustment ? fyAdjustment.endDate : today,
  )
  const [description, setDescription] = useState(corrects?.description ?? '')
  const [lines, setLines] = useState<EntryLine[]>(() => {
    const source = initialLines.length > 0 ? initialLines : [emptyLine(), emptyLine()]
    return source.map((l) => ({ ...l, key: newKey() }))
  })
  const [correctsId, setCorrectsId] = useState<string | null>(corrects?.id ?? null)
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  /** Qué línea de la grilla fue cada línea enviada (los errores del servidor vienen por posición). */
  const sentKeys = useRef<string[]>([])

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<ManualEntryValues>({
    tenantSlug,
    action: postManualEntry,
    formRef,
    isKnownField: (key) => key === 'date' || key === 'description' || FIELD_RE.test(key),
    onSaved: (saved) => {
      undoToast(saved.message, saved)
      const documentId = saved.result.documents[0]?.id
      router.push(documentId ? `${base}/comprobantes/${documentId}` : `${base}/libros/diario`)
    },
  })

  // Foco a la línea recién agregada.
  useEffect(() => {
    if (!focusKey) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`cuenta-${focusKey}`)?.focus()
      setFocusKey(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusKey])

  const accountOf = (id: string | null) => (id ? (ctx.accounts.get(id) ?? null) : null)
  const totals = entryTotals(lines)
  const movesVat = lines.some((l) => accountOf(l.accountId)?.systemKey?.startsWith('vat_'))

  const values = useMemo<Omit<ManualEntryValues, 'clientRef' | 'previewHash'>>(
    () => ({
      entryKind: kind,
      date: date ?? '',
      description: description.trim(),
      lines: lines.filter(hasContent).map((l) => ({
        accountId: l.accountId ?? '',
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        partyId: l.partyId,
        dueDate: l.dueDate,
        memo: l.memo.trim() === '' ? null : l.memo.trim(),
      })),
      correctsDocumentId: correctsId,
    }),
    [kind, date, description, lines, correctsId],
  )
  const valuesKey = JSON.stringify(values)

  const gridPreview: EntryPreviewData = {
    documentRef: 'asiento',
    description: values.description,
    date,
    lines: lines
      .filter((l) => l.accountId && ((l.debitCents ?? 0) > 0 || (l.creditCents ?? 0) > 0))
      .map((l) => {
        const account = accountOf(l.accountId)
        const party = l.partyId ? ctx.parties.get(l.partyId) : undefined
        return {
          id: l.key,
          accountCode: account?.code ?? '',
          accountName: account?.name ?? '',
          partyName: party?.name ?? null,
          debitCents: (l.debitCents ?? 0) > 0 ? l.debitCents : null,
          creditCents: (l.debitCents ?? 0) > 0 ? null : l.creditCents,
          note: l.memo.trim() || null,
        }
      }),
  }
  const override = posting.overrideFor(valuesKey)

  /** El error de un campo: el local (al guardar) o el del servidor (por posición). */
  function errorOf(lineKey: string, field: LineField): string | undefined {
    const local = localErrors[`${lineKey}.${field}`]
    if (local) return local
    const index = sentKeys.current.indexOf(lineKey)
    return index === -1 ? undefined : posting.fieldErrors[`lines.${index}.${field}`]
  }

  function clearError(lineKey: string, field: LineField) {
    setLocalErrors((prev) => {
      const key = `${lineKey}.${field}`
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    const index = sentKeys.current.indexOf(lineKey)
    if (index !== -1) posting.clearFieldError(`lines.${index}.${field}`)
  }

  function updateLine(key: string, patch: Partial<EntryLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    for (const field of Object.keys(patch) as LineField[]) clearError(key, field)
    if ('debitCents' in patch || 'creditCents' in patch) {
      setLocalErrors((prev) => {
        if (!prev.lines) return prev
        const next = { ...prev }
        delete next.lines
        return next
      })
    }
  }

  function addLine() {
    const key = newKey()
    setLines((prev) => [...prev, { ...emptyLine(), key }])
    setFocusKey(key)
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)))
  }

  function changeKind(next: ManualKind) {
    setKind(next)
    if (next === 'fy_adjustment' && fyAdjustment) setDate(fyAdjustment.endDate)
    else if (kind === 'fy_adjustment') setDate(today)
  }

  function focusFirstProblem(onlyBalance: boolean) {
    requestAnimationFrame(() => {
      if (onlyBalance) {
        totalsRef.current?.focus()
        return
      }
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
  }

  function submit() {
    const check = validateEntry({
      lines,
      date,
      description,
      requiresParty: (id) => accountOf(id)?.requiresParty ?? false,
    })
    if (!check.ok) {
      setLocalErrors(check.errors)
      posting.setBanner({ tone: 'error', message: check.message })
      focusFirstProblem(check.onlyBalance)
      return
    }
    setLocalErrors({})
    const keys = lines.filter(hasContent).map((l) => l.key)
    const preview = previewDocumentForm('manual_entry', values, ctx, {
      // El ajuste de cierre va al período de ajustes del ejercicio, no a un mes.
      firstOpenDate: kind === 'fy_adjustment' ? null : firstOpenDate,
    })
    if (!preview.ok) {
      const mapped: Record<string, string> = {}
      for (const [path, message] of Object.entries(preview.fieldErrors ?? {})) {
        const match = FIELD_RE.exec(path)
        const lineKey = match ? keys[Number(match[1])] : undefined
        if (match && lineKey) mapped[`${lineKey}.${match[2]}`] = message
        else if (path === 'date' || path === 'accountingDate') mapped.date = message
        else if (path === 'description') mapped.description = message
        else if (path === 'lines') mapped.lines = message
      }
      setLocalErrors(mapped)
      posting.setBanner({ tone: 'error', message: preview.message })
      focusFirstProblem(Object.keys(mapped).length === 1 && 'lines' in mapped)
      return
    }
    sentKeys.current = keys
    posting.submit(values, { hash: preview.hash, warnings: preview.warnings }, valuesKey)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!posting.pending) submit()
  }

  /** ⌘↵ guarda; Enter en un campo pasa al siguiente (en la última leyenda, agrega una línea). */
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      if (!posting.pending) submit()
      return
    }
    if (target.tagName !== 'INPUT') return
    event.preventDefault()
    const lastKey = lines.at(-1)?.key
    if (target.dataset.lastMemo === 'true' && target.dataset.line === lastKey) {
      addLine()
      return
    }
    const fields = Array.from(
      formRef.current?.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), button[role="combobox"]:not([disabled])',
      ) ?? [],
    )
    const at = fields.indexOf(target)
    fields[at + 1]?.focus()
  }

  const dateError = localErrors.date ?? posting.fieldErrors.date ?? null
  const descriptionError = localErrors.description ?? posting.fieldErrors.description ?? null
  const linesError = localErrors.lines ?? posting.fieldErrors.lines ?? null
  const kindOptions = [
    { value: 'adjustment' as const, label: 'Ajuste' },
    { value: 'payroll' as const, label: 'Sueldos' },
    { value: 'manual' as const, label: 'Otro' },
    ...(fyAdjustment
      ? [{ value: 'fy_adjustment' as const, label: 'Ajuste de cierre de ejercicio' }]
      : []),
  ]

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      className="card-hairline grid gap-6 rounded-xl border bg-card p-4 sm:p-6"
    >
      <div className="grid gap-2">
        <Label id={`${dateId}-tipo`}>Tipo de asiento</Label>
        <ChoiceChips
          options={kindOptions}
          value={kind}
          onChange={changeKind}
          labelledBy={`${dateId}-tipo`}
        />
        {kind === 'fy_adjustment' ? (
          <p className="text-xs text-muted-foreground">
            Para amortizaciones, existencias y reclasificaciones de la contadora. Va con fecha del
            último día del ejercicio, al período de ajustes.
          </p>
        ) : null}
      </div>

      {kind === 'payroll' ? (
        <PayrollTemplate
          ctx={ctx}
          date={date ?? today}
          replaces={lines.some(hasContent)}
          onApply={(templateLines) => {
            setLines(templateLines.map((l) => ({ ...l, key: newKey() })))
            setLocalErrors({})
            if (!description.trim()) setDescription(`Sueldos de ${formatMonthYear(date ?? today)}`)
          }}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
        {kind === 'fy_adjustment' && fyAdjustment ? (
          <div className="grid content-start gap-1.5">
            <Label htmlFor={dateId}>Fecha</Label>
            <Input
              id={dateId}
              value={formatIsoDay(fyAdjustment.endDate)}
              readOnly
              aria-describedby={`${dateId}-hint`}
              className="h-11 text-base md:h-10 md:text-sm"
            />
            <p id={`${dateId}-hint`} className="text-xs text-muted-foreground">
              Fin del ejercicio ({fyAdjustment.label}).
            </p>
          </div>
        ) : (
          <DateField
            id={dateId}
            label="Fecha"
            required
            value={date}
            onValueChange={(v) => {
              setDate(v)
              setLocalErrors((prev) => {
                if (!prev.date) return prev
                const next = { ...prev }
                delete next.date
                return next
              })
              posting.clearFieldError('date')
            }}
            min={firstOpenDate ?? ctx.settings.booksStartDate}
            max={endOfMonth(today)}
            today={today}
            error={dateError}
            hint={
              firstOpenDate
                ? `Desde el ${formatIsoDay(firstOpenDate)}: lo de un mes cerrado se ajusta en un mes abierto.`
                : undefined
            }
          />
        )}
        <div className="grid content-start gap-1.5">
          <Label htmlFor={descriptionId}>
            Concepto
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          </Label>
          <Input
            id={descriptionId}
            value={description}
            maxLength={200}
            placeholder="Por ejemplo: amortización de equipos de octubre"
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
            onChange={(e) => {
              setDescription(e.target.value)
              setLocalErrors((prev) => {
                if (!prev.description) return prev
                const next = { ...prev }
                delete next.description
                return next
              })
              posting.clearFieldError('description')
            }}
            className="h-11 text-base md:h-10 md:text-sm"
          />
          {descriptionError ? (
            <p id={`${descriptionId}-error`} role="alert" className="text-xs text-destructive">
              {descriptionError}
            </p>
          ) : null}
        </div>
      </div>

      {corrects && correctsId ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2 text-pretty">
            <p>
              <span className="font-medium">Corrige {corrects.label}</span>
              {corrects.month ? ` (${corrects.month}, cerrado)` : ''}. Las líneas son las de ese
              comprobante al revés: dejá solo lo que haya que corregir.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 md:h-8"
              onClick={() => setCorrectsId(null)}
            >
              <Link2Off className="size-3.5" aria-hidden />
              No vincularlo
            </Button>
          </div>
        </div>
      ) : null}

      <section aria-labelledby={`${dateId}-lineas`} className="grid gap-3">
        <h2 id={`${dateId}-lineas`} className="font-serif text-lg font-semibold tracking-tight">
          Líneas
        </h2>
        <div
          aria-hidden
          className={cn(
            'hidden gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid',
            GRID,
          )}
        >
          <span>Cuenta</span>
          <span>Proveedor o cliente</span>
          <span className="text-right">Debe</span>
          <span className="text-right">Haber</span>
          <span>Leyenda</span>
          <span>Vence</span>
          <span />
        </div>
        <ol className="grid gap-3 lg:gap-1.5">
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              line={line}
              index={index}
              isLast={index === lines.length - 1}
              canRemove={lines.length > 2}
              requiresParty={accountOf(line.accountId)?.requiresParty ?? false}
              accounts={accounts}
              parties={parties}
              today={today}
              errorOf={(field) => errorOf(line.key, field)}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </ol>
        <div>
          <Button type="button" variant="outline" className="h-11 gap-2 md:h-9" onClick={addLine}>
            <Plus className="size-4" aria-hidden />
            Agregar línea
          </Button>
        </div>

        <TotalsBar ref={totalsRef} debit={totals.debit} credit={totals.credit} error={linesError} />
      </section>

      {movesVat ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-pretty">
            Este asiento mueve IVA, pero no entra al Libro IVA: ahí van solo los comprobantes.
          </p>
        </div>
      ) : null}

      <EntryPreview
        entries={override ?? [gridPreview]}
        emptyText="Elegí las cuentas y cargá los importes para ver el asiento."
      />

      <FormBanner banner={posting.banner} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p className="hidden text-xs text-muted-foreground lg:block">⌘↵ para guardar</p>
        <Button
          type="submit"
          disabled={posting.pending}
          className="h-11 min-w-[160px] gap-2 md:h-10"
        >
          {posting.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {posting.pending ? 'Guardando…' : 'Guardar asiento'}
        </Button>
      </div>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </form>
  )
}

function LineRow({
  line,
  index,
  isLast,
  canRemove,
  requiresParty,
  accounts,
  parties,
  today,
  errorOf,
  onChange,
  onRemove,
}: {
  line: EntryLine
  index: number
  isLast: boolean
  canRemove: boolean
  requiresParty: boolean
  accounts: readonly AccountOption[]
  parties: readonly PartyOption[]
  today: string
  errorOf: (field: LineField) => string | undefined
  onChange: (patch: Partial<EntryLine>) => void
  onRemove: () => void
}) {
  const n = index + 1
  const ids = {
    account: `cuenta-${line.key}`,
    party: `participe-${line.key}`,
    debit: `debe-${line.key}`,
    credit: `haber-${line.key}`,
    memo: `leyenda-${line.key}`,
    due: `vence-${line.key}`,
  }
  const errors = {
    accountId: errorOf('accountId'),
    partyId: errorOf('partyId'),
    debitCents: errorOf('debitCents'),
    creditCents: errorOf('creditCents'),
    memo: errorOf('memo'),
    dueDate: errorOf('dueDate'),
  }
  const messages = Array.from(new Set(Object.values(errors).filter(Boolean)))
  const labelClass = 'text-xs text-muted-foreground lg:sr-only'

  return (
    <li
      className={cn(
        'grid grid-cols-2 gap-2 rounded-lg border border-border/60 p-3 lg:items-start lg:rounded-none lg:border-0 lg:p-0',
        GRID,
      )}
    >
      <div className="col-span-2 grid gap-1 lg:col-span-1">
        <Label htmlFor={ids.account} className={labelClass}>
          Cuenta de la línea {n}
        </Label>
        <AccountCombobox
          id={ids.account}
          accounts={accounts}
          value={line.accountId}
          invalid={Boolean(errors.accountId)}
          onValueChange={(id, account) => {
            const next = account && id ? id : null
            onChange({ accountId: next, partyId: null, dueDate: null })
          }}
        />
      </div>

      {requiresParty ? (
        <div className="col-span-2 grid gap-1 lg:col-span-1">
          <Label htmlFor={ids.party} className={labelClass}>
            Proveedor o cliente de la línea {n}
          </Label>
          <PartyCombobox
            id={ids.party}
            parties={parties}
            value={line.partyId}
            placeholder="Elegí quién"
            invalid={Boolean(errors.partyId)}
            onValueChange={(id) => onChange({ partyId: id })}
          />
        </div>
      ) : (
        <span aria-hidden className="hidden lg:block" />
      )}

      <div className="grid gap-1">
        <Label htmlFor={ids.debit} className={labelClass}>
          Debe de la línea {n}
        </Label>
        <MoneyInput
          id={ids.debit}
          value={line.debitCents}
          align="end"
          invalid={Boolean(errors.debitCents)}
          onValueChange={(cents) =>
            onChange(
              cents !== null && cents > 0
                ? { debitCents: cents, creditCents: null }
                : { debitCents: cents },
            )
          }
        />
      </div>

      <div className="grid gap-1">
        <Label htmlFor={ids.credit} className={labelClass}>
          Haber de la línea {n}
        </Label>
        <MoneyInput
          id={ids.credit}
          value={line.creditCents}
          align="end"
          invalid={Boolean(errors.creditCents)}
          onValueChange={(cents) =>
            onChange(
              cents !== null && cents > 0
                ? { creditCents: cents, debitCents: null }
                : { creditCents: cents },
            )
          }
        />
      </div>

      <div className="col-span-2 grid gap-1 lg:col-span-1">
        <Label htmlFor={ids.memo} className={labelClass}>
          Leyenda de la línea {n}
        </Label>
        <Input
          id={ids.memo}
          value={line.memo}
          maxLength={200}
          placeholder="Opcional"
          data-line={line.key}
          data-last-memo={isLast ? 'true' : undefined}
          aria-invalid={errors.memo ? true : undefined}
          onChange={(e) => onChange({ memo: e.target.value })}
          className="h-11 text-base md:h-10 md:text-sm"
        />
      </div>

      {requiresParty ? (
        <div className="col-span-2 grid gap-1 lg:col-span-1">
          <Label htmlFor={ids.due} className={labelClass}>
            Vence (línea {n})
          </Label>
          <DateInput
            id={ids.due}
            value={line.dueDate}
            onValueChange={(iso) => onChange({ dueDate: iso })}
            shortcuts={false}
            today={today}
            invalid={Boolean(errors.dueDate)}
          />
        </div>
      ) : (
        <span aria-hidden className="hidden lg:block" />
      )}

      <div className="col-span-2 flex justify-end lg:col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground md:size-10"
          aria-label={`Quitar la línea ${n}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {messages.length > 0 ? (
        <p role="alert" className="col-span-2 text-xs text-destructive lg:col-span-7">
          {messages.join(' ')}
        </p>
      ) : null}
    </li>
  )
}

/** El pie de la grilla: Debe, Haber y cuánto falta (o «Cuadra»). Se le da foco si no cuadra. */
function TotalsBar({
  ref,
  debit,
  credit,
  error,
}: {
  ref: Ref<HTMLDivElement>
  debit: bigint
  credit: bigint
  error: string | null
}) {
  const diff = debit - credit
  const empty = debit === 0n && credit === 0n
  const balanced = !empty && diff === 0n
  const gap = diff < 0n ? -diff : diff
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn(
        'sticky bottom-0 z-10 -mx-4 flex flex-col gap-1 border-t border-border/60 bg-card/95 px-4 py-3 outline-none backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6',
        'focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <p className="text-sm tabular-nums">
        <span className="text-muted-foreground">Debe</span>{' '}
        <span className="font-medium">{formatCents(debit)}</span>
        <span className="mx-2 text-muted-foreground">·</span>
        <span className="text-muted-foreground">Haber</span>{' '}
        <span className="font-medium">{formatCents(credit)}</span>
      </p>
      <div className="space-y-0.5 sm:text-right">
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'inline-flex items-center gap-1.5 text-sm font-medium',
            balanced ? 'text-success' : empty ? 'text-muted-foreground' : 'text-warning-text',
          )}
        >
          {balanced ? (
            <CircleCheck className="size-4" aria-hidden />
          ) : empty ? null : (
            <CircleAlert className="size-4" aria-hidden />
          )}
          {balanced
            ? 'Cuadra'
            : empty
              ? 'Cargá los importes'
              : `Falta ${formatCents(gap)} en el ${diff > 0n ? 'Haber' : 'Debe'}`}
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * «Sueldos del mes» (E13): con los tres números del resumen de la contadora
 * arma las líneas (sueldos y contribuciones al Debe; neto a pagar, cargas
 * sociales y sindicato al Haber). Después se pueden tocar en la grilla.
 */
function PayrollTemplate({
  ctx,
  date,
  replaces,
  onApply,
}: {
  ctx: PostingContext
  date: string
  replaces: boolean
  onApply: (lines: InitialLine[]) => void
}) {
  const [gross, setGross] = useState<number | null>(null)
  const [contributions, setContributions] = useState<number | null>(null)
  const [withheld, setWithheld] = useState<number | null>(null)
  const [union, setUnion] = useState<number | null>(null)
  const [salariesDue, setSalariesDue] = useState<string | null>(null)
  const [socialDue, setSocialDue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function apply() {
    if (gross === null || gross <= 0) {
      setError('Cargá los sueldos brutos del mes.')
      return
    }
    if (contributions === null || withheld === null) {
      setError('Cargá las contribuciones patronales y los aportes (pueden ser cero).')
      return
    }
    const built = payrollTemplateLines(
      {
        grossSalariesCents: gross,
        employerContributionsCents: contributions,
        withheldContributionsCents: withheld,
        unionDuesCents: union ?? 0,
        date,
        salariesDueDate: salariesDue,
        socialSecurityDueDate: socialDue,
      },
      ctx,
    )
    if (!built.ok) {
      setError(engineErrorsState(built.errors).message)
      return
    }
    setError(null)
    onApply(
      built.lines.map((l) => ({
        accountId: l.accountId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        partyId: l.partyId,
        dueDate: l.dueDate,
        memo: l.memo ?? '',
      })),
    )
  }

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-secondary/20 p-4">
      <div className="space-y-0.5">
        <h2 className="font-serif text-lg font-semibold tracking-tight">Sueldos del mes</h2>
        <p className="text-xs text-muted-foreground">
          Con los números del resumen de la contadora armamos las líneas. Después las podés tocar.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label="Sueldos brutos"
          value={gross}
          onValueChange={(c) => setGross(c)}
          required
        />
        <MoneyField
          label="Contribuciones patronales"
          value={contributions}
          onValueChange={(c) => setContributions(c)}
          required
        />
        <MoneyField
          label="Aportes retenidos"
          hint="Lo que se descuenta del recibo (jubilación, obra social, PAMI)."
          value={withheld}
          onValueChange={(c) => setWithheld(c)}
          required
        />
        <MoneyField
          label="Cuota sindical"
          optional
          value={union}
          onValueChange={(c) => setUnion(c)}
        />
        <DateField
          label="Vencen los sueldos"
          optional
          value={salariesDue}
          onValueChange={setSalariesDue}
          shortcuts={false}
        />
        <DateField
          label="Vencen las cargas sociales"
          optional
          value={socialDue}
          onValueChange={setSocialDue}
          shortcuts={false}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={apply}>
          {replaces ? 'Reemplazar las líneas' : 'Armar las líneas'}
        </Button>
      </div>
    </section>
  )
}
