'use client'

import { CircleAlert, CircleCheck, Info, Link2Off, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
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
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postManualEntry } from '@/lib/accounting/actions/documents'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { ManualEntryValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import { endOfMonth, formatIsoDay } from '@/lib/dates'
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
import {
  EMPTY_PAYROLL,
  type PayrollBuild,
  type PayrollField,
  type PayrollInputs,
  PayrollSteps,
  payrollBuild,
  payrollDescription,
} from './payroll-steps'

export type { InitialLine } from '../_lib/manual-entry'

export type ManualKind = 'adjustment' | 'payroll' | 'manual' | 'fy_adjustment'

const FIELD_RE = /^lines\.(\d+)\.(accountId|debitCents|creditCents|partyId|dueDate|memo)$/

/** La grilla entera: Cuenta · Proveedor o cliente · Debe · Haber · Leyenda · Vence · quitar. */
const GRID =
  'lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_8.5rem_8.5rem_minmax(0,1.2fr)_9.5rem_2.75rem]'
/**
 * Sin «Proveedor o cliente» ni «Vence»: mientras ninguna línea usa una cuenta que los pida, esas
 * dos columnas no se dibujan (eran dos títulos sin ningún control debajo) y su lugar es de la
 * leyenda. Aparecen solas al elegir una cuenta de control.
 */
const GRID_SLIM = 'lg:grid-cols-[minmax(0,2.2fr)_8.5rem_8.5rem_minmax(0,2.2fr)_2.75rem]'

const HELP =
  'Usalo para ajustes y para lo que te dicta la contadora. Lo del día a día se carga desde Compras, Ventas y Cajas; para pagar sueldos o impuestos usá «Pagar».'

const PAYROLL_HELP =
  'Copiá los números del resumen que te manda tu contadora. Queda como deuda con el personal y con los organismos; después los pagás con «Pagar».'

/** Lo que va en `?tipo=` para cada tipo de asiento (el mismo contrato que lee la página). */
const KIND_PARAM: Readonly<Record<ManualKind, string | null>> = {
  adjustment: null,
  payroll: 'sueldos',
  manual: 'otro',
  fy_adjustment: 'ajuste-cierre',
}

/**
 * `?tipo=` en la URL sin pedir la página de nuevo: cambiar de tipo no pierde lo cargado.
 *
 * Va con `null` (no con `window.history.state`): así Next se entera del cambio y lo conserva. Con
 * el estado de Next adentro (`__NA`) lo toma como propio y no lo anota: la barra cambiaba, pero en
 * el próximo movimiento del router (abrir una hoja, un `refresh()`) volvía el `?tipo=` de antes.
 */
function syncKindParam(kind: ManualKind) {
  try {
    const url = new URL(window.location.href)
    const value = KIND_PARAM[kind]
    if (value) url.searchParams.set('tipo', value)
    else url.searchParams.delete('tipo')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // Sin History API: el formulario funciona igual, solo no queda en la URL.
  }
}

/**
 * Lo que el formulario manda (sin `clientRef` ni `previewHash`, que agrega
 * `usePosting`). Puro: lo usa el formulario y lo comparan los tests, para que el
 * camino de «Sueldos del mes» mande exactamente lo mismo que la grilla.
 */
export function manualEntryValues(input: {
  kind: ManualKind
  date: string | null
  description: string
  lines: readonly InitialLine[]
  correctsId: string | null
}): Omit<ManualEntryValues, 'clientRef' | 'previewHash'> {
  return {
    entryKind: input.kind,
    date: input.date ?? '',
    description: input.description.trim(),
    lines: input.lines.filter(hasContent).map((l) => ({
      accountId: l.accountId ?? '',
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      partyId: l.partyId,
      dueDate: l.dueDate,
      memo: l.memo.trim() === '' ? null : l.memo.trim(),
    })),
    correctsDocumentId: input.correctsId,
  }
}

/**
 * Asiento manual (H.13) y «Sueldos del mes»: un solo formulario con dos caras.
 *
 * - **Asiento manual** (lo que dicta la contadora): tipo, fecha y concepto, y la
 *   grilla Cuenta · Proveedor o cliente · Debe · Haber · Leyenda · Vence que
 *   tiene que cuadrar. El pie dice siempre cuánto falta y de qué lado; «Guardar
 *   asiento» no se deshabilita: si no cuadra, frena el envío y lleva el foco al
 *   pie.
 * - **Sueldos del mes** (`?tipo=sueldos`, para el dueño): los mismos datos en
 *   tres pasos, con un ticket que se arma solo (`PayrollSteps`). Las líneas se
 *   rearman con cada dato hasta que se abre «Editar las líneas a mano».
 *
 * En los dos casos se guarda con el mismo motor que la vista previa (E.7), con
 * la misma acción y el mismo envío, y deja «Deshacer». El tipo vive en la URL
 * (`?tipo=`) sin recargar: cambiarlo no pierde lo cargado.
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
  backHref,
  notice,
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
  /** A dónde vuelve el «‹ Libros» del encabezado. */
  backHref: string
  /** Un aviso de la página, arriba del formulario (un `?corrige=` que no se puede ajustar). */
  notice?: ReactNode
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
  // Mientras no lo toquen, el concepto de los sueldos se completa solo y sigue a la fecha.
  const [descriptionTouched, setDescriptionTouched] = useState(Boolean(corrects?.description))
  const [lines, setLines] = useState<EntryLine[]>(() => {
    const source = initialLines.length > 0 ? initialLines : [emptyLine(), emptyLine()]
    return source.map((l) => ({ ...l, key: newKey() }))
  })
  const [correctsId, setCorrectsId] = useState<string | null>(corrects?.id ?? null)
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  /** Qué línea de la grilla fue cada línea enviada (los errores del servidor vienen por posición). */
  const sentKeys = useRef<string[]>([])

  // «Sueldos del mes»: los seis datos del resumen y si las líneas se editan a mano.
  const [payrollInputs, setPayrollInputs] = useState<PayrollInputs>(EMPTY_PAYROLL)
  const [payrollError, setPayrollError] = useState<{
    field: PayrollField
    message: string
  } | null>(null)
  // Con líneas que vienen de un comprobante (`?corrige=`) se arranca en la grilla.
  const [manualLines, setManualLines] = useState(initialLines.length > 0)
  const payrollAuto = kind === 'payroll' && !manualLines
  const payroll = useMemo<PayrollBuild>(
    () => payrollBuild(payrollInputs, date ?? today, ctx),
    [payrollInputs, date, today, ctx],
  )
  const payrollLines = useMemo<EntryLine[]>(
    () =>
      payroll.state === 'ready' ? payroll.lines.map((l, i) => ({ ...l, key: `sueldos-${i}` })) : [],
    [payroll],
  )
  /** Las líneas que se mandan: las del paso a paso de sueldos, o las de la grilla. */
  const currentLines = payrollAuto ? payrollLines : lines
  const shownDescription =
    kind === 'payroll' && !descriptionTouched ? payrollDescription(date ?? today) : description

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
  const totals = entryTotals(currentLines)
  const movesVat = currentLines.some((l) => accountOf(l.accountId)?.systemKey?.startsWith('vat_'))
  // «Proveedor o cliente» y «Vence» solo ocupan lugar si alguna línea los usa.
  const partyColumns = lines.some((l) => accountOf(l.accountId)?.requiresParty)

  const values = useMemo<Omit<ManualEntryValues, 'clientRef' | 'previewHash'>>(
    () =>
      manualEntryValues({
        kind,
        date,
        description: shownDescription,
        lines: currentLines,
        correctsId,
      }),
    [kind, date, shownDescription, currentLines, correctsId],
  )
  const valuesKey = JSON.stringify(values)

  const gridPreview: EntryPreviewData = {
    documentRef: 'asiento',
    description: values.description,
    date,
    lines: currentLines
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
    posting.setBanner(null)
    syncKindParam(next)
  }

  function changeDescription(value: string) {
    setDescription(value)
    setDescriptionTouched(true)
    setLocalErrors((prev) => {
      if (!prev.description) return prev
      const next = { ...prev }
      delete next.description
      return next
    })
    posting.clearFieldError('description')
  }

  function changeDate(value: string | null) {
    setDate(value)
    setLocalErrors((prev) => {
      if (!prev.date) return prev
      const next = { ...prev }
      delete next.date
      return next
    })
    posting.clearFieldError('date')
  }

  function focusFirstProblem(onlyBalance: boolean) {
    requestAnimationFrame(() => {
      if (onlyBalance && totalsRef.current) {
        totalsRef.current.focus()
        return
      }
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
  }

  function submit() {
    const check = validateEntry({
      lines: currentLines,
      date,
      description: shownDescription,
      requiresParty: (id) => accountOf(id)?.requiresParty ?? false,
    })
    if (!check.ok) {
      setLocalErrors(check.errors)
      // En el paso a paso las líneas no están a la vista: se dice dónde mirarlas.
      const lineProblem =
        payrollAuto && !('date' in check.errors) && !('description' in check.errors)
      posting.setBanner({
        tone: 'error',
        message: lineProblem
          ? `${check.message} Abrí «Editar las líneas a mano» para revisarlas.`
          : check.message,
      })
      focusFirstProblem(check.onlyBalance)
      return
    }
    setLocalErrors({})
    const keys = currentLines.filter(hasContent).map((l) => l.key)
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

  /**
   * «Guardar los sueldos»: primero lo que revisaba «Armar las líneas» (mismos
   * textos, con el foco en el dato que falta) y después el `submit()` de siempre.
   */
  function submitPayroll() {
    if (payroll.state !== 'ready') {
      setPayrollError({ field: payroll.field, message: payroll.message })
      posting.setBanner({ tone: 'error', message: payroll.message })
      focusFirstProblem(false)
      return
    }
    setPayrollError(null)
    submit()
  }

  function save() {
    if (posting.pending) return
    if (payrollAuto) submitPayroll()
    else submit()
  }

  /** «Editar las líneas a mano»: la grilla arranca con las líneas que ya armó el paso a paso. */
  function editLines() {
    const source: InitialLine[] =
      payroll.state === 'ready' ? payroll.lines : [emptyLine(), emptyLine()]
    setLines(source.map((l) => ({ ...l, key: newKey() })))
    setLocalErrors({})
    setPayrollError(null)
    posting.setBanner(null)
    setManualLines(true)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save()
  }

  /** ⌘↵ guarda; Enter en un campo pasa al siguiente (en la última leyenda, agrega una línea). */
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      save()
      return
    }
    if (target.tagName !== 'INPUT') return
    event.preventDefault()
    const lastKey = lines.at(-1)?.key
    if (!payrollAuto && target.dataset.lastMemo === 'true' && target.dataset.line === lastKey) {
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
  const dateMin = firstOpenDate ?? ctx.settings.booksStartDate
  const dateMax = endOfMonth(today)
  const kindOptions = [
    { value: 'adjustment' as const, label: 'Ajuste' },
    { value: 'payroll' as const, label: 'Sueldos' },
    { value: 'manual' as const, label: 'Otro' },
    ...(fyAdjustment
      ? [{ value: 'fy_adjustment' as const, label: 'Ajuste de cierre de ejercicio' }]
      : []),
  ]
  const warnings = (
    <WarningsDialog
      warnings={posting.warnings}
      pending={posting.pending}
      onCancel={posting.dismissWarnings}
      onConfirm={() => posting.confirmWarnings()}
    />
  )

  if (payrollAuto) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          back={{ href: backHref, label: 'Libros' }}
          title="Sueldos del mes"
          description={PAYROLL_HELP}
        />
        {notice}
        <form ref={formRef} noValidate onSubmit={onSubmit} onKeyDown={onKeyDown}>
          <PayrollSteps
            inputs={payrollInputs}
            onInputsChange={(patch) => {
              setPayrollInputs((prev) => ({ ...prev, ...patch }))
              setPayrollError(null)
            }}
            build={payroll}
            fieldError={payrollError}
            date={date}
            onDateChange={changeDate}
            dateMin={dateMin}
            dateMax={dateMax}
            dateError={dateError}
            today={today}
            description={shownDescription}
            descriptionId={descriptionId}
            onDescriptionChange={changeDescription}
            descriptionError={descriptionError}
            preview={override ?? [gridPreview]}
            banner={<FormBanner banner={posting.banner} />}
            pending={posting.pending}
            onEditLines={editLines}
            onOtherKind={() => changeKind('adjustment')}
          />
          {warnings}
        </form>
      </AdmPage>
    )
  }

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: backHref, label: 'Libros' }}
        title="Asiento manual"
        description={HELP}
      />
      {notice}
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        className="card-hairline grid gap-6 rounded-2xl border bg-card p-4 shadow-xs sm:p-6"
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
            inputs={payrollInputs}
            onInputsChange={(patch) => setPayrollInputs((prev) => ({ ...prev, ...patch }))}
            build={payroll}
            replaces={lines.some(hasContent)}
            onApply={(templateLines) => {
              setLines(templateLines.map((l) => ({ ...l, key: newKey() })))
              setLocalErrors({})
            }}
            onBackToSteps={() => {
              setManualLines(false)
              setLocalErrors({})
              posting.setBanner(null)
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
              onValueChange={changeDate}
              min={dateMin}
              max={dateMax}
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
              value={shownDescription}
              maxLength={200}
              placeholder="Por ejemplo: amortización de equipos de octubre"
              aria-invalid={descriptionError ? true : undefined}
              aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
              onChange={(e) => changeDescription(e.target.value)}
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
          <div className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
            <p className="flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1.5 text-pretty">
              <StatusPill tone="info">Vinculado</StatusPill>
              <span className="min-w-0 flex-1 basis-64">
                Este ajuste queda vinculado a <span className="font-medium">{corrects.label}</span>
                {corrects.month ? ` (${corrects.month.toLowerCase()}, cerrado)` : ''}. Las líneas
                son las de ese comprobante al revés: dejá solo lo que haya que corregir.
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 shrink-0 gap-1.5 md:pointer-fine:h-8"
              onClick={() => setCorrectsId(null)}
            >
              <Link2Off className="size-3.5" aria-hidden />
              No vincularlo
            </Button>
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
              partyColumns ? GRID : GRID_SLIM,
            )}
          >
            <span>Cuenta</span>
            {partyColumns ? <span>Proveedor o cliente</span> : null}
            {/* Con el mismo margen que el número adentro del campo: si no, «Haber» se pega a «Leyenda». */}
            <span className="pr-3 text-right">Debe</span>
            <span className="pr-3 text-right">Haber</span>
            <span className="pl-0.5">Leyenda</span>
            {partyColumns ? <span>Vence</span> : null}
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
                partyColumns={partyColumns}
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

          <TotalsBar
            ref={totalsRef}
            debit={totals.debit}
            credit={totals.credit}
            error={linesError}
          />
        </section>

        {movesVat ? (
          <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p className="text-pretty">
              Este asiento mueve IVA, pero no entra al Libro IVA: ahí van solo los comprobantes.
            </p>
          </div>
        ) : null}

        {/* El mismo rótulo que en «Sueldos del mes» (y en toda la sección). */}
        <EntryPreview
          entries={override ?? [gridPreview]}
          label="Ver cómo queda en los libros"
          emptyText="Elegí las cuentas y cargá los importes para ver cómo queda en los libros."
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

        {warnings}
      </form>
    </AdmPage>
  )
}

function LineRow({
  line,
  index,
  isLast,
  canRemove,
  requiresParty,
  partyColumns,
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
  /** Alguna línea pide proveedor o cliente: la grilla lleva sus dos columnas. */
  partyColumns: boolean
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
        partyColumns ? GRID : GRID_SLIM,
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
      ) : partyColumns ? (
        <span aria-hidden className="hidden lg:block" />
      ) : null}

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
      ) : partyColumns ? (
        <span aria-hidden className="hidden lg:block" />
      ) : null}

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
        <p role="alert" className="col-span-2 text-xs text-destructive lg:col-span-full">
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
 * «Sueldos del mes» dentro de la grilla (E13), para quien abrió «Editar las
 * líneas a mano»: los mismos seis datos del paso a paso y el botón que arma (o
 * reemplaza) las líneas, que después se tocan en la grilla. Es el camino de
 * antes; los datos son los del formulario, así que no se pierden al ir y venir.
 */
function PayrollTemplate({
  inputs,
  onInputsChange,
  build,
  replaces,
  onApply,
  onBackToSteps,
}: {
  inputs: PayrollInputs
  onInputsChange: (patch: Partial<PayrollInputs>) => void
  build: PayrollBuild
  replaces: boolean
  onApply: (lines: InitialLine[]) => void
  onBackToSteps: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  function apply() {
    if (build.state !== 'ready') {
      setError(build.message)
      return
    }
    setError(null)
    onApply(build.lines)
  }

  return (
    <section className="grid gap-4 rounded-xl bg-secondary/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="space-y-0.5">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Sueldos del mes</h2>
          <p className="text-xs text-muted-foreground">
            Con los números del resumen de la contadora armamos las líneas. Después las podés tocar.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToSteps}
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
          Volver al paso a paso
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label="Sueldos brutos"
          value={inputs.gross}
          onValueChange={(c) => onInputsChange({ gross: c })}
          required
        />
        <MoneyField
          label="Contribuciones patronales"
          value={inputs.contributions}
          onValueChange={(c) => onInputsChange({ contributions: c })}
          required
        />
        <MoneyField
          label="Aportes retenidos"
          hint="Lo que se descuenta del recibo (jubilación, obra social, PAMI)."
          value={inputs.withheld}
          onValueChange={(c) => onInputsChange({ withheld: c })}
          required
        />
        <MoneyField
          label="Cuota sindical"
          optional
          value={inputs.union}
          onValueChange={(c) => onInputsChange({ union: c })}
        />
        <DateField
          label="Vencen los sueldos"
          optional
          value={inputs.salariesDue}
          onValueChange={(iso) => onInputsChange({ salariesDue: iso })}
          shortcuts={false}
        />
        <DateField
          label="Vencen las cargas sociales"
          optional
          value={inputs.socialDue}
          onValueChange={(iso) => onInputsChange({ socialDue: iso })}
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
