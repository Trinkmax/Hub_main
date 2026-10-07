'use client'

import { CheckCircle2, Info, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type ClipboardEvent,
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { describedBy, Field } from '@/components/administracion/cajas-ventas/field'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { QuickPartyDialog } from '@/components/administracion/cajas-ventas/quick-party-dialog'
import { useDocumentPreview } from '@/components/administracion/cajas-ventas/sheet-frame'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { plural } from '@/components/administracion/format'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { postSalesClose } from '@/lib/accounting/actions/documents'
import { netFromGross } from '@/lib/accounting/iva'
import {
  isPastedColumn,
  parsePastedColumn,
  parseRange,
  splitPastedVoucher,
} from '@/lib/accounting/paste'
import {
  type SalesCloseBuildInput,
  summarizeSalesClose,
} from '@/lib/accounting/posting/sales-close'
import { CHANNEL_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import type { SalesCloseValues } from '@/lib/accounting/server/document-types'
import type {
  Channel,
  IvaCondition,
  PostingContext,
  SalesMethodKind,
  VatRateBp,
} from '@/lib/accounting/types'
import { CHANNELS } from '@/lib/accounting/types'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

// ─── Lo que arma la página ───────────────────────────────────────────────────

export type CloseMethod = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  /** «Caja», «Posnet · se acredita el 06/10»: adónde va lo cobrado. */
  destination: string
  /** El efectivo (el que se puede contar): lleva «¿Contaste otra cosa?». */
  isCash: boolean
}

export type CloseSalesPoint = { number: number; label: string; defaultChannel: Channel }

/** El último «hasta» cargado de un tipo y punto de venta: el «desde» nuevo es ese + 1. */
export type CloseRangeDefault = {
  voucherType: string
  pointOfSale: number
  channel: Channel | null
  lastNumberTo: number
}

export type CloseCustomer = {
  id: string
  name: string
  tradeName: string | null
  taxId: string | null
  ivaCondition: IvaCondition
  active: boolean
}

export type ExistingClose = { id: string; title: string; totalCents: number }

// ─── Estado del formulario ───────────────────────────────────────────────────

type CloseVoucher =
  | 'factura_b'
  | 'factura_a'
  | 'tique_factura_b'
  | 'tique_factura_a'
  | 'nota_credito_b'
  | 'nota_credito_a'
  | 'nota_debito_b'
  | 'nota_debito_a'

/** En el orden en que se usan en un bar: B primero, después A, tiques y notas. */
const VOUCHERS: readonly CloseVoucher[] = [
  'factura_b',
  'factura_a',
  'tique_factura_b',
  'tique_factura_a',
  'nota_credito_b',
  'nota_credito_a',
  'nota_debito_b',
  'nota_debito_a',
]

function isCloseVoucher(value: string): value is CloseVoucher {
  return (VOUCHERS as readonly string[]).includes(value)
}

const RATES: readonly VatRateBp[] = [2100, 1050, 2700, 500, 250, 0]

type RangeRow = {
  key: number
  voucherType: CloseVoucher
  pointOfSale: number | null
  from: string
  /** El «desde» lo puso el formulario (último «hasta» + 1): una fila así sola no cuenta. */
  fromAuto: boolean
  to: string
  channel: Channel
  partyId: string | null
  total: number | null
  rate: VatRateBp
  /** La agregó la persona: cuenta aunque esté vacía (y se puede quitar). */
  manual: boolean
}

type AccountRow = { key: number; partyId: string | null; amount: number | null }

type Creating = { name: string; requireCuit: boolean; apply: (partyId: string) => void }

const isLetterA = (type: CloseVoucher) => type.endsWith('_a')
const isCreditNote = (type: CloseVoucher) => type.startsWith('nota_credito')

/** Los errores que se ven en su campo (el resto va al aviso de arriba de los botones). */
function isKnownField(key: string): boolean {
  return (
    key === 'methods' ||
    key === 'shift' ||
    key === 'cashCountedCents' ||
    key === 'controlTotalCents' ||
    key.startsWith('methods.') ||
    key.startsWith('invoiced.')
  )
}

function digits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8)
}

function numberOrNull(value: string): number | null {
  const v = value.trim()
  return v === '' ? null : Number(v)
}

/** Una fila cuenta si la persona la tocó: el «desde» precargado solo no alcanza. */
function rowCounts(row: RangeRow): boolean {
  return (
    row.manual ||
    row.to.trim() !== '' ||
    row.total !== null ||
    (!row.fromAuto && row.from.trim() !== '')
  )
}

/**
 * Cierre del día (H.9): lo vendido por medio de cobro, lo facturado por rango
 * y el efectivo contado. La vista previa («Ver asiento») se arma en el
 * navegador con el mismo código que corre la acción, y al guardar queda
 * «Deshacer» 6 s.
 */
export function SalesCloseForm({
  tenantSlug,
  date,
  dayLabel,
  ctx,
  firstOpenDate,
  methods,
  salesPoints,
  rangeDefaults,
  customers,
  existing,
  afterSaveHref,
  afterSaveLabel,
}: {
  tenantSlug: string
  /** El día que se cierra (`yyyy-MM-dd`). */
  date: string
  /** «lunes 05/10». */
  dayLabel: string
  ctx: PostingContext
  firstOpenDate: string | null
  /** Los medios activos, en el orden de Ajustes › Medios de cobro (el de Thinkeon). */
  methods: CloseMethod[]
  salesPoints: CloseSalesPoint[]
  rangeDefaults: CloseRangeDefault[]
  customers: CloseCustomer[]
  /** Cierres ya cargados ese día (otro turno). */
  existing: ExistingClose[]
  afterSaveHref: string
  /** «domingo 04/10» si después falta otro día. */
  afterSaveLabel: string | null
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const base = `/${tenantSlug}/administracion`

  const pointChannel = useCallback(
    (pos: number | null): Channel =>
      salesPoints.find((p) => p.number === pos)?.defaultChannel ?? 'salon',
    [salesPoints],
  )
  const lastTo = useMemo(
    () => new Map(rangeDefaults.map((r) => [`${r.voucherType}|${r.pointOfSale}`, r.lastNumberTo])),
    [rangeDefaults],
  )
  const suggestFrom = useCallback(
    (type: CloseVoucher, pos: number | null): string => {
      if (pos === null) return ''
      const last = lastTo.get(`${type}|${pos}`)
      return last === undefined ? '' : String(last + 1)
    },
    [lastTo],
  )

  const nextKey = useRef(0)
  const newKey = () => {
    nextKey.current += 1
    return nextKey.current
  }

  // Una fila por tipo y punto de venta habitual (B); la primera vez, una B por punto de venta.
  const [rows, setRows] = useState<RangeRow[]>(() => {
    const active = new Set(salesPoints.map((p) => p.number))
    const usual = rangeDefaults
      .filter(
        (r) =>
          (r.voucherType === 'factura_b' || r.voucherType === 'tique_factura_b') &&
          active.has(r.pointOfSale),
      )
      .sort((a, b) => a.pointOfSale - b.pointOfSale || a.voucherType.localeCompare(b.voucherType))
    const seeds =
      usual.length > 0
        ? usual.map((r) => ({
            type: r.voucherType as CloseVoucher,
            pos: r.pointOfSale,
            channel: r.channel ?? pointChannel(r.pointOfSale),
          }))
        : salesPoints.map((p) => ({
            type: 'factura_b' as CloseVoucher,
            pos: p.number,
            channel: p.defaultChannel,
          }))
    return seeds.map((s, i) => ({
      key: -1 - i,
      voucherType: s.type,
      pointOfSale: s.pos,
      from: suggestFrom(s.type, s.pos),
      fromAuto: true,
      to: '',
      channel: s.channel,
      partyId: null,
      total: null,
      rate: 2100,
      manual: false,
    }))
  })
  const [amounts, setAmounts] = useState<Record<string, number | null>>({})
  const [accounts, setAccounts] = useState<Record<string, AccountRow[]>>({})
  const [cashOpen, setCashOpen] = useState(false)
  const [cashCounted, setCashCounted] = useState<number | null>(null)
  const [control, setControl] = useState<number | null>(null)
  const [shift, setShift] = useState('')
  const [showForm, setShowForm] = useState(existing.length === 0)
  const [attempted, setAttempted] = useState(false)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const needsShift = existing.length > 0
  const cashMethod = methods.find((m) => m.isCash) ?? null
  const simpleMethods = methods.filter((m) => m.kind !== 'customer_account')

  const customerOptions = useMemo(
    (): PartyOption[] =>
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        tradeName: c.tradeName,
        taxId: c.taxId,
        active: c.active,
      })),
    [customers],
  )

  // ── Lo que se manda (y con lo que se arma la vista previa) ──
  const included = useMemo(() => rows.filter(rowCounts), [rows])

  const methodValues = useMemo(
    () =>
      methods.map((m) => {
        if (m.kind !== 'customer_account') {
          return { salesMethodId: m.id, amountCents: amounts[m.id] ?? 0, customers: [] }
        }
        const used = (accounts[m.id] ?? []).filter((r) => r.partyId !== null || r.amount !== null)
        return {
          salesMethodId: m.id,
          amountCents: used.reduce((sum, r) => sum + (r.amount ?? 0), 0),
          customers: used.map((r) => ({ partyId: r.partyId ?? '', amountCents: r.amount })),
        }
      }),
    [methods, amounts, accounts],
  )

  const values = useMemo(
    () => ({
      date,
      shift: needsShift && shift.trim() !== '' ? shift.trim() : null,
      methods: methodValues,
      invoiced: included.map((r) => ({
        voucherType: r.voucherType,
        pointOfSale: r.pointOfSale,
        numberFrom: numberOrNull(r.from),
        numberTo: numberOrNull(r.to),
        channel: r.channel,
        partyId: isLetterA(r.voucherType) ? r.partyId : null,
        amountMode: 'total' as const,
        totalCents: r.total,
        vatRateBp: r.rate,
        aliquots: [],
        nonTaxedCents: 0,
        exemptCents: 0,
      })),
      cashCountedCents: cashOpen && cashMethod ? cashCounted : null,
      controlTotalCents: control,
      overrideReason: null,
      instantSettlements: [],
    }),
    [date, needsShift, shift, methodValues, included, cashOpen, cashMethod, cashCounted, control],
  )
  const preview = useDocumentPreview('sales_close', values, ctx, firstOpenDate)

  // Vendido por canal y sin factura: el mismo cálculo del asiento (los números de
  // comprobante no cambian nada acá, así que la fila suma apenas tiene total).
  const summary = useMemo(() => {
    const input: SalesCloseBuildInput = {
      date,
      shift: null,
      warningsAck: [],
      methods: methodValues.map((m) => ({
        salesMethodId: m.salesMethodId,
        amountCents: m.amountCents,
        customers: [],
      })),
      invoiced: included
        .filter((r) => r.total !== null)
        .map((r) => ({
          voucherType: r.voucherType,
          pointOfSale: r.pointOfSale ?? 0,
          numberFrom: 1,
          numberTo: 1,
          channel: r.channel,
          partyId: null,
          amountMode: 'total' as const,
          totalCents: r.total,
          vatRateBp: r.rate,
          aliquots: [],
          nonTaxedCents: 0,
          exemptCents: 0,
        })),
      cashCountedCents: null,
      controlTotalCents: null,
      overrideReason: null,
      instantSettlements: [],
    }
    try {
      return summarizeSalesClose(input, ctx)
    } catch {
      // Un importe fuera de rango ya lo marca su campo: sin resumen hasta que se corrija.
      return null
    }
  }, [date, methodValues, included, ctx])
  const sold = summary?.soldCents ?? methodValues.reduce((sum, m) => sum + m.amountCents, 0)
  const channelLines = (summary?.channels ?? []).filter(
    (c) => c.soldCents !== 0 || c.invoicedTotalCents !== 0,
  )

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<SalesCloseValues>({
    tenantSlug,
    action: postSalesClose,
    formRef,
    isKnownField,
    onSaved: (saved) => {
      undoToast(saved.message, saved)
      router.push(afterSaveHref)
    },
  })

  // ── Errores (los de la vista previa, recién después de intentar guardar) ──
  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  const methodIndex = new Map(methods.map((m, i) => [m.id, i]))
  const methodError = (methodId: string, suffix: string) =>
    errorOf(`methods.${methodIndex.get(methodId) ?? -1}.${suffix}`)
  const rowIndex = new Map(included.map((r, i) => [r.key, i]))
  const rowError = (row: RangeRow, field: string): string | null => {
    const index = rowIndex.get(row.key)
    if (index === undefined) return null
    if (field === 'totalCents') {
      return (
        errorOf(`invoiced.${index}.totalCents`) ??
        errorOf(`invoiced.${index}.aliquots`) ??
        errorOf(`invoiced.${index}`)
      )
    }
    return errorOf(`invoiced.${index}.${field}`)
  }
  const clear = posting.clearFieldError

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  // ── Cambios ──
  function setAmount(methodId: string, cents: number | null) {
    setAmounts((prev) => ({ ...prev, [methodId]: cents }))
    clear(`methods.${methodIndex.get(methodId) ?? -1}.amountCents`)
    clear('methods')
  }

  /** Pegar una columna de Thinkeon en un medio la reparte hacia abajo (H.9). */
  function onMethodPaste(event: ClipboardEvent<HTMLInputElement>, methodId: string) {
    const text = event.clipboardData.getData('text')
    if (!isPastedColumn(text)) return
    event.preventDefault()
    const start = simpleMethods.findIndex((m) => m.id === methodId)
    const parsed = parsePastedColumn(text)
    setAmounts((prev) => {
      const next = { ...prev }
      parsed.values.forEach((cents, i) => {
        const target = simpleMethods[start + i]
        if (target) next[target.id] = cents
      })
      return next
    })
    clear('methods')
    const extra = parsed.values.length - (simpleMethods.length - start)
    const first = parsed.errors[0]
    if (first) {
      setPasteError(`Fila ${first.index + 1} («${first.raw}»): ${first.message}`)
    } else if (extra > 0) {
      setPasteError(
        `Pegaste ${plural(parsed.values.length, 'fila', 'filas')}: ${plural(extra, 'quedó afuera', 'quedaron afuera')} porque no hay más medios.`,
      )
    } else setPasteError(null)
  }

  function patchRow(key: number, patch: Partial<RangeRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /** Cambiar tipo o punto de venta vuelve a proponer el «desde» si no lo escribió la persona. */
  function changeRowSeries(
    row: RangeRow,
    patch: { voucherType?: CloseVoucher; pointOfSale?: number },
  ) {
    const type = patch.voucherType ?? row.voucherType
    const pos = patch.pointOfSale ?? row.pointOfSale
    const from = row.fromAuto || row.from.trim() === '' ? suggestFrom(type, pos) : row.from
    patchRow(row.key, {
      ...patch,
      from,
      fromAuto: row.fromAuto || row.from.trim() === '',
      channel: patch.pointOfSale !== undefined ? pointChannel(patch.pointOfSale) : row.channel,
      partyId: isLetterA(type) ? row.partyId : null,
    })
  }

  /**
   * Pegar «0003-00014501 a 0003-00014662» completa punto de venta, desde y
   * hasta; pegar un solo «0003-00014662» separa el punto de venta del número.
   */
  function onRangePaste(
    event: ClipboardEvent<HTMLInputElement>,
    row: RangeRow,
    field: 'from' | 'to',
  ) {
    const text = event.clipboardData.getData('text').trim()
    if (/^\d+$/.test(text)) return
    const knownPoint = (pos: number) =>
      salesPoints.some((p) => p.number === pos)
        ? { pointOfSale: pos, channel: pointChannel(pos) }
        : {}
    const range = parseRange(text)
    if (range.ok) {
      event.preventDefault()
      patchRow(row.key, {
        from: String(range.from),
        fromAuto: false,
        to: String(range.to),
        ...knownPoint(range.pointOfSale),
      })
      return
    }
    const single = splitPastedVoucher(text)
    if (!single) return
    event.preventDefault()
    patchRow(row.key, {
      ...(field === 'from'
        ? { from: String(single.number), fromAuto: false }
        : { to: String(single.number) }),
      ...knownPoint(single.pointOfSale),
    })
  }

  function addRow(type: CloseVoucher) {
    const pos = salesPoints[0]?.number ?? null
    setRows((prev) => {
      // El punto de venta de la última fila del mismo canal suele ser el que sigue.
      const last = [...prev].reverse().find((r) => r.pointOfSale !== null)
      const point = last?.pointOfSale ?? pos
      return [
        ...prev,
        {
          key: newKey(),
          voucherType: type,
          pointOfSale: point,
          from: suggestFrom(type, point),
          fromAuto: true,
          to: '',
          channel: pointChannel(point),
          partyId: null,
          total: null,
          rate: 2100,
          manual: true,
        },
      ]
    })
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function patchAccount(methodId: string, key: number, patch: Partial<AccountRow>) {
    setAccounts((prev) => ({
      ...prev,
      [methodId]: (prev[methodId] ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }))
    clear(`methods.${methodIndex.get(methodId) ?? -1}.customers`)
    clear('methods')
  }

  function addAccount(methodId: string) {
    setAccounts((prev) => ({
      ...prev,
      [methodId]: [...(prev[methodId] ?? []), { key: newKey(), partyId: null, amount: null }],
    }))
  }

  function removeAccount(methodId: string, key: number) {
    setAccounts((prev) => ({
      ...prev,
      [methodId]: (prev[methodId] ?? []).filter((r) => r.key !== key),
    }))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (needsShift && shift.trim() === '') {
      posting.setBanner({
        tone: 'error',
        message: 'Ese día ya tiene un cierre: poné el turno de este (por ejemplo, «noche»).',
      })
      requestAnimationFrame(() => document.getElementById(`${id}-shift`)?.focus())
      return
    }
    if (!preview.state.ok) {
      const keys = Object.keys(preview.state.fieldErrors ?? {})
      const allShown = keys.length > 0 && keys.every(isKnownField)
      posting.setBanner({
        tone: 'error',
        message: allShown ? 'Revisá lo marcado en rojo.' : preview.state.message,
      })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  // ── Sin medios no hay cierre ──
  if (methods.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="space-y-3">
          <p className="text-pretty text-warning-text">
            No hay medios de cobro activos. Activá los que usás (efectivo, débito, Mercado Pago…) y
            volvé a cargar el cierre.
          </p>
          <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
            <Link href={`${base}/ajustes?tab=medios`}>Ir a Medios de cobro</Link>
          </Button>
        </div>
      </div>
    )
  }

  const totalExisting = existing.reduce((sum, c) => sum + c.totalCents, 0)
  const cashSold = cashMethod ? (amounts[cashMethod.id] ?? 0) : 0
  const cashDiff = cashOpen && cashCounted !== null ? cashSold - cashCounted : 0
  const methodsError = errorOf('methods')

  const submitLabel = posting.pending
    ? 'Guardando…'
    : `Guardar cierre del ${dayLabel}${sold > 0 ? ` · ${moneyLabel(sold)}` : ''}`

  return (
    <>
      {existing.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-pretty">
              {existing.length === 1
                ? `El cierre del ${dayLabel} ya está cargado: ${formatCents(totalExisting)}.`
                : `El ${dayLabel} ya tiene ${existing.length} cierres: ${formatCents(totalExisting)} en total.`}{' '}
              Para corregirlo, abrilo y anulalo; después cargalo de nuevo.
            </p>
            <div className="flex flex-wrap gap-2">
              {existing.map((c) => (
                <Button key={c.id} asChild variant="outline" size="sm" className="h-11 md:h-8">
                  <Link href={`${base}/comprobantes/${c.id}`}>
                    {existing.length === 1
                      ? 'Ver el cierre'
                      : `${c.title} · ${moneyLabel(c.totalCents)}`}
                  </Link>
                </Button>
              ))}
              {showForm ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 md:h-8"
                  onClick={() => setShowForm(true)}
                >
                  <Plus className="size-4" aria-hidden />
                  Cargar otro turno
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
        >
          <div className="space-y-6">
            {needsShift ? (
              <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
                <Field
                  id={`${id}-shift`}
                  label="Turno"
                  required
                  hint="Para distinguirlo del cierre que ya está cargado."
                  error={errorOf('shift')}
                >
                  <Input
                    id={`${id}-shift`}
                    value={shift}
                    maxLength={20}
                    autoComplete="off"
                    placeholder="Por ejemplo: noche"
                    className="h-11 text-base md:h-10 md:text-sm"
                    aria-invalid={errorOf('shift') ? true : undefined}
                    aria-describedby={describedBy(`${id}-shift`, {
                      hint: true,
                      error: errorOf('shift'),
                    })}
                    onChange={(e) => {
                      setShift(e.target.value)
                      clear('shift')
                    }}
                  />
                </Field>
              </div>
            ) : null}

            {/* ── Lo vendido ── */}
            <section
              aria-labelledby={`${id}-sold`}
              className="card-hairline grid gap-5 rounded-xl border bg-card p-6"
            >
              <div className="space-y-1">
                <h2 id={`${id}-sold`} className="font-serif text-lg font-semibold tracking-tight">
                  Lo vendido
                </h2>
                <p className="text-xs text-muted-foreground">
                  Un importe por medio, como en Thinkeon. Si pegás la columna entera en el primero,
                  se reparte sola hacia abajo.
                </p>
              </div>

              <div className="grid gap-4">
                {methods.map((m) => {
                  const inputId = `${id}-m-${m.id}`
                  if (m.kind === 'customer_account') {
                    const list = accounts[m.id] ?? []
                    const subtotal = list.reduce((sum, r) => sum + (r.amount ?? 0), 0)
                    const listError = methodError(m.id, 'customers')
                    return (
                      <div key={m.id} className="grid gap-3 border-t border-border/60 pt-4">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{m.name}</p>
                            <p className="text-xs text-muted-foreground">{m.destination}</p>
                          </div>
                          <span className="text-sm font-medium tabular-nums">
                            {subtotal > 0 ? formatCents(subtotal) : '—'}
                          </span>
                        </div>
                        {list.map((r, j) => {
                          const index = methodIndex.get(m.id) ?? -1
                          const partyError = errorOf(`methods.${index}.customers.${j}.partyId`)
                          const amountError = errorOf(`methods.${index}.customers.${j}.amountCents`)
                          return (
                            <div
                              key={r.key}
                              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start"
                            >
                              <div className="grid gap-1">
                                <PartyCombobox
                                  value={r.partyId}
                                  onValueChange={(next) =>
                                    patchAccount(m.id, r.key, { partyId: next })
                                  }
                                  parties={customerOptions}
                                  placeholder="Elegí el cliente"
                                  onCreate={(name) =>
                                    setCreating({
                                      name,
                                      requireCuit: false,
                                      apply: (partyId) => patchAccount(m.id, r.key, { partyId }),
                                    })
                                  }
                                  invalid={Boolean(partyError)}
                                  aria-label={`Cliente ${j + 1} de ${m.name}`}
                                />
                                {partyError ? (
                                  <p role="alert" className="text-xs text-destructive">
                                    {partyError}
                                  </p>
                                ) : null}
                              </div>
                              <div className="grid gap-1">
                                <MoneyInput
                                  value={r.amount}
                                  onValueChange={(cents) =>
                                    patchAccount(m.id, r.key, { amount: cents })
                                  }
                                  align="end"
                                  invalid={Boolean(amountError)}
                                  aria-label={`Importe del cliente ${j + 1} de ${m.name}`}
                                />
                                {amountError ? (
                                  <p role="alert" className="text-xs text-destructive">
                                    {amountError}
                                  </p>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-11 justify-self-end text-muted-foreground md:size-9"
                                aria-label={`Quitar el cliente ${j + 1} de ${m.name}`}
                                onClick={() => removeAccount(m.id, r.key)}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          )
                        })}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 w-fit gap-1.5 md:h-8"
                          onClick={() => addAccount(m.id)}
                        >
                          <Plus className="size-4" aria-hidden />
                          Agregar cliente
                        </Button>
                        {listError ? (
                          <p role="alert" className="text-xs text-destructive">
                            {listError}
                          </p>
                        ) : null}
                      </div>
                    )
                  }
                  const amountError = methodError(m.id, 'amountCents')
                  return (
                    <div
                      key={m.id}
                      className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start sm:gap-x-4"
                    >
                      <div className="min-w-0 sm:pt-2">
                        <Label htmlFor={inputId}>{m.name}</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span aria-hidden="true">→ </span>
                          {m.destination}
                        </p>
                      </div>
                      <div className="grid gap-1">
                        <MoneyInput
                          id={inputId}
                          value={amounts[m.id] ?? null}
                          onValueChange={(cents) => setAmount(m.id, cents)}
                          onPaste={(e) => onMethodPaste(e, m.id)}
                          align="end"
                          invalid={Boolean(amountError)}
                          aria-describedby={amountError ? `${inputId}-error` : undefined}
                        />
                        {amountError ? (
                          <p
                            id={`${inputId}-error`}
                            role="alert"
                            className="text-xs text-destructive"
                          >
                            {amountError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>

              {pasteError ? (
                <p role="alert" className="text-xs text-destructive">
                  {pasteError}
                </p>
              ) : null}
              {methodsError ? (
                <p role="alert" className="text-xs text-destructive">
                  {methodsError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-4">
                <span className="text-sm text-muted-foreground">Total vendido</span>
                <span className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                  {formatCents(sold)}
                </span>
                {channelLines.length > 1 ? (
                  <p className="w-full text-right text-xs text-muted-foreground tabular-nums">
                    {channelLines
                      .filter((c) => c.soldCents !== 0)
                      .map((c) => `${CHANNEL_LABELS[c.channel]} ${moneyLabel(c.soldCents)}`)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <MoneyField
                  label="Total según Thinkeon"
                  optional
                  value={control}
                  onValueChange={(cents) => {
                    setControl(cents)
                    clear('controlTotalCents')
                  }}
                  hint={
                    control === null
                      ? 'Para controlar que no falte ningún medio.'
                      : control === sold
                        ? 'Coincide con lo cargado.'
                        : `No coincide: lo cargado suma ${formatCents(sold)}.`
                  }
                  error={errorOf('controlTotalCents')}
                />
              </div>
            </section>

            {/* ── Lo facturado ── */}
            <section
              aria-labelledby={`${id}-invoiced`}
              className="card-hairline grid gap-5 rounded-xl border bg-card p-6"
            >
              <div className="space-y-1">
                <h2
                  id={`${id}-invoiced`}
                  className="font-serif text-lg font-semibold tracking-tight"
                >
                  Lo facturado
                </h2>
                <p className="text-xs text-muted-foreground">
                  Un rango por tipo y punto de venta. El «desde» ya viene puesto: escribí el «hasta»
                  y el total. Si pegás «0003-00014501 a 0003-00014662» en el «hasta», se completa
                  solo.
                </p>
              </div>

              {salesPoints.length === 0 ? (
                <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  <p className="text-pretty">
                    Para cargar lo facturado, primero cargá tus puntos de venta en{' '}
                    <Link
                      href={`${base}/ajustes?tab=puntos-de-venta`}
                      className="font-medium underline underline-offset-4"
                    >
                      Ajustes › Puntos de venta
                    </Link>
                    . Si hoy no facturaste, guardá el cierre igual.
                  </p>
                </div>
              ) : (
                <>
                  {rows.map((row, index) => {
                    const rid = `${id}-r-${row.key}`
                    const total = row.total
                    const net =
                      total !== null && row.rate !== 0 ? netFromGross(total, row.rate) : null
                    const count =
                      numberOrNull(row.from) !== null &&
                      numberOrNull(row.to) !== null &&
                      (numberOrNull(row.to) ?? 0) >= (numberOrNull(row.from) ?? 0)
                        ? (numberOrNull(row.to) ?? 0) - (numberOrNull(row.from) ?? 0) + 1
                        : null
                    return (
                      <div
                        key={row.key}
                        className={cn(
                          'grid gap-4 rounded-lg border border-border/60 p-4',
                          !rowCounts(row) && 'bg-muted/20',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">
                            {voucherLabel(row.voucherType)}
                            {row.pointOfSale !== null
                              ? ` · PV ${String(row.pointOfSale).padStart(4, '0')}`
                              : ''}
                          </p>
                          {row.manual || rows.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11 text-muted-foreground md:size-9"
                              aria-label={`Quitar la fila ${index + 1}`}
                              onClick={() => removeRow(row.key)}
                            >
                              <X className="size-4" />
                            </Button>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <Field
                            id={`${rid}-type`}
                            label="Comprobante"
                            error={rowError(row, 'voucherType')}
                          >
                            <Select
                              value={row.voucherType}
                              onValueChange={(v) => {
                                if (isCloseVoucher(v)) changeRowSeries(row, { voucherType: v })
                              }}
                            >
                              <SelectTrigger
                                id={`${rid}-type`}
                                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VOUCHERS.map((v) => (
                                  <SelectItem key={v} value={v} className="min-h-11 md:min-h-8">
                                    {voucherLabel(v)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field
                            id={`${rid}-pos`}
                            label="Punto de venta"
                            error={rowError(row, 'pointOfSale')}
                          >
                            <Select
                              value={row.pointOfSale === null ? '' : String(row.pointOfSale)}
                              onValueChange={(v) => {
                                changeRowSeries(row, { pointOfSale: Number(v) })
                                clear(`invoiced.${rowIndex.get(row.key) ?? -1}.pointOfSale`)
                              }}
                            >
                              <SelectTrigger
                                id={`${rid}-pos`}
                                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                                aria-invalid={rowError(row, 'pointOfSale') ? true : undefined}
                              >
                                <SelectValue placeholder="Elegí" />
                              </SelectTrigger>
                              <SelectContent>
                                {salesPoints.map((p) => (
                                  <SelectItem
                                    key={p.number}
                                    value={String(p.number)}
                                    className="min-h-11 md:min-h-8"
                                  >
                                    {String(p.number).padStart(4, '0')} · {p.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field
                            id={`${rid}-from`}
                            label="Desde"
                            error={rowError(row, 'numberFrom')}
                          >
                            <Input
                              id={`${rid}-from`}
                              value={row.from}
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={8}
                              placeholder="00014501"
                              className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                              aria-invalid={rowError(row, 'numberFrom') ? true : undefined}
                              onPaste={(e) => onRangePaste(e, row, 'from')}
                              onChange={(e) => {
                                patchRow(row.key, { from: digits(e.target.value), fromAuto: false })
                                clear(`invoiced.${rowIndex.get(row.key) ?? -1}.numberFrom`)
                              }}
                            />
                          </Field>
                          <Field
                            id={`${rid}-to`}
                            label="Hasta"
                            hint={
                              count !== null
                                ? plural(count, 'comprobante', 'comprobantes')
                                : undefined
                            }
                            error={rowError(row, 'numberTo')}
                          >
                            <Input
                              id={`${rid}-to`}
                              value={row.to}
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={40}
                              placeholder="00014662"
                              className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                              aria-invalid={rowError(row, 'numberTo') ? true : undefined}
                              aria-describedby={describedBy(`${rid}-to`, {
                                hint: count !== null,
                                error: rowError(row, 'numberTo'),
                              })}
                              onPaste={(e) => onRangePaste(e, row, 'to')}
                              onChange={(e) => {
                                patchRow(row.key, { to: digits(e.target.value) })
                                clear(`invoiced.${rowIndex.get(row.key) ?? -1}.numberTo`)
                              }}
                            />
                          </Field>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
                          <MoneyField
                            label={
                              isCreditNote(row.voucherType)
                                ? 'Total de las notas (con IVA)'
                                : 'Total (con IVA)'
                            }
                            value={total}
                            onValueChange={(cents) => {
                              patchRow(row.key, { total: cents })
                              clear(`invoiced.${rowIndex.get(row.key) ?? -1}.totalCents`)
                            }}
                            hint={
                              total !== null && net !== null
                                ? `Neto ${formatCents(net)} · IVA ${vatRateLabel(row.rate)} ${formatCents(total - net)}`
                                : undefined
                            }
                            error={rowError(row, 'totalCents')}
                          />
                          <Field id={`${rid}-rate`} label="Alícuota">
                            <Select
                              value={String(row.rate)}
                              onValueChange={(v) =>
                                patchRow(row.key, { rate: Number(v) as VatRateBp })
                              }
                            >
                              <SelectTrigger
                                id={`${rid}-rate`}
                                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {RATES.map((r) => (
                                  <SelectItem
                                    key={r}
                                    value={String(r)}
                                    className="min-h-11 md:min-h-8"
                                  >
                                    {vatRateLabel(r)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field
                            id={`${rid}-channel`}
                            label="Canal"
                            error={rowError(row, 'channel')}
                          >
                            <Select
                              value={row.channel}
                              onValueChange={(v) => patchRow(row.key, { channel: v as Channel })}
                            >
                              <SelectTrigger
                                id={`${rid}-channel`}
                                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CHANNELS.map((c) => (
                                  <SelectItem key={c} value={c} className="min-h-11 md:min-h-8">
                                    {CHANNEL_LABELS[c]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>

                        {isLetterA(row.voucherType) ? (
                          <Field
                            id={`${rid}-party`}
                            label="Cliente"
                            required
                            hint="Las A van con el CUIT del cliente."
                            error={rowError(row, 'partyId')}
                          >
                            <PartyCombobox
                              id={`${rid}-party`}
                              value={row.partyId}
                              onValueChange={(next) => {
                                patchRow(row.key, { partyId: next })
                                clear(`invoiced.${rowIndex.get(row.key) ?? -1}.partyId`)
                              }}
                              parties={customerOptions}
                              placeholder="Elegí el cliente"
                              onCreate={(name) =>
                                setCreating({
                                  name,
                                  requireCuit: true,
                                  apply: (partyId) => patchRow(row.key, { partyId }),
                                })
                              }
                              invalid={Boolean(rowError(row, 'partyId'))}
                              aria-describedby={describedBy(`${rid}-party`, {
                                hint: true,
                                error: rowError(row, 'partyId'),
                              })}
                            />
                          </Field>
                        ) : null}
                      </div>
                    )
                  })}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 gap-1.5 md:h-8"
                      onClick={() => addRow('factura_b')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Factura B
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 gap-1.5 md:h-8"
                      onClick={() => addRow('factura_a')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Factura A
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 gap-1.5 md:h-8"
                      onClick={() => addRow('nota_credito_b')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Nota de crédito
                    </Button>
                  </div>
                </>
              )}

              {channelLines.length > 0 ? (
                <ul className="grid gap-1 border-t border-border/60 pt-4 text-sm">
                  {channelLines.map((c) => (
                    <li
                      key={c.channel}
                      className="flex flex-wrap justify-between gap-x-3 tabular-nums"
                    >
                      <span className="font-medium">{CHANNEL_LABELS[c.channel]}</span>
                      <span className="text-muted-foreground">
                        vendido {moneyLabel(c.soldCents)} · facturado{' '}
                        {moneyLabel(c.invoicedTotalCents)} ·{' '}
                        {c.uninvoicedCents < 0 ? (
                          <span className="text-warning-text">
                            facturado de más {moneyLabel(-c.uninvoicedCents)}
                          </span>
                        ) : (
                          `sin factura ${moneyLabel(c.uninvoicedCents)}`
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* ── Efectivo ── */}
            {cashMethod ? (
              <section
                aria-labelledby={`${id}-cash`}
                className="card-hairline grid gap-4 rounded-xl border bg-card p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`${id}-cash`} className="font-serif text-lg font-semibold tracking-tight">
                    Efectivo
                  </h2>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 text-xs"
                    aria-expanded={cashOpen}
                    onClick={() => {
                      setCashOpen(!cashOpen)
                      clear('cashCountedCents')
                    }}
                  >
                    {cashOpen ? 'Contaste lo mismo' : '¿Contaste otra cosa?'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Según Thinkeon: <span className="tabular-nums">{formatCents(cashSold)}</span>
                </p>
                {cashOpen ? (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <MoneyField
                      label="Efectivo contado"
                      value={cashCounted}
                      onValueChange={(cents) => {
                        setCashCounted(cents)
                        clear('cashCountedCents')
                      }}
                      hint={
                        cashCounted === null
                          ? 'Si pagaste algo con la plata de la caja, cargalo como gasto pagado con Caja; no lo restes acá.'
                          : cashDiff > 0
                            ? `Faltan ${formatCents(cashDiff)}: va a faltante de caja.`
                            : cashDiff < 0
                              ? `Sobran ${formatCents(-cashDiff)}: va a sobrante de caja.`
                              : 'Coincide con lo vendido.'
                      }
                      error={errorOf('cashCountedCents')}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            <FormBanner banner={posting.banner} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`${base}/ventas`}>Cancelar</Link>
              </Button>
              <Button
                type="submit"
                className="h-11 min-w-[220px] md:h-9"
                disabled={posting.pending}
              >
                {submitLabel}
              </Button>
            </div>
            {afterSaveLabel ? (
              <p className="text-right text-xs text-muted-foreground">
                Después sigue el del {afterSaveLabel}.
              </p>
            ) : null}
          </div>

          <aside className="lg:sticky lg:top-20">
            <EntryPreview entries={shown} />
          </aside>
        </form>
      ) : null}

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={(extra) =>
          posting.confirmWarnings(extra.reason ? { overrideReason: extra.reason } : undefined)
        }
      />
      <QuickPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        kind="customer"
        initialName={creating?.name ?? ''}
        requireCuit={creating?.requireCuit ?? false}
        onCreated={(created) => {
          creating?.apply(created.id)
          setCreating(null)
          // El cliente nuevo tiene que estar en el contexto de la vista previa.
          router.refresh()
        }}
      />
    </>
  )
}
