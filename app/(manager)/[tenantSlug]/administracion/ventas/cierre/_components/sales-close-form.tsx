'use client'

import { ExternalLink, Plus, X } from 'lucide-react'
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
import { toast } from 'sonner'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { describedBy, Field } from '@/components/administracion/cajas-ventas/field'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { QuickPartyDialog } from '@/components/administracion/cajas-ventas/quick-party-dialog'
import { useDocumentPreview } from '@/components/administracion/cajas-ventas/sheet-frame'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { plural } from '@/components/administracion/format'
import { StatusPill } from '@/components/administracion/kit'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import {
  Planilla,
  PlanillaFoot,
  PlanillaTitle,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
} from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
import { MAX_CENTS } from '@/lib/accounting/schemas'
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
import { MoneyCell } from '../../_components/money-cell'
import {
  type CloseMethodGroup,
  closeTaxView,
  controlCheck,
  groupCloseMethods,
  invoiceSplit,
} from '../_lib/close-view'
import {
  BooksPreview,
  ChannelBreakdown,
  CloseFold,
  ControlResult,
  ExistingCloses,
} from './close-pieces'
import { type CloseMercadoPago, MpCloseFill } from './mp-close-fill'

// ─── Lo que arma la página ───────────────────────────────────────────────────

export type CloseMethod = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  /** La columna «Entró a»: «Caja», «Mercado Pago», «Tarjetas de débito (Posnet)». */
  entersTo: string
  /** «Entra a Caja», «Llega el jue 08/10»: adónde va lo cobrado, en palabras. */
  destination: string
  /** El efectivo (el que se puede contar): lleva «Efectivo contado». */
  isCash: boolean
  // Lo que sigue es solo de pantalla (no entra en lo que se manda).
  /** Con qué otros medios se muestra: de dónde sale el número. */
  group: CloseMethodGroup
  /** Quién lo paga después («Tarjetas de débito (Posnet)»), para cuando hay lugar. */
  payer: string | null
  /** Es de Mercado Pago: su grupo se titula así. */
  mercadoPago: boolean
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

/** Cómo se llama cada grupo de medios y de dónde saca la persona ese número. */
const GROUP_META: Readonly<Record<CloseMethodGroup, { title: string; hint: string }>> = {
  cash: { title: 'Efectivo', hint: 'Lo que se cobró en billetes.' },
  wallet: { title: 'Billeteras y transferencias', hint: 'QR y transferencias.' },
  cards: { title: 'Tarjetas', hint: 'El cierre de lote del posnet.' },
  delivery: { title: 'Apps de delivery', hint: 'Lo que dice cada app.' },
  account: { title: 'Cuenta corriente', hint: 'Lo anotado a un cliente.' },
  advance: { title: 'Señas', hint: 'Pagado con una seña ya cobrada.' },
}

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
 * Cierre del día (H.9): lo vendido por medio de cobro, lo facturado por rango y el efectivo contado.
 * La vista previa («Ver el asiento») se arma en el navegador con el mismo código que corre la acción,
 * y al guardar queda «Deshacer» 6 s.
 *
 * Desde noviembre de 2026 es una pantalla de tarea, como lo que ya conocen de un sistema tradicional:
 * a la izquierda una planilla, un renglón por medio, y lo que casi no se usa plegado debajo; a la
 * derecha, lo que se calcula solo. El estado, las validaciones y lo que se manda son los de siempre:
 * cambió cómo se ve.
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
  mercadoPago,
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
  /** «Completar con Mercado Pago» (QR y transferencias). `null`: no se ofrece. */
  mercadoPago: CloseMercadoPago | null
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
  // Sin importe contado viaja `null`: es lo mismo que no haber contado la caja.
  const [cashCounted, setCashCounted] = useState<number | null>(null)
  const [control, setControl] = useState<number | null>(null)
  const [shift, setShift] = useState('')
  const [showForm, setShowForm] = useState(existing.length === 0)
  const [attempted, setAttempted] = useState(false)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  // Solo de pantalla: el diálogo para pegar la columna, cuando no se pudo leer el portapapeles.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  // Solo de pantalla: lo plegado. `null` en los rangos: todavía nadie lo tocó y decide la pantalla.
  const [rangesOpen, setRangesOpen] = useState<boolean | null>(null)
  const [mpOpen, setMpOpen] = useState(false)
  const [controlOpen, setControlOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState<Record<string, boolean>>({})
  // Solo de pantalla: qué filas de «¿Qué facturaste?» tienen a la vista lo que casi nunca
  // cambia (comprobante, punto de venta, IVA y canal). Sin entrada: abiertas las que
  // agregó la persona.
  const [rowDetails, setRowDetails] = useState<Record<number, boolean>>({})
  // Solo de pantalla: el error de lectura de un importe («12,3,4x»), que `MoneyInput`
  // avisa al salir del campo. No entra en la validación ni en lo que se manda.
  const [readErrors, setReadErrors] = useState<Record<string, string | null>>({})
  const readHandlers = useRef(new Map<string, (error: string | null) => void>())
  /** El mismo manejador en cada render: `MoneyInput` lo vuelve a llamar si cambia. */
  const readErrorHandler = (key: string) => {
    const known = readHandlers.current.get(key)
    if (known) return known
    const handler = (error: string | null) =>
      setReadErrors((prev) => ((prev[key] ?? null) === error ? prev : { ...prev, [key]: error }))
    readHandlers.current.set(key, handler)
    return handler
  }

  const needsShift = existing.length > 0
  const cashMethod = methods.find((m) => m.isCash) ?? null
  const simpleMethods = methods.filter((m) => m.kind !== 'customer_account')

  const methodNames = useMemo(() => new Map(methods.map((m) => [m.id, m.name])), [methods])

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
      cashCountedCents: cashMethod ? cashCounted : null,
      controlTotalCents: control,
      overrideReason: null,
      instantSettlements: [],
    }),
    [date, needsShift, shift, methodValues, included, cashMethod, cashCounted, control],
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

  /** Lo que trajo «Completar con Mercado Pago» (QR y transferencias). */
  function applyMercadoPago(fills: Readonly<Record<string, number | null>>) {
    setAmounts((prev) => ({ ...prev, ...fills }))
    for (const methodId of Object.keys(fills)) {
      clear(`methods.${methodIndex.get(methodId) ?? -1}.amountCents`)
    }
    clear('methods')
  }

  /** Una columna de Thinkeon se reparte hacia abajo desde el medio `start`, en el orden de Ajustes (H.9). */
  function applyColumn(text: string, start: number) {
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
    return parsed.values.filter((cents) => cents !== null).length
  }

  /** Pegar en el importe de un medio reparte desde ese medio. */
  function onMethodPaste(event: ClipboardEvent<HTMLInputElement>, methodId: string) {
    const text = event.clipboardData.getData('text')
    if (!isPastedColumn(text)) return
    event.preventDefault()
    applyColumn(
      text,
      simpleMethods.findIndex((m) => m.id === methodId),
    )
  }

  /**
   * «Pegar la columna de Thinkeon»: lo que ya está copiado se reparte de un toque. Si el navegador no
   * deja leer el portapapeles, o lo copiado no es una columna, se abre el lugar donde pegarla.
   */
  async function pasteColumn() {
    try {
      const text = await navigator.clipboard.readText()
      if (isPastedColumn(text)) {
        const loaded = applyColumn(text, 0)
        toast.success(`Se repartieron ${plural(loaded, 'importe', 'importes')}.`)
        return
      }
    } catch {
      // Sin permiso para leer el portapapeles: se pega a mano.
    }
    setPasteText('')
    setPasteOpen(true)
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
      <Planilla>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="min-w-0 text-sm text-pretty">
            <span className="font-medium">Primero decime cómo cobrás.</span> No hay medios de cobro
            activos: activá los que usás (efectivo, débito, Mercado Pago…) y volvé a cargar el
            cierre.
          </p>
          <Button asChild size="sm" className="pointer-coarse:h-10">
            <Link href={`${base}/ajustes?tab=medios`}>Ir a Medios de cobro</Link>
          </Button>
        </div>
      </Planilla>
    )
  }

  const cashSold = cashMethod ? (amounts[cashMethod.id] ?? 0) : 0
  const cashDiff = cashCounted !== null ? cashSold - cashCounted : 0
  const methodsError = errorOf('methods')

  const submitLabel = posting.pending
    ? 'Guardando…'
    : `Cargar cierre${sold > 0 ? ` · ${moneyLabel(sold)}` : ''}`

  // ── Solo para mostrar: nada de lo que sigue entra en lo que se manda ──
  const groups = groupCloseMethods(methods)
  const split = summary ? invoiceSplit(sold, summary.channels) : null
  const invoicedAny = included.some((r) => r.total !== null)
  // Sin puntos de venta todo el día queda sin factura (siempre); con puntos de venta,
  // recién se sabe cuando la persona anotó algo en «¿Qué facturaste?».
  const invoiceAsked = salesPoints.length === 0 || invoicedAny
  // El total del sistema de caja contra lo cargado: si no coincide, el cierre no se guarda.
  const check = controlCheck(control, sold)
  const controlOff = check.kind === 'short' || check.kind === 'over'
  // Listo para guardar: hay ventas y nada a la vista lo frena.
  const ready = sold > 0 && !controlOff
  const taxes = summary
    ? closeTaxView({
        invoiced: included
          .filter((r) => r.total !== null)
          .map((r) => ({
            totalCents: r.total ?? 0,
            vatRateBp: r.rate,
            creditNote: isCreditNote(r.voucherType),
          })),
        invoicedNetCents: summary.channels.reduce((sum, c) => sum + c.invoicedNetCents, 0),
        uninvoicedCents: summary.channels.reduce((sum, c) => sum + c.uninvoicedCents, 0),
        settings: ctx.settings.taxSettings,
      })
    : null

  // Lo que dice «Ver el asiento» mientras no hay nada que mostrar, y por qué.
  const booksEmptyText =
    sold <= 0
      ? 'Cargá los importes y acá vas a ver el asiento.'
      : controlOff
        ? 'Se ve cuando el total de tu sistema de caja coincida con lo que cargaste.'
        : 'Todavía falta completar algo: al guardar te marcamos qué.'

  // Con una sola fila, «Con factura» es el total de esa fila; con varias, la suma de los rangos.
  const onlyRow = rows.length === 1 ? (rows[0] ?? null) : null
  const anyRowError = included.some((row) =>
    [
      'voucherType',
      'pointOfSale',
      'channel',
      'numberFrom',
      'numberTo',
      'totalCents',
      'partyId',
    ].some((field) => rowError(row, field) !== null),
  )
  // Se abre sola cuando hace falta: hay más de una fila, se anotó un total (falta el rango) o hay un
  // error adentro. Plegada, un error no se vería.
  const showRanges = anyRowError || (rangesOpen ?? (rows.length > 1 || invoicedAny))
  const showControl = controlOpen || controlOff || errorOf('controlTotalCents') !== null

  /** Un renglón de la planilla: el medio, a dónde va la plata y su importe. */
  const methodRow = (m: CloseMethod, hint: string) => {
    const inputId = `${id}-m-${m.id}`
    // El error del motor gana; si no hay, el de lectura (un importe que no se entiende).
    const amountError = methodError(m.id, 'amountCents') ?? readErrors[m.id] ?? null
    return (
      <PRow key={m.id}>
        <PTd>
          <Label htmlFor={inputId} title={hint} className="font-medium leading-snug">
            {m.name}
          </Label>
        </PTd>
        <PTd className="text-muted-foreground">
          {m.entersTo}
          {m.destination.startsWith('Entra a') ? null : (
            <small className="block text-xs">{m.destination}</small>
          )}
        </PTd>
        <PTd align="right">
          <MoneyCell
            id={inputId}
            value={amounts[m.id] ?? null}
            maxCents={MAX_CENTS}
            onValueChange={(cents) => setAmount(m.id, cents)}
            onPaste={(e) => onMethodPaste(e, m.id)}
            invalid={Boolean(amountError)}
            aria-describedby={amountError ? `${inputId}-error` : undefined}
            onErrorChange={readErrorHandler(m.id)}
          />
          {amountError ? (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="mt-1 whitespace-normal text-xs text-destructive"
            >
              {amountError}
            </p>
          ) : null}
        </PTd>
      </PRow>
    )
  }

  /** Cuenta corriente: el renglón suma lo de cada cliente, y los clientes se abren debajo. */
  const accountRow = (m: CloseMethod, hint: string) => {
    const list = accounts[m.id] ?? []
    const subtotal = list.reduce((sum, r) => sum + (r.amount ?? 0), 0)
    const index = methodIndex.get(m.id) ?? -1
    const listError = methodError(m.id, 'customers')
    const hasError =
      listError !== null ||
      list.some(
        (_, j) =>
          errorOf(`methods.${index}.customers.${j}.partyId`) !== null ||
          errorOf(`methods.${index}.customers.${j}.amountCents`) !== null,
      )
    const open = hasError || (accountsOpen[m.id] ?? list.length > 0)
    return [
      <PRow key={m.id}>
        <PTd>
          <span title={hint} className="text-sm font-medium leading-snug">
            {m.name}
          </span>
        </PTd>
        <PTd className="text-muted-foreground">
          {m.entersTo}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              if (!open && list.length === 0) addAccount(m.id)
              setAccountsOpen((prev) => ({ ...prev, [m.id]: !open }))
            }}
            className="block rounded-sm text-xs font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-8"
          >
            {list.length > 0 ? plural(list.length, 'cliente', 'clientes') : 'Elegir a qué clientes'}
          </button>
        </PTd>
        <PTd align="right" className="font-medium">
          {subtotal > 0 ? (
            formatCents(subtotal)
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </PTd>
      </PRow>,
      open ? (
        <tr key={`${m.id}-clientes`} className="border-b border-border/60 bg-secondary/30">
          <td colSpan={3} className="@container px-3 py-3">
            <div className="grid gap-3">
              {list.map((r, j) => {
                const partyError = errorOf(`methods.${index}.customers.${j}.partyId`)
                const amountError =
                  errorOf(`methods.${index}.customers.${j}.amountCents`) ??
                  readErrors[`cc-${r.key}`] ??
                  null
                return (
                  <div
                    key={r.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @min-[26rem]:grid-cols-[minmax(0,1fr)_11rem_auto] @min-[26rem]:items-start"
                  >
                    <div className="col-span-2 grid gap-1 @min-[26rem]:col-span-1">
                      <PartyCombobox
                        value={r.partyId}
                        onValueChange={(next) => patchAccount(m.id, r.key, { partyId: next })}
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
                        onValueChange={(cents) => patchAccount(m.id, r.key, { amount: cents })}
                        decimals="auto"
                        align="end"
                        invalid={Boolean(amountError)}
                        aria-label={`Importe del cliente ${j + 1} de ${m.name}`}
                        onErrorChange={readErrorHandler(`cc-${r.key}`)}
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
                className="w-fit gap-1.5 pointer-coarse:h-10"
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
          </td>
        </tr>
      ) : null,
    ]
  }

  /** Una fila de «¿Qué facturaste?»: comprobante y punto de venta, desde, hasta y total. */
  const invoiceRow = (row: RangeRow, index: number) => {
    const rid = `${id}-r-${row.key}`
    const total = row.total
    const net = total !== null && row.rate !== 0 ? netFromGross(total, row.rate) : null
    const count =
      numberOrNull(row.from) !== null &&
      numberOrNull(row.to) !== null &&
      (numberOrNull(row.to) ?? 0) >= (numberOrNull(row.from) ?? 0)
        ? (numberOrNull(row.to) ?? 0) - (numberOrNull(row.from) ?? 0) + 1
        : null
    const counts = rowCounts(row)
    // Lo fijo de la fila, dicho en el título: el punto de venta con el nombre
    // que le pusieron, el IVA y, si no es el de ese punto de venta, el canal.
    const point = salesPoints.find((p) => p.number === row.pointOfSale) ?? null
    const channelName = CHANNEL_LABELS[row.channel] ?? row.channel
    const fixed = [
      row.pointOfSale === null
        ? 'sin punto de venta'
        : `${String(row.pointOfSale).padStart(4, '0')}${point ? ` · ${point.label}` : ''}`,
      `IVA ${vatRateLabel(row.rate)}`,
      point && point.label.trim().toLowerCase() === channelName.toLowerCase()
        ? null
        : `canal ${channelName.toLowerCase()}`,
    ].filter((part): part is string => part !== null)
    // Lo que casi nunca cambia va plegado detrás de «Cambiar». Se abre solo si
    // la fila la agregó la persona, le falta el punto de venta o hay un error ahí.
    const fixedError =
      rowError(row, 'voucherType') ?? rowError(row, 'pointOfSale') ?? rowError(row, 'channel')
    const forcedOpen = fixedError !== null || row.pointOfSale === null
    const fixedOpen = forcedOpen || (rowDetails[row.key] ?? row.manual)
    // El pie de la fila: qué se guarda de ella, o que no se guarda.
    const facts = [
      count !== null ? plural(count, 'comprobante', 'comprobantes') : null,
      total !== null && net !== null
        ? `Neto ${formatCents(net)} + IVA ${formatCents(total - net)}`
        : null,
    ].filter((part): part is string => part !== null)
    return (
      <div key={row.key} className="grid gap-3 border-b border-border/60 py-3 first:pt-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 py-1 text-sm leading-snug font-semibold text-pretty">
            {voucherLabel(row.voucherType)}
            <span className="font-normal text-muted-foreground">
              {fixed.map((part) => ` · ${part}`).join('')}
            </span>
          </p>
          <div className="-my-1.5 -mr-1.5 flex shrink-0 items-center">
            {forcedOpen ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 px-2.5 text-muted-foreground md:h-9"
                aria-expanded={fixedOpen}
                aria-controls={`${rid}-fixed`}
                onClick={() => setRowDetails((prev) => ({ ...prev, [row.key]: !fixedOpen }))}
              >
                {fixedOpen ? 'Listo' : 'Cambiar'}
                <span className="sr-only">
                  {' '}
                  comprobante, punto de venta, IVA y canal de la fila {index + 1}
                </span>
              </Button>
            )}
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
        </div>

        {/* Plegados, los cuatro combos no se dibujan: su valor vive en `rows`
            (no en el combo), así que no se pierde nada, y Enter pasa derecho
            de un «total» al «desde» de la fila que sigue en vez de trabarse en
            un campo que no se ve. Los combos largos van de a uno por renglón
            en angosto. */}
        <div id={`${rid}-fixed`} hidden={!fixedOpen} className="grid grid-cols-2 gap-3">
          {fixedOpen ? (
            <>
              <Field
                id={`${rid}-type`}
                label="Comprobante"
                error={rowError(row, 'voucherType')}
                className="col-span-2 @min-[30rem]:col-span-1"
              >
                <Select
                  value={row.voucherType}
                  onValueChange={(v) => {
                    if (isCloseVoucher(v)) changeRowSeries(row, { voucherType: v })
                  }}
                >
                  <SelectTrigger
                    id={`${rid}-type`}
                    className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
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
                className="col-span-2 @min-[30rem]:col-span-1"
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
                    className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
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
              <Field id={`${rid}-rate`} label="IVA">
                <Select
                  value={String(row.rate)}
                  onValueChange={(v) => patchRow(row.key, { rate: Number(v) as VatRateBp })}
                >
                  <SelectTrigger
                    id={`${rid}-rate`}
                    className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATES.map((r) => (
                      <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                        {vatRateLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`${rid}-channel`} label="Canal" error={rowError(row, 'channel')}>
                <Select
                  value={row.channel}
                  onValueChange={(v) => patchRow(row.key, { channel: v as Channel })}
                >
                  <SelectTrigger
                    id={`${rid}-channel`}
                    className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
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
            </>
          ) : null}
        </div>

        {/* Lo de todos los días: desde, hasta y total. En un renglón si entra. */}
        <div className="grid grid-cols-2 gap-3 @min-[34rem]:grid-cols-[minmax(0,8rem)_minmax(0,8rem)_minmax(0,1fr)]">
          <Field id={`${rid}-from`} label="Desde" error={rowError(row, 'numberFrom')}>
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
          <Field id={`${rid}-to`} label="Hasta" error={rowError(row, 'numberTo')}>
            <Input
              id={`${rid}-to`}
              value={row.to}
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              // Con el «desde» puesto, un ejemplo más chico que ese número confunde.
              placeholder={row.from ? undefined : '00014662'}
              className="h-11 text-base tabular-nums md:h-10 md:text-sm"
              aria-invalid={rowError(row, 'numberTo') ? true : undefined}
              aria-describedby={describedBy(`${rid}-to`, { error: rowError(row, 'numberTo') })}
              onPaste={(e) => onRangePaste(e, row, 'to')}
              onChange={(e) => {
                patchRow(row.key, { to: digits(e.target.value) })
                clear(`invoiced.${rowIndex.get(row.key) ?? -1}.numberTo`)
              }}
            />
          </Field>
          <MoneyField
            label={
              isCreditNote(row.voucherType) ? 'Total de las notas (con IVA)' : 'Total (con IVA)'
            }
            value={total}
            onValueChange={(cents) => {
              patchRow(row.key, { total: cents })
              clear(`invoiced.${rowIndex.get(row.key) ?? -1}.totalCents`)
            }}
            decimals="auto"
            error={rowError(row, 'totalCents')}
            fieldClassName="col-span-2 @min-[34rem]:col-span-1"
          />
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

        {/* El pie ocupa siempre su renglón y va debajo de los campos: al
            escribir, lo que se está tipeando no se mueve. */}
        <p className="flex min-h-6 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
          {!counts ? (
            <StatusPill tone="muted">Sin usar · no se guarda</StatusPill>
          ) : facts.length > 0 ? (
            facts.join(' · ')
          ) : (
            'Completá el rango y el total, o quitá la fila.'
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      {existing.length > 0 ? (
        <ExistingCloses
          closes={existing}
          dayLabel={dayLabel}
          base={base}
          canAddShift={!showForm}
          onAddShift={() => setShowForm(true)}
          nextHref={afterSaveHref}
          nextLabel={afterSaveLabel}
        />
      ) : null}

      {showForm ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_286px] lg:items-start"
        >
          {/* `overflow-visible`: si no, el pie no se puede quedar pegado abajo al deslizar. */}
          <Planilla className="min-w-0 overflow-visible">
            <PlanillaTitle
              title="¿Cuánto se vendió y cómo te pagaron?"
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="pointer-coarse:h-10"
                  onClick={() => void pasteColumn()}
                >
                  Pegar la columna de Thinkeon
                </Button>
              }
            />

            {needsShift ? (
              <div className="border-b border-border/70 p-3">
                <Field
                  id={`${id}-shift`}
                  label="Turno"
                  required
                  hint="Ese día ya tiene un cierre: ponele nombre a este para distinguirlos."
                  error={errorOf('shift')}
                  className="max-w-xs"
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

            <PTable minWidth={380} label="Lo vendido por medio de cobro">
              <thead>
                <tr>
                  <PTh>Medio</PTh>
                  <PTh>Entró a</PTh>
                  <PTh align="right">Importe</PTh>
                </tr>
              </thead>
              {groups.map((block) => {
                const meta = GROUP_META[block.group]
                const title =
                  block.group === 'wallet' && block.methods.every((m) => m.mercadoPago)
                    ? 'Mercado Pago'
                    : meta.title
                return (
                  <tbody
                    key={block.group}
                    aria-label={title}
                    className="border-b border-border last:border-b-0"
                  >
                    {block.methods.map((m) =>
                      m.kind === 'customer_account'
                        ? accountRow(m, meta.hint)
                        : methodRow(m, meta.hint),
                    )}
                  </tbody>
                )
              })}
              <tfoot>
                <PTotalRow>
                  <PTd colSpan={2}>Total vendido</PTd>
                  <PTd align="right">
                    {sold > 0 ? (
                      moneyLabel(sold)
                    ) : (
                      <>
                        <span aria-hidden>—</span>
                        <span className="sr-only">Todavía sin importes</span>
                      </>
                    )}
                  </PTd>
                </PTotalRow>
              </tfoot>
            </PTable>

            {pasteError ? (
              <p
                role="alert"
                className="border-t border-border/70 px-3 py-2 text-xs text-destructive"
              >
                {pasteError}
              </p>
            ) : null}
            {methodsError ? (
              <p
                role="alert"
                className="border-t border-border/70 px-3 py-2 text-xs text-destructive"
              >
                {methodsError}
              </p>
            ) : null}

            {/* Con factura · Sin factura · Efectivo contado. */}
            <div className="grid gap-3 p-3 sm:grid-cols-3">
              {salesPoints.length > 0 && onlyRow ? (
                <MoneyField
                  label="Con factura"
                  value={onlyRow.total}
                  onValueChange={(cents) => {
                    patchRow(onlyRow.key, { total: cents })
                    clear(`invoiced.${rowIndex.get(onlyRow.key) ?? -1}.totalCents`)
                  }}
                  decimals="auto"
                  align="end"
                  error={rowError(onlyRow, 'totalCents')}
                />
              ) : (
                <ReadOnlyAmount
                  label="Con factura"
                  value={invoicedAny && split ? moneyLabel(split.invoicedCents) : '—'}
                />
              )}
              <ReadOnlyAmount
                label="Sin factura"
                value={
                  split && split.kind !== 'empty' && split.kind !== 'over'
                    ? moneyLabel(split.uninvoicedCents)
                    : '—'
                }
              />
              {cashMethod ? (
                <MoneyField
                  label="Efectivo contado"
                  value={cashCounted}
                  onValueChange={(cents) => {
                    setCashCounted(cents)
                    clear('cashCountedCents')
                  }}
                  decimals="auto"
                  align="end"
                  error={errorOf('cashCountedCents')}
                  hint={
                    cashCounted === null ? (
                      '¿Contaste el efectivo? Si no, dejalo vacío.'
                    ) : cashDiff > 0 ? (
                      <span className="text-warning-text">
                        Faltan {moneyLabel(cashDiff)}: va a faltante de caja. Si pagaste algo con la
                        caja, cargalo como gasto; no lo restes acá.
                      </span>
                    ) : cashDiff < 0 ? (
                      `Sobran ${moneyLabel(-cashDiff)}: va a sobrante de caja.`
                    ) : (
                      'Coincide con lo vendido.'
                    )
                  }
                />
              ) : null}
              {split?.kind === 'over' ? (
                <p className="text-sm text-warning-text text-pretty sm:col-span-3">
                  Facturaste {moneyLabel(split.overCents)} más de lo que vendiste. Si es una factura
                  de otro día, al guardar te pedimos que cuentes por qué.
                </p>
              ) : null}
              {salesPoints.length === 0 ? (
                <p className="text-xs text-muted-foreground text-pretty sm:col-span-3">
                  Sin puntos de venta, todo el día queda como venta sin factura. Queda registrado
                  igual.{' '}
                  {/* En otra pestaña: a esta altura ya están cargados los importes del día, y salir
                      de la pantalla los borraba sin avisar. */}
                  <Link
                    href={`${base}/ajustes?tab=puntos-de-venta`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Cargar mis puntos de venta
                    <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">(se abre en otra pestaña)</span>
                  </Link>
                </p>
              ) : null}
            </div>

            {salesPoints.length > 0 ? (
              <CloseFold
                title="¿Qué facturaste?"
                hint="Rangos por punto de venta"
                open={showRanges}
                onToggle={() => setRangesOpen(!showRanges)}
              >
                <div className="grid gap-3">
                  <p className="text-xs text-muted-foreground text-pretty">
                    El «desde» ya viene puesto: escribí el «hasta» y el total.
                  </p>
                  <div>{rows.map(invoiceRow)}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 pointer-coarse:h-10"
                      onClick={() => addRow('factura_b')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Factura B
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 pointer-coarse:h-10"
                      onClick={() => addRow('factura_a')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Factura A
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 pointer-coarse:h-10"
                      onClick={() => addRow('nota_credito_b')}
                    >
                      <Plus className="size-4" aria-hidden />
                      Nota de crédito
                    </Button>
                  </div>
                  <p className="hidden text-xs text-muted-foreground text-pretty sm:block">
                    ¿Tenés el rango copiado? Pegá «0003-00014501 a 0003-00014662» en el «hasta» y se
                    completa solo.
                  </p>
                  {channelLines.length > 1 ? (
                    <ChannelBreakdown channels={channelLines} invoiceAsked={invoiceAsked} />
                  ) : null}
                </div>
              </CloseFold>
            ) : null}

            {mercadoPago ? (
              <CloseFold
                title="Completar con el reporte de Mercado Pago"
                open={mpOpen}
                onToggle={() => setMpOpen((value) => !value)}
              >
                <MpCloseFill
                  config={mercadoPago}
                  date={date}
                  dayLabel={dayLabel}
                  methodNames={methodNames}
                  amounts={amounts}
                  onApply={applyMercadoPago}
                />
              </CloseFold>
            ) : null}

            <CloseFold
              title="Control con tu sistema de caja"
              open={showControl}
              onToggle={() => setControlOpen(!showControl)}
            >
              <MoneyField
                label="Total que dice tu sistema de caja"
                optional
                value={control}
                onValueChange={(cents) => {
                  setControl(cents)
                  clear('controlTotalCents')
                }}
                decimals="auto"
                align="end"
                hint={<ControlResult check={check} />}
                error={errorOf('controlTotalCents')}
                fieldClassName="max-w-sm"
              />
            </CloseFold>

            <BooksPreview entries={shown} emptyText={booksEmptyText} />

            {posting.banner ? (
              <div className="border-t border-border/70 p-3">
                <FormBanner banner={posting.banner} />
              </div>
            ) : null}

            {/* El pie queda pegado abajo mientras se carga: el botón dice cuánto suma lo cargado. */}
            <PlanillaFoot className="sticky bottom-0 z-10 rounded-b-xl bg-card pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
              <div className="min-w-0 text-xs text-muted-foreground">
                {afterSaveLabel ? <p>Después sigue el del {afterSaveLabel}.</p> : null}
                <p className="hidden xl:block">
                  Enter pasa al campo siguiente. Ctrl + Enter (o ⌘ + Enter) guarda.
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button asChild variant="ghost" className="pointer-coarse:h-11">
                  <Link href={`${base}/ventas`}>Cancelar</Link>
                </Button>
                {/* Mientras no hay nada para guardar (o el total no coincide) el botón va apagado:
                    sigue siendo el mismo `submit` y valida igual, pero no invita. */}
                <Button
                  type="submit"
                  variant={ready ? 'default' : 'secondary'}
                  className="pointer-coarse:h-11"
                  disabled={posting.pending}
                >
                  {submitLabel}
                </Button>
              </div>
            </PlanillaFoot>
          </Planilla>

          <aside className="min-w-0 lg:sticky lg:top-32">
            <Planilla>
              <PlanillaTitle title="Se calcula solo" />
              <table className="w-full border-collapse text-sm tabular-nums">
                <tbody>
                  {[...(taxes?.vat ?? []), ...(taxes?.accrued ?? [])].map((line) => (
                    <tr key={line.key} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-[7px] text-pretty">{line.label}</td>
                      <td className="px-3 py-[7px] text-right whitespace-nowrap">
                        {line.cents !== 0 ? formatCents(line.cents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-border/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground text-pretty">
                {taxes?.base === 'all_sales'
                  ? 'Sobre todo lo vendido, sin el IVA de lo facturado. '
                  : taxes?.base === 'invoiced_net'
                    ? 'Sobre lo facturado, sin IVA. '
                    : 'Ingresos Brutos y Comercio e Industria no se están calculando. '}
                Se cambia en{' '}
                <Link
                  href={`${base}/ajustes?tab=impuestos`}
                  className="font-medium text-foreground underline-offset-4 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Ajustes
                </Link>
                .
              </p>
            </Planilla>
          </aside>
        </form>
      ) : null}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pegar la columna de Thinkeon</DialogTitle>
            <DialogDescription>
              Copiá la columna de importes y pegala acá: un importe por renglón, en el orden de
              Ajustes › Medios de cobro.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            rows={8}
            autoFocus
            aria-label="La columna de importes"
            placeholder={'350.000\n180.000\n220.000'}
            onChange={(event) => setPasteText(event.target.value)}
            className="font-mono text-base md:text-sm"
          />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => setPasteOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 md:h-9"
              disabled={pasteText.trim() === ''}
              onClick={() => {
                applyColumn(pasteText, 0)
                setPasteOpen(false)
              }}
            >
              Repartir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/** Un número calculado al lado de los campos: se lee como un campo, y no se escribe. */
function ReadOnlyAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className="text-sm leading-none font-medium">{label}</span>
      <span className="flex h-11 items-center justify-end rounded-md bg-secondary/50 px-3 text-base tabular-nums md:h-10 md:text-sm">
        {value}
      </span>
    </div>
  )
}
