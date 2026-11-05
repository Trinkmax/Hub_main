'use client'

import { Info, Link2Off, Loader2, MessageSquarePlus, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FocusEvent,
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
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { Amount } from '@/components/administracion/amount'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { DateField, DateInput } from '@/components/administracion/date-input'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import {
  Planilla,
  PlanillaFoot,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
  SimplePage,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postManualEntry } from '@/lib/accounting/actions/documents'
import {
  ENTRY_MODELS,
  type EntryModelKey,
  entryModel,
  entryModelConcept,
  entryModelLines,
} from '@/lib/accounting/entry-models'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { ManualEntryValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import { endOfMonth, formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BackLink, SLIDING_SHEET } from '../../_components/book-page'
import {
  balanceState,
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

const TITLE = 'font-serif text-2xl font-semibold tracking-tight'

/** La aclaración de los sueldos como modelo: el devengado de la planilla no se carga dos veces. */
const PAYROLL_NOTE = entryModel('sueldos')?.note ?? ''

/** Los campos de arriba: mismo alto que el buscador de cuentas. */
const FIELD = 'h-11 text-base md:h-10 md:text-sm'
const SELECT =
  'adm-select h-11 w-full min-w-0 rounded-md border border-input bg-background/60 px-2.5 text-base shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:h-10 md:text-sm dark:bg-input/30'

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
  /** El respaldo: va a la nota del comprobante. */
  notes?: string | null
}): Omit<ManualEntryValues, 'clientRef' | 'previewHash'> {
  const notes = input.notes?.trim()
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
    ...(notes ? { notes } : {}),
  }
}

/**
 * Asiento manual (H.13) y «Sueldos del mes»: un solo formulario con dos caras.
 *
 * - **Asiento manual**: la grilla clásica Cuenta · Debe · Haber, arriba Modelo · Fecha · Concepto ·
 *   Respaldo, y al pie el mensaje en vivo («Falta $ X en el Haber») o el sello «Debe = Haber».
 *   «Grabar asiento» está apagado hasta que cuadre: «el sistema no te debe permitir grabar» (Silvia).
 *   Enter avanza como en cualquier sistema contable: de la cuenta al importe y al renglón de abajo.
 * - **Sueldos del mes** (`?tipo=sueldos`, también como modelo): los mismos datos en tres pasos, con un
 *   ticket que se arma solo (`PayrollSteps`). Las líneas se rearman con cada dato hasta que se abre
 *   «Editar las líneas a mano».
 *
 * La contadora también entra: `postManualEntry` la autoriza con el acceso de lectura y la base lo
 * verifica. Lo único que cambia para ella es que no hay «Deshacer» (anular es de los dueños).
 *
 * En los dos casos se guarda con el mismo motor que la vista previa (E.7), con la misma acción y el
 * mismo envío. El tipo vive en la URL (`?tipo=`) sin recargar: cambiarlo no pierde lo cargado.
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
  /** A dónde vuelve el «‹ Contabilidad» del encabezado. */
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
  const backingId = useId()
  const accounting = useAccountingOptional()

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
  const [model, setModel] = useState<EntryModelKey | ''>('')
  /** El respaldo: un ajuste de un comprobante ya lo tiene. */
  const [backing, setBacking] = useState(corrects?.label ?? '')
  /** Los renglones con la leyenda a la vista (las que ya traen, siempre). */
  const [memoOpen, setMemoOpen] = useState<ReadonlySet<string>>(new Set())
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
  // Anular es de los dueños: la contadora graba y, si hace falta, hace otro asiento.
  const readOnly = accounting?.readOnly ?? false
  const posting = usePosting<ManualEntryValues>({
    tenantSlug,
    action: postManualEntry,
    formRef,
    isKnownField: (key) =>
      key === 'date' || key === 'description' || key === 'notes' || FIELD_RE.test(key),
    onSaved: (saved) => {
      if (readOnly) toast.success(saved.message)
      else undoToast(saved.message, saved)
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
  const balance = balanceState(totals.debit, totals.credit)

  const values = useMemo<Omit<ManualEntryValues, 'clientRef' | 'previewHash'>>(
    () =>
      manualEntryValues({
        kind,
        date,
        description: shownDescription,
        lines: currentLines,
        correctsId,
        // Paso a paso no se pide: los sueldos salen del resumen de la contadora.
        notes: payrollAuto ? null : backing,
      }),
    [kind, date, shownDescription, currentLines, correctsId, payrollAuto, backing],
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

  function changeBacking(value: string) {
    setBacking(value)
    setLocalErrors((prev) => {
      if (!prev.backing) return prev
      const next = { ...prev }
      delete next.backing
      return next
    })
    posting.clearFieldError('notes')
  }

  /**
   * Elegir un modelo arma los renglones con sus cuentas (sin importes: los pone quien tiene el papel
   * adelante) y propone el concepto, si no se escribió otro. «Sueldos del mes» es la otra cara del
   * formulario; «Sin modelo» deja dos renglones vacíos.
   */
  function chooseModel(key: string) {
    const chosen = entryModel(key)
    setModel(chosen?.key ?? '')
    setLocalErrors({})
    posting.setBanner(null)
    if (chosen?.key === 'sueldos') {
      setManualLines(false)
      changeKind('payroll')
      return
    }
    if (!chosen) {
      setLines([emptyLine(), emptyLine()].map((l) => ({ ...l, key: newKey() })))
      return
    }
    const filled = entryModelLines(chosen, {
      accounts: [...ctx.accounts.values()],
      treasuries: [...ctx.treasuries.values()],
    })
    const next: EntryLine[] = filled.map((line) => ({
      ...emptyLine(),
      accountId: line.accountId,
      hintSide: line.side,
      key: newKey(),
    }))
    setLines(next)
    if (kind !== chosen.entryKind) changeKind(chosen.entryKind)
    if (!descriptionTouched || description.trim() === '') {
      setDescription(entryModelConcept(chosen, date))
    }
    // El foco va al primer importe: las cuentas ya están.
    const first = next[0]
    if (first?.accountId) {
      focusCell(first.hintSide === 'credit' ? `haber-${first.key}` : `debe-${first.key}`)
    } else if (first) {
      setFocusKey(first.key)
    }
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
      backing: payrollAuto ? undefined : backing,
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
        else if (path === 'notes') mapped.backing = message
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

  /** Lleva el foco a un campo cuando ya se dibujó. */
  function focusCell(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  /** Abajo: el renglón siguiente; en el último, «Grabar» si ya cuadra o un renglón nuevo. */
  function advanceFromLine(key: string) {
    const at = lines.findIndex((l) => l.key === key)
    const next = lines[at + 1]
    if (next) {
      document.getElementById(`cuenta-${next.key}`)?.focus()
      return
    }
    if (balance.state === 'balanced') document.getElementById(`${dateId}-grabar`)?.focus()
    else addLine()
  }

  /**
   * Al elegir una cuenta, el foco sigue al importe. El buscador, al cerrarse, le devuelve el foco a su
   * botón (lo hace después de animar): `onFormFocus` lo reenvía si llega en ese ratito.
   */
  const pendingAdvance = useRef<{ from: string; to: string; until: number } | null>(null)

  function afterAccountChosen(line: EntryLine) {
    const to = line.hintSide === 'credit' ? `haber-${line.key}` : `debe-${line.key}`
    pendingAdvance.current = { from: `cuenta-${line.key}`, to, until: Date.now() + 600 }
    focusCell(to)
  }

  function onFormFocus(event: FocusEvent<HTMLFormElement>) {
    const pending = pendingAdvance.current
    if (!pending) return
    if (Date.now() > pending.until) {
      pendingAdvance.current = null
    } else if (event.target.id === pending.from) {
      document.getElementById(pending.to)?.focus()
    }
  }

  /** ⌘↵ guarda; Enter avanza: de la cuenta al importe, del importe al renglón de abajo. */
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      save()
      return
    }
    // El buscador de cuentas se dibuja afuera del formulario, pero sus teclas suben hasta acá: su Enter
    // elige la cuenta y no es asunto de la grilla.
    if (!event.currentTarget.contains(target)) return
    const cell = target.dataset.cell
    const key = target.dataset.line
    // El botón de una cuenta ya elegida: Enter pasa al importe. Sin cuenta, abre el buscador.
    if (target.getAttribute('role') === 'combobox' && target.id.startsWith('cuenta-')) {
      const line = lines.find((l) => `cuenta-${l.key}` === target.id)
      if (line?.accountId) {
        event.preventDefault()
        document
          .getElementById(line.hintSide === 'credit' ? `haber-${line.key}` : `debe-${line.key}`)
          ?.focus()
      }
      return
    }
    if (target.tagName !== 'INPUT') return
    event.preventDefault()
    if (key && (cell === 'debit' || cell === 'credit')) {
      const line = lines.find((l) => l.key === key)
      if (cell === 'debit' && (line?.debitCents ?? 0) === 0) {
        document.getElementById(`haber-${key}`)?.focus()
      } else {
        advanceFromLine(key)
      }
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
  const backingError = localErrors.backing ?? posting.fieldErrors.notes ?? null
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
  const shownModel = entryModel(model)
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
      <SimplePage width="narrow">
        <div className="grid gap-1">
          <BackLink href={backHref}>Contabilidad</BackLink>
          <h1 className={TITLE}>Sueldos del mes</h1>
          <p className="text-sm text-muted-foreground text-pretty">{PAYROLL_NOTE}</p>
        </div>
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
            onOtherKind={() => {
              setModel('')
              changeKind('adjustment')
            }}
          />
          {warnings}
        </form>
      </SimplePage>
    )
  }

  return (
    <SimplePage width="narrow">
      <div className="grid gap-1">
        <BackLink href={backHref}>Contabilidad</BackLink>
        <h1 className={TITLE}>Asiento manual</h1>
      </div>
      {notice}
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onFocus={onFormFocus}
        className="grid gap-3.5"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_11rem]">
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${dateId}-modelo`}>Modelo</Label>
            <select
              id={`${dateId}-modelo`}
              value={model}
              onChange={(event) => chooseModel(event.target.value)}
              className={SELECT}
            >
              <option value="">Sin modelo</option>
              {ENTRY_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${dateId}-tipo`}>Tipo de asiento</Label>
            <select
              id={`${dateId}-tipo`}
              value={kind}
              onChange={(event) => changeKind(event.target.value as ManualKind)}
              className={SELECT}
            >
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {kind === 'fy_adjustment' && fyAdjustment ? (
            <div className="grid content-start gap-1.5">
              <Label htmlFor={dateId}>Fecha</Label>
              <Input
                id={dateId}
                value={formatIsoDay(fyAdjustment.endDate)}
                readOnly
                aria-describedby={`${dateId}-hint`}
                className={FIELD}
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
              shortcuts={false}
              error={dateError}
              hint={
                firstOpenDate
                  ? `Desde el ${formatIsoDay(firstOpenDate)}: lo de un mes cerrado se ajusta en uno abierto.`
                  : undefined
              }
            />
          )}
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3">
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
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
                onChange={(e) => changeDescription(e.target.value)}
                className={FIELD}
              />
              {descriptionError ? (
                <p id={`${descriptionId}-error`} role="alert" className="text-xs text-destructive">
                  {descriptionError}
                </p>
              ) : null}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor={backingId}>
                Respaldo
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </Label>
              <Input
                id={backingId}
                value={backing}
                maxLength={1000}
                placeholder="Contrato, resumen, n.º…"
                aria-invalid={backingError ? true : undefined}
                aria-describedby={backingError ? `${backingId}-error` : undefined}
                onChange={(e) => changeBacking(e.target.value)}
                className={FIELD}
              />
              {backingError ? (
                <p id={`${backingId}-error`} role="alert" className="text-xs text-destructive">
                  {backingError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {shownModel?.note ? (
          <p className="text-sm text-muted-foreground text-pretty">{shownModel.note}</p>
        ) : null}

        {kind === 'fy_adjustment' ? (
          <p className="text-xs text-muted-foreground text-pretty">
            Para amortizaciones, existencias y reclasificaciones de la contadora. Va con fecha del
            último día del ejercicio, al período de ajustes.
          </p>
        ) : null}

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

        {corrects && correctsId ? (
          <div className="flex flex-col gap-3 rounded-lg bg-secondary/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
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

        <Planilla className={SLIDING_SHEET}>
          <PTable minWidth={560} label="Los renglones del asiento">
            <thead>
              <tr>
                <PTh>Cuenta (código o nombre)</PTh>
                <PTh align="right" className="w-44">
                  Debe
                </PTh>
                <PTh align="right" className="w-44">
                  Haber
                </PTh>
                <PTh className="w-20">
                  <span className="sr-only">Quitar o agregar leyenda</span>
                </PTh>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  index={index}
                  canRemove={lines.length > 2}
                  requiresParty={accountOf(line.accountId)?.requiresParty ?? false}
                  showMemo={line.memo !== '' || memoOpen.has(line.key)}
                  accounts={accounts}
                  parties={parties}
                  today={today}
                  errorOf={(field) => errorOf(line.key, field)}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                  onShowMemo={() => {
                    setMemoOpen((prev) => new Set(prev).add(line.key))
                    focusCell(`leyenda-${line.key}`)
                  }}
                  onAccountChosen={() => afterAccountChosen(line)}
                />
              ))}
              <tr>
                <PTd colSpan={4}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5 md:pointer-fine:h-8"
                    onClick={addLine}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Otro renglón
                  </Button>
                </PTd>
              </tr>
            </tbody>
            <tfoot>
              <PTotalRow>
                <PTd className="font-semibold">Totales</PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={totals.debit} currency={false} />
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={totals.credit} currency={false} />
                </PTd>
                <PTd />
              </PTotalRow>
            </tfoot>
          </PTable>
          <BalanceFoot
            ref={totalsRef}
            balance={balance}
            error={linesError}
            pending={posting.pending}
            buttonId={`${dateId}-grabar`}
          />
        </Planilla>

        {movesVat ? (
          <p className="flex items-start gap-2 text-sm text-pretty">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            Este asiento mueve IVA, pero no entra al Libro IVA: ahí van solo los comprobantes.
          </p>
        ) : null}

        {/* La grilla ya dice cómo queda: esto es para cuando el servidor lo recalculó. */}
        {override ? (
          <EntryPreview
            entries={override}
            label="Ver cómo queda en los libros"
            emptyText="Elegí las cuentas y cargá los importes para ver cómo queda en los libros."
          />
        ) : null}

        <FormBanner banner={posting.banner} />

        {warnings}
      </form>
    </SimplePage>
  )
}

function LineRow({
  line,
  index,
  canRemove,
  requiresParty,
  showMemo,
  accounts,
  parties,
  today,
  errorOf,
  onChange,
  onRemove,
  onShowMemo,
  onAccountChosen,
}: {
  line: EntryLine
  index: number
  canRemove: boolean
  requiresParty: boolean
  /** La leyenda es opcional: no ocupa lugar hasta que se pide. */
  showMemo: boolean
  accounts: readonly AccountOption[]
  parties: readonly PartyOption[]
  today: string
  errorOf: (field: LineField) => string | undefined
  onChange: (patch: Partial<EntryLine>) => void
  onRemove: () => void
  onShowMemo: () => void
  onAccountChosen: () => void
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

  return (
    <tr className="group/row border-b border-border/60 align-top">
      <PTd className="align-top">
        <div className="grid gap-1.5">
          <AccountCombobox
            id={ids.account}
            aria-label={`Cuenta del renglón ${n}`}
            accounts={accounts}
            value={line.accountId}
            invalid={Boolean(errors.accountId)}
            className="md:h-9"
            onValueChange={(id, account) => {
              const next = account && id ? id : null
              onChange({ accountId: next, partyId: null, dueDate: null })
              if (next) onAccountChosen()
            }}
          />
          {requiresParty ? (
            <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
              <PartyCombobox
                id={ids.party}
                aria-label={`Proveedor o cliente del renglón ${n}`}
                parties={parties}
                value={line.partyId}
                placeholder="Elegí quién"
                invalid={Boolean(errors.partyId)}
                className="md:h-9"
                onValueChange={(id) => onChange({ partyId: id })}
              />
              <DateInput
                id={ids.due}
                aria-label={`Vencimiento del renglón ${n}`}
                value={line.dueDate}
                onValueChange={(iso) => onChange({ dueDate: iso })}
                shortcuts={false}
                today={today}
                invalid={Boolean(errors.dueDate)}
              />
            </div>
          ) : null}
          {showMemo ? (
            <Input
              id={ids.memo}
              aria-label={`Leyenda del renglón ${n}`}
              value={line.memo}
              maxLength={200}
              placeholder="Leyenda"
              data-cell="memo"
              data-line={line.key}
              aria-invalid={errors.memo ? true : undefined}
              onChange={(e) => onChange({ memo: e.target.value })}
              className={FIELD}
            />
          ) : null}
          {messages.length > 0 ? (
            <p role="alert" className="text-xs text-destructive">
              {messages.join(' ')}
            </p>
          ) : null}
        </div>
      </PTd>
      <PTd align="right" className="align-top">
        <MoneyInput
          id={ids.debit}
          aria-label={`Debe del renglón ${n}`}
          value={line.debitCents}
          align="end"
          size="sm"
          data-cell="debit"
          data-line={line.key}
          invalid={Boolean(errors.debitCents)}
          onValueChange={(cents) =>
            onChange(
              cents !== null && cents > 0
                ? { debitCents: cents, creditCents: null }
                : { debitCents: cents },
            )
          }
        />
      </PTd>
      <PTd align="right" className="align-top">
        <MoneyInput
          id={ids.credit}
          aria-label={`Haber del renglón ${n}`}
          value={line.creditCents}
          align="end"
          size="sm"
          data-cell="credit"
          data-line={line.key}
          invalid={Boolean(errors.creditCents)}
          onValueChange={(cents) =>
            onChange(
              cents !== null && cents > 0
                ? { creditCents: cents, debitCents: null }
                : { creditCents: cents },
            )
          }
        />
      </PTd>
      <PTd className="align-top whitespace-nowrap">
        <div className={cn('flex items-center justify-end gap-0.5', ROW_ACTION)}>
          {showMemo ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground md:pointer-fine:size-8"
              aria-label={`Agregar una leyenda al renglón ${n}`}
              tabIndex={-1}
              onClick={onShowMemo}
            >
              <MessageSquarePlus className="size-4" aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground md:pointer-fine:size-8"
            aria-label={`Quitar el renglón ${n}`}
            tabIndex={-1}
            disabled={!canRemove}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </PTd>
    </tr>
  )
}

/**
 * El pie de la grilla: cuánto falta y de qué lado, o el sello cayendo cuando cuadra, y «Grabar
 * asiento», que recién ahí se prende. Se le da foco si se intenta grabar sin que cuadre.
 */
function BalanceFoot({
  ref,
  balance,
  error,
  pending,
  buttonId,
}: {
  ref: Ref<HTMLDivElement>
  balance: ReturnType<typeof balanceState>
  error: string | null
  pending: boolean
  buttonId: string
}) {
  return (
    <PlanillaFoot>
      <div
        ref={ref}
        tabIndex={-1}
        className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p role="status" aria-live="polite" className="text-sm font-medium tabular-nums">
          {balance.state === 'balanced' ? (
            <Stamp thud>{balance.text}</Stamp>
          ) : (
            <span
              className={balance.state === 'gap' ? 'text-destructive' : 'text-muted-foreground'}
            >
              {balance.text}
            </span>
          )}
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        id={buttonId}
        type="submit"
        disabled={balance.state !== 'balanced' || pending}
        className="h-11 min-w-40 gap-2 md:h-9"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? 'Grabando…' : 'Grabar asiento'}
      </Button>
    </PlanillaFoot>
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
