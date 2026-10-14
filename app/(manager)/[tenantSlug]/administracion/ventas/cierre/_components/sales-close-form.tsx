'use client'

import {
  ArrowDown,
  Banknote,
  Bike,
  CreditCard,
  ExternalLink,
  HandCoins,
  type LucideIcon,
  NotebookPen,
  Plus,
  QrCode,
  ReceiptText,
  Wallet,
  X,
} from 'lucide-react'
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
import { plural } from '@/components/administracion/format'
import {
  EmptyTeach,
  MoneyHero,
  MoneyTicker,
  Panel,
  StatusPill,
  StepCard,
  type StepState,
} from '@/components/administracion/kit'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import {
  type CloseArrival,
  type CloseMethodGroup,
  closeArrivals,
  controlCheck,
  groupCloseMethods,
  invoiceSplit,
  targetProgress,
} from '../_lib/close-view'
import {
  BooksPreview,
  CashCount,
  ControlResult,
  ExampleTicket,
  ExistingCloses,
  GroupIcon,
  InvoiceSplitPanel,
  useMoreBelow,
} from './close-pieces'
import { CloseTicket } from './close-ticket'
import { type CloseMercadoPago, MpCloseFill } from './mp-close-fill'

// ─── Lo que arma la página ───────────────────────────────────────────────────

export type CloseMethod = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  /** «Entra a Caja», «Llega el jue 08/10»: adónde va lo cobrado, en palabras. */
  destination: string
  /** El efectivo (el que se puede contar): lleva el paso «¿Contaste el efectivo?». */
  isCash: boolean
  // Lo que sigue es solo de pantalla (no entra en lo que se manda).
  /** Con qué otros medios se muestra: de dónde sale el número. */
  group: CloseMethodGroup
  /** Quién lo paga después («Tarjetas de débito (Posnet)»), para cuando hay lugar. */
  payer: string | null
  /** Es de Mercado Pago: su grupo se titula así. */
  mercadoPago: boolean
  /** En qué renglón de «Cuándo entra» del ticket suma. */
  arrival: CloseArrival
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

/** Cómo se llama y qué ícono lleva cada grupo de medios: de dónde saca la persona ese número. */
const GROUP_META: Readonly<
  Record<CloseMethodGroup, { title: string; hint: string; icon: LucideIcon }>
> = {
  cash: { title: 'Efectivo', hint: 'Lo que se cobró en billetes.', icon: Banknote },
  wallet: { title: 'Billeteras y transferencias', hint: 'QR y transferencias.', icon: QrCode },
  cards: { title: 'Tarjetas', hint: 'El cierre de lote del posnet.', icon: CreditCard },
  delivery: { title: 'Apps de delivery', hint: 'Lo que dice cada app.', icon: Bike },
  account: { title: 'Cuenta corriente', hint: 'Lo anotado a un cliente.', icon: NotebookPen },
  advance: { title: 'Señas', hint: 'Pagado con una seña ya cobrada.', icon: HandCoins },
}

/** El atajo al último paso. NO guarda: solo lleva hasta el botón (que sigue siendo uno solo). */
const GO_SAVE_LABEL = 'Revisar y guardar'
const GO_SAVE_LINK =
  'inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

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
 * y el efectivo contado. La vista previa («Ver cómo queda en los libros») se
 * arma en el navegador con el mismo código que corre la acción, y al guardar
 * queda «Deshacer» 6 s.
 *
 * Desde el rediseño de octubre 2026 es UNA pantalla con secciones numeradas,
 * todas abiertas, que se tildan solas, y el ticket del cierre que se arma en
 * vivo al costado (en el celular, detrás de «Ver ticket»). El estado, las
 * validaciones y lo que se manda son los de siempre: cambió cómo se ve.
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
  targetCents,
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
  /** El objetivo de ventas de ese día, si lo cargaron (solo se muestra en el ticket). */
  targetCents: number | null
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
  // El paso «¿Contaste el efectivo?» arranca a la vista (antes había que abrirlo con
  // «¿Contaste otra cosa?»). No cambia lo que se manda: sin importe contado viaja `null`
  // igual que con el paso cerrado, y «Saltear» lo cierra como antes.
  const [cashOpen, setCashOpen] = useState(true)
  const [cashCounted, setCashCounted] = useState<number | null>(null)
  const [control, setControl] = useState<number | null>(null)
  const [shift, setShift] = useState('')
  const [showForm, setShowForm] = useState(existing.length === 0)
  const [attempted, setAttempted] = useState(false)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  // Solo de pantalla: la hoja del ticket en el celular.
  const [ticketOpen, setTicketOpen] = useState(false)
  // Solo de pantalla: al cerrar la hoja del ticket, bajar al paso de guardar.
  const goSaveAfterClose = useRef(false)
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
  // Solo de pantalla: el ticket pegado, cuando no entra de alto, avisa que sigue.
  const [asideRef, asideMore] = useMoreBelow<HTMLDivElement>()

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

  /** Lo que trajo «Completar con Mercado Pago» (QR y transferencias). */
  function applyMercadoPago(fills: Readonly<Record<string, number | null>>) {
    setAmounts((prev) => ({ ...prev, ...fills }))
    for (const methodId of Object.keys(fills)) {
      clear(`methods.${methodIndex.get(methodId) ?? -1}.amountCents`)
    }
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
      <EmptyTeach
        icon={Wallet}
        title="Primero decime cómo cobrás"
        action={
          <Button asChild className="h-11">
            <Link href={`${base}/ajustes?tab=medios`}>Ir a Medios de cobro</Link>
          </Button>
        }
        illustration={<ExampleTicket />}
        example
      >
        No hay medios de cobro activos. Activá los que usás (efectivo, débito, Mercado Pago…) y
        volvé a cargar el cierre: cada uno va a tener su renglón y el ticket se arma solo.
      </EmptyTeach>
    )
  }

  const totalExisting = existing.reduce((sum, c) => sum + c.totalCents, 0)
  const cashSold = cashMethod ? (amounts[cashMethod.id] ?? 0) : 0
  const cashDiff = cashOpen && cashCounted !== null ? cashSold - cashCounted : 0
  const methodsError = errorOf('methods')

  const submitLabel = posting.pending
    ? 'Guardando…'
    : `Guardar cierre del ${dayLabel}${sold > 0 ? ` · ${moneyLabel(sold)}` : ''}`

  // ── Solo para mostrar: nada de lo que sigue entra en lo que se manda ──
  const groups = groupCloseMethods(methods)
  const screenMethods = groups.flatMap((g) => g.methods)
  const amountById = new Map(methodValues.map((m) => [m.salesMethodId, m.amountCents]))
  const amountOf = (methodId: string) => amountById.get(methodId) ?? 0
  const loaded = screenMethods.filter((m) => amountOf(m.id) > 0)
  const split = summary ? invoiceSplit(sold, summary.channels) : null
  const channelsText =
    channelLines.length > 1
      ? channelLines
          .filter((c) => c.soldCents !== 0)
          .map((c) => `${CHANNEL_LABELS[c.channel]} ${moneyLabel(c.soldCents)}`)
          .join(' · ')
      : null
  // Lo contado tal como viaja: `null` si no se contó o se salteó el paso.
  const cashCountedSent = values.cashCountedCents
  const arrivals = closeArrivals(screenMethods, amountOf, {
    methodId: cashMethod?.id ?? null,
    countedCents: cashCountedSent,
  })
  const progress = targetProgress(targetCents, totalExisting + sold)
  const invoicedAny = included.some((r) => r.total !== null)
  // Sin puntos de venta todo el día queda sin factura (siempre); con puntos de venta,
  // recién se sabe cuando la persona anotó algo en «¿Qué facturaste?».
  const invoiceAsked = salesPoints.length === 0 || invoicedAny
  // El total del sistema de caja contra lo cargado: si no coincide, el cierre no se guarda.
  const check = controlCheck(control, sold)
  const controlOff = check.kind === 'short' || check.kind === 'over'
  // Listo para guardar: hay ventas y nada a la vista lo frena.
  const ready = sold > 0 && !controlOff
  // Sin efectivo no hay arqueo: los pasos se renumeran.
  const stepNumber = cashMethod
    ? { cash: 2, invoiced: 3, save: 4 }
    : { cash: 0, invoiced: 2, save: 3 }
  // «Completar con el reporte de Mercado Pago» va en el grupo donde están el QR o las
  // transferencias (una sola vez); si el bar no tiene esos medios, el aviso va suelto.
  const mpMethodIds = new Set<string>()
  if (mercadoPago?.qrMethodId) mpMethodIds.add(mercadoPago.qrMethodId)
  if (mercadoPago?.transferMethodId) mpMethodIds.add(mercadoPago.transferMethodId)
  const mpGroup =
    groups.find((block) => block.methods.some((m) => mpMethodIds.has(m.id)))?.group ?? null

  const mpFill = mercadoPago ? (
    <MpCloseFill
      config={mercadoPago}
      date={date}
      dayLabel={dayLabel}
      methodNames={methodNames}
      amounts={amounts}
      onApply={applyMercadoPago}
    />
  ) : null

  /**
   * El renglón de un medio: nombre, a dónde va la plata y su importe. Quién lo paga se
   * dice solo si suma: no cuando es el nombre del medio o el título de su grupo.
   */
  const methodRow = (m: CloseMethod, Icon?: LucideIcon, groupTitle?: string) => {
    const inputId = `${id}-m-${m.id}`
    // El error del motor gana; si no hay, el de lectura (un importe que no se entiende).
    const amountError = methodError(m.id, 'amountCents') ?? readErrors[m.id] ?? null
    const payer = m.payer !== null && m.payer !== m.name && m.payer !== groupTitle ? m.payer : null
    return (
      // El importe va al lado desde 18.5rem de grupo (un celular de 390 px) y mide 10.5rem:
      // ahí entra entero «$ 123.456.789,50» y al nombre le queda lugar para decir a dónde
      // va la plata en un renglón. Más angosto, el importe baja a su propio renglón.
      <div
        key={m.id}
        className="grid items-start gap-x-3 gap-y-1.5 @min-[18.5rem]:grid-cols-[minmax(0,1fr)_10.5rem] @min-[26rem]:grid-cols-[minmax(0,1fr)_12rem]"
      >
        <div className="flex min-w-0 items-start gap-2.5 @min-[18.5rem]:pt-1 md:@min-[18.5rem]:pt-0.5">
          {Icon ? <GroupIcon icon={Icon} /> : null}
          <div className="min-w-0">
            <Label htmlFor={inputId} className="leading-snug">
              {m.name}
            </Label>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {Icon ? null : (
                <span aria-hidden="true" className="hidden @min-[26rem]:inline">
                  →{' '}
                </span>
              )}
              {m.destination}
              {payer ? <span className="hidden @min-[26rem]:inline"> · {payer}</span> : null}
            </p>
          </div>
        </div>
        <div className="grid gap-1">
          <MoneyInput
            id={inputId}
            value={amounts[m.id] ?? null}
            onValueChange={(cents) => setAmount(m.id, cents)}
            onPaste={(e) => onMethodPaste(e, m.id)}
            // Al salir del campo, un importe redondo queda sin «,00»: es más corto y son
            // los mismos centavos.
            decimals="auto"
            align="end"
            invalid={Boolean(amountError)}
            aria-describedby={amountError ? `${inputId}-error` : undefined}
            onErrorChange={readErrorHandler(m.id)}
          />
          {amountError ? (
            <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
              {amountError}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  /** Cuenta corriente: un renglón por cliente, con su importe. */
  const accountRows = (m: CloseMethod, showName: boolean) => {
    const list = accounts[m.id] ?? []
    const subtotal = list.reduce((sum, r) => sum + (r.amount ?? 0), 0)
    const listError = methodError(m.id, 'customers')
    return (
      <div key={m.id} className="grid gap-3">
        {showName ? (
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.destination}</p>
            </div>
            <span className="text-sm font-medium tabular-nums">
              {subtotal > 0 ? formatCents(subtotal) : '—'}
            </span>
          </div>
        ) : null}
        {list.map((r, j) => {
          const index = methodIndex.get(m.id) ?? -1
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
          className="h-11 w-fit gap-1.5 md:h-9"
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

  /** El ticket. `compact`: el de la compu, que si la pantalla es baja se aprieta para entrar. */
  const renderTicket = (compact: boolean) => (
    <CloseTicket
      dayTitle={dayLabel}
      shift={values.shift}
      lines={loaded.map((m) => ({ id: m.id, name: m.name, cents: amountOf(m.id) }))}
      soldCents={sold}
      channelsText={channelsText}
      split={split}
      invoiceAsked={invoiceAsked}
      cash={
        cashMethod
          ? { expectedCents: cashSold, countedCents: cashCountedSent, diffCents: cashDiff }
          : null
      }
      arrivals={arrivals}
      target={progress}
      compact={compact}
    />
  )
  const saveStepId = `paso-${stepNumber.save}`

  // Los resúmenes de los pasos entran en un renglón también en el celular: si al cargar el
  // primer importe el título cambiara de alto, el campo se movería justo mientras se escribe.

  // El paso del efectivo: contado (con su resultado), salteado o todavía sin tocar. El
  // tilde es solo para «se contó»: saltear no es haber contado, y no se ve igual.
  const cashCounting = cashOpen && cashCounted !== null
  const cashStepState: StepState = cashCounting ? 'done' : 'todo'
  const cashStepSummary = !cashOpen
    ? 'No se cuenta: queda lo que cargaste.'
    : cashCounting
      ? cashDiff > 0
        ? `Faltan ${moneyLabel(cashDiff)} en la caja.`
        : cashDiff < 0
          ? `Sobran ${moneyLabel(-cashDiff)} en la caja.`
          : 'Coincide con lo vendido.'
      : 'Contá los billetes de la caja.'

  // Mientras nadie anotó nada, el paso pregunta: todavía no hay un «todo sin factura» que decir.
  const invoicedStepSummary =
    !split || split.kind === 'empty' || !invoiceAsked
      ? 'Lo que salió con factura ese día.'
      : split.kind === 'none'
        ? `Todo sin factura: ${moneyLabel(split.uninvoicedCents)}.`
        : split.kind === 'all'
          ? `Todo con factura: ${moneyLabel(split.invoicedCents)}.`
          : split.kind === 'over'
            ? `Facturaste ${moneyLabel(split.overCents)} de más.`
            : `${moneyLabel(split.invoicedCents)} con factura (${split.invoicedPercent} %).`

  const reviewSummary =
    sold <= 0 ? (
      'Cuando cargues al menos un medio con ventas, guardás.'
    ) : controlOff ? (
      // Frena el guardado: se dice acá, con el camino para arreglarlo, y no recién al tocar el botón.
      <>
        El total de tu sistema de caja no coincide con lo que cargaste:{' '}
        <a href="#paso-1" className={cn(GO_SAVE_LINK, 'underline')}>
          corregilo o borralo
        </a>{' '}
        para guardar.
      </>
    ) : !split || split.kind === 'empty' ? (
      `Vendiste ${moneyLabel(sold)}.`
    ) : split.kind === 'none' ? (
      invoiceAsked ? (
        `Vendiste ${moneyLabel(sold)}, todo sin factura.`
      ) : (
        `Vendiste ${moneyLabel(sold)}. No anotaste facturas: queda todo como venta sin factura.`
      )
    ) : split.kind === 'all' ? (
      `Vendiste ${moneyLabel(sold)}, todo con factura.`
    ) : split.kind === 'over' ? (
      `Vendiste ${moneyLabel(sold)} y facturaste ${moneyLabel(split.invoicedCents)}: al guardar te preguntamos por qué.`
    ) : (
      `Vendiste ${moneyLabel(sold)}: ${moneyLabel(split.invoicedCents)} con factura y ${moneyLabel(split.uninvoicedCents)} sin factura.`
    )

  // Lo que dice «Ver cómo queda en los libros» mientras no hay nada que mostrar, y por qué.
  const booksEmptyText =
    sold <= 0
      ? 'Cargá los importes y acá vas a ver cómo queda en los libros.'
      : controlOff
        ? 'Se ve cuando el total de tu sistema de caja coincida con lo que cargaste.'
        : 'Todavía falta completar algo: al guardar te marcamos qué.'

  /** Baja hasta el paso de guardar y deja el foco en su botón. No guarda nada. */
  const goToSave = () => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document
      .getElementById(saveStepId)
      ?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
    formRef.current
      ?.querySelector<HTMLElement>('button[type="submit"]')
      ?.focus({ preventScroll: true })
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
        <form ref={formRef} noValidate onSubmit={onSubmit} onKeyDown={handleFormKeyDown}>
          {/* Dos columnas recién con lugar para las dos (`xl`): el ticket mide 360 px fijos y,
              con el menú abierto, antes de eso la columna de pasos quedaba más angosta que un
              celular. Más abajo, una columna y el ticket detrás de «Ver ticket». */}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            {/* `@container`: lo de adentro se acomoda según el ancho de ESTA columna, no el de
                la pantalla. `min-w-0`: un texto largo que no se parte nunca la ensancha. */}
            <div className="@container min-w-0 space-y-4 sm:space-y-5">
              {needsShift ? (
                <Panel
                  title="Otro turno del mismo día"
                  description="Ese día ya tiene un cierre: ponele nombre a este para distinguirlos."
                >
                  <Field
                    id={`${id}-shift`}
                    label="Turno"
                    required
                    hint="Para distinguirlo del cierre que ya está cargado."
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
                </Panel>
              ) : null}

              {/* ── 1 · Lo vendido ── */}
              <StepCard
                open
                n={1}
                id="paso-1"
                // Con el total del sistema de caja sin coincidir, el paso no está hecho.
                state={ready ? 'done' : 'current'}
                title="¿Cuánto se vendió y cómo te pagaron?"
                summary={
                  sold > 0
                    ? `${moneyLabel(sold)} en ${plural(loaded.length, 'medio', 'medios')}.`
                    : 'Un importe por cada medio de cobro.'
                }
              >
                <div className="grid gap-3">
                  {groups.map((block) => {
                    const meta = GROUP_META[block.group]
                    const allMercadoPago =
                      block.group === 'wallet' && block.methods.every((m) => m.mercadoPago)
                    const title = allMercadoPago ? 'Mercado Pago' : meta.title
                    const fill = block.group === mpGroup ? mpFill : null
                    const only = block.methods.length === 1 ? block.methods[0] : undefined
                    // Un grupo de un solo medio no repite el título: el ícono va en su renglón.
                    if (only && only.kind !== 'customer_account') {
                      return (
                        <div
                          key={block.group}
                          className="@container grid gap-3 rounded-xl bg-secondary/50 p-3 sm:p-4"
                        >
                          {methodRow(only, meta.icon)}
                          {fill}
                        </div>
                      )
                    }
                    const headingId = `${id}-g-${block.group}`
                    const subtotal = block.methods.reduce((sum, m) => sum + amountOf(m.id), 0)
                    return (
                      <section
                        key={block.group}
                        aria-labelledby={headingId}
                        className="@container grid gap-3 rounded-xl bg-secondary/50 p-3 sm:p-4"
                      >
                        <div className="flex items-center gap-2.5">
                          <GroupIcon icon={meta.icon} />
                          <div className="min-w-0 flex-1">
                            <h3 id={headingId} className="text-sm font-semibold leading-tight">
                              {title}
                            </h3>
                            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                              {meta.hint}
                            </p>
                          </div>
                          {/* Solo con lugar: en angosto, al aparecer partiría el título del grupo. */}
                          {subtotal > 0 ? (
                            <p className="hidden shrink-0 text-right text-sm font-medium tabular-nums @min-[26rem]:block">
                              <span className="sr-only">Suma del grupo: </span>
                              {moneyLabel(subtotal)}
                            </p>
                          ) : null}
                        </div>
                        {fill}
                        <div className="grid gap-3 @min-[26rem]:pl-[2.625rem]">
                          {block.methods.map((m) =>
                            m.kind === 'customer_account'
                              ? accountRows(m, block.methods.length > 1)
                              : methodRow(m, undefined, title),
                          )}
                        </div>
                      </section>
                    )
                  })}
                  {mpGroup === null ? mpFill : null}
                </div>

                {pasteError ? (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {pasteError}
                  </p>
                ) : null}
                {methodsError ? (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {methodsError}
                  </p>
                ) : null}

                {/* El total manda; el control del sistema de caja va al lado solo si la columna
                    tiene lugar para los dos (un total de nueve cifras incluido). */}
                <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_19rem] @min-[44rem]:items-end @min-[44rem]:gap-6">
                  <MoneyHero
                    size="md"
                    cents={sold > 0 ? sold : null}
                    decimals={sold % 100 === 0 ? 0 : 2}
                    label="Total vendido"
                    sentence={channelsText ?? undefined}
                  />
                  <MoneyField
                    label="Total que dice tu sistema de caja"
                    optional
                    value={control}
                    onValueChange={(cents) => {
                      setControl(cents)
                      clear('controlTotalCents')
                    }}
                    decimals="auto"
                    hint={<ControlResult check={check} />}
                    error={errorOf('controlTotalCents')}
                    className="max-w-60"
                  />
                </div>
                <p className="mt-3 hidden text-xs text-muted-foreground text-pretty sm:block">
                  ¿Tenés los importes en una planilla? Copiá la columna y pegala en el primer medio:
                  se reparte sola hacia abajo, en el orden de Ajustes › Medios de cobro.
                </p>
              </StepCard>

              {/* ── 2 · El efectivo, contado ── */}
              {cashMethod ? (
                <StepCard
                  open
                  n={stepNumber.cash}
                  id={`paso-${stepNumber.cash}`}
                  state={cashStepState}
                  title="¿Contaste el efectivo?"
                  summary={cashStepSummary}
                  action={
                    !cashOpen ? (
                      <StatusPill tone="muted">Salteado</StatusPill>
                    ) : cashStepState === 'todo' ? (
                      <StatusPill tone="muted">Opcional</StatusPill>
                    ) : null
                  }
                >
                  <CashCount
                    methodName={cashMethod.name}
                    open={cashOpen}
                    soldCents={cashSold}
                    countedCents={cashCounted}
                    diffCents={cashDiff}
                    error={errorOf('cashCountedCents')}
                    onCountedChange={(cents) => {
                      setCashCounted(cents)
                      clear('cashCountedCents')
                    }}
                    onToggle={() => {
                      setCashOpen(!cashOpen)
                      clear('cashCountedCents')
                    }}
                  />
                </StepCard>
              ) : null}

              {/* ── 3 · Lo facturado ── */}
              <StepCard
                open
                n={stepNumber.invoiced}
                id={`paso-${stepNumber.invoiced}`}
                state={invoicedAny ? 'done' : 'todo'}
                title="¿Qué facturaste?"
                summary={invoicedStepSummary}
                action={
                  !invoicedAny && salesPoints.length > 0 ? (
                    <StatusPill tone="muted">Opcional</StatusPill>
                  ) : null
                }
              >
                <div className="grid gap-4">
                  {salesPoints.length === 0 ? (
                    <div className="flex items-start gap-3 rounded-xl bg-secondary/50 p-3 sm:p-4">
                      <GroupIcon icon={ReceiptText} />
                      <div className="min-w-0 space-y-2 text-sm">
                        <p className="font-medium text-pretty">
                          Sin puntos de venta, todo el día queda como venta sin factura.
                        </p>
                        <p className="text-muted-foreground text-pretty">
                          Queda registrado igual. El punto de venta es el número con el que facturás
                          en ARCA (por ejemplo, 0003), no la caja registradora: cargalo una vez y,
                          desde el próximo cierre, acá anotás qué parte del día salió con factura.
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                          {/* En otra pestaña: a esta altura ya están cargados los importes del
                              día, y salir de la pantalla los borraba sin avisar. */}
                          <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                            <Link
                              href={`${base}/ajustes?tab=puntos-de-venta`}
                              target="_blank"
                              rel="noopener"
                            >
                              Cargar mis puntos de venta
                              <ExternalLink className="size-3.5" aria-hidden />
                              <span className="sr-only">(se abre en otra pestaña)</span>
                            </Link>
                          </Button>
                          <span className="min-w-0 text-xs text-muted-foreground text-pretty">
                            Se abre en otra pestaña: no perdés lo que cargaste. Si hoy no
                            facturaste, guardá el cierre igual.
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground text-pretty">
                        El «desde» ya viene puesto: escribí el «hasta» y el total.
                      </p>
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
                          rowError(row, 'voucherType') ??
                          rowError(row, 'pointOfSale') ??
                          rowError(row, 'channel')
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
                          <div
                            key={row.key}
                            className={cn(
                              'grid gap-3 rounded-xl p-3 @min-[34rem]:p-4',
                              // Una fila precargada que nadie tocó no cuenta: se ve en borrador.
                              counts ? 'bg-secondary/50' : 'border border-dashed border-border/80',
                            )}
                          >
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
                                    onClick={() =>
                                      setRowDetails((prev) => ({ ...prev, [row.key]: !fixedOpen }))
                                    }
                                  >
                                    {fixedOpen ? 'Listo' : 'Cambiar'}
                                    <span className="sr-only">
                                      {' '}
                                      comprobante, punto de venta, IVA y canal de la fila{' '}
                                      {index + 1}
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
                            <div
                              id={`${rid}-fixed`}
                              hidden={!fixedOpen}
                              className="grid grid-cols-2 gap-3"
                            >
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
                                        if (isCloseVoucher(v))
                                          changeRowSeries(row, { voucherType: v })
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
                                          <SelectItem
                                            key={v}
                                            value={v}
                                            className="min-h-11 md:min-h-8"
                                          >
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
                                      value={
                                        row.pointOfSale === null ? '' : String(row.pointOfSale)
                                      }
                                      onValueChange={(v) => {
                                        changeRowSeries(row, { pointOfSale: Number(v) })
                                        clear(`invoiced.${rowIndex.get(row.key) ?? -1}.pointOfSale`)
                                      }}
                                    >
                                      <SelectTrigger
                                        id={`${rid}-pos`}
                                        className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
                                        aria-invalid={
                                          rowError(row, 'pointOfSale') ? true : undefined
                                        }
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
                                      onValueChange={(v) =>
                                        patchRow(row.key, { rate: Number(v) as VatRateBp })
                                      }
                                    >
                                      <SelectTrigger
                                        id={`${rid}-rate`}
                                        className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
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
                                      onValueChange={(v) =>
                                        patchRow(row.key, { channel: v as Channel })
                                      }
                                    >
                                      <SelectTrigger
                                        id={`${rid}-channel`}
                                        className="w-full min-w-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CHANNELS.map((c) => (
                                          <SelectItem
                                            key={c}
                                            value={c}
                                            className="min-h-11 md:min-h-8"
                                          >
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
                                    patchRow(row.key, {
                                      from: digits(e.target.value),
                                      fromAuto: false,
                                    })
                                    clear(`invoiced.${rowIndex.get(row.key) ?? -1}.numberFrom`)
                                  }}
                                />
                              </Field>
                              <Field
                                id={`${rid}-to`}
                                label="Hasta"
                                error={rowError(row, 'numberTo')}
                              >
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
                                  aria-describedby={describedBy(`${rid}-to`, {
                                    error: rowError(row, 'numberTo'),
                                  })}
                                  onPaste={(e) => onRangePaste(e, row, 'to')}
                                  onChange={(e) => {
                                    patchRow(row.key, { to: digits(e.target.value) })
                                    clear(`invoiced.${rowIndex.get(row.key) ?? -1}.numberTo`)
                                  }}
                                />
                              </Field>
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
                      })}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 gap-1.5 rounded-full md:h-9"
                          onClick={() => addRow('factura_b')}
                        >
                          <Plus className="size-4" aria-hidden />
                          Factura B
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 gap-1.5 rounded-full md:h-9"
                          onClick={() => addRow('factura_a')}
                        >
                          <Plus className="size-4" aria-hidden />
                          Factura A
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 gap-1.5 rounded-full md:h-9"
                          onClick={() => addRow('nota_credito_b')}
                        >
                          <Plus className="size-4" aria-hidden />
                          Nota de crédito
                        </Button>
                      </div>
                      <p className="hidden text-xs text-muted-foreground text-pretty sm:block">
                        ¿Tenés el rango copiado? Pegá «0003-00014501 a 0003-00014662» en el «hasta»
                        y se completa solo.
                      </p>
                    </>
                  )}

                  {/* El reparto del día, siempre a la vista. */}
                  <InvoiceSplitPanel
                    soldCents={sold}
                    split={split}
                    channels={channelLines}
                    invoiceAsked={invoiceAsked}
                    canInvoice={salesPoints.length > 0}
                  />
                </div>
              </StepCard>

              {/* ── 4 · Revisar y guardar ── */}
              <StepCard
                open
                n={stepNumber.save}
                id={saveStepId}
                state={ready ? 'current' : 'todo'}
                title="Revisá y guardá"
                summary={reviewSummary}
              >
                <div className="grid gap-4">
                  <FormBanner banner={posting.banner} />
                  <div className="flex flex-col gap-2 @min-[40rem]:flex-row @min-[40rem]:items-center">
                    {/* Mientras no hay nada para guardar (o el total no coincide) el botón va
                        apagado: sigue siendo el mismo `submit` y valida igual, pero no invita.
                        Si el texto con el total no entra en un renglón, se parte en dos. */}
                    <Button
                      type="submit"
                      variant={ready ? 'default' : 'secondary'}
                      className="h-auto min-h-12 min-w-0 px-6 py-2.5 text-base whitespace-normal text-balance @min-[40rem]:min-w-[280px]"
                      disabled={posting.pending}
                    >
                      {submitLabel}
                    </Button>
                    <Button asChild variant="ghost" className="h-12 shrink-0 px-5">
                      <Link href={`${base}/ventas`}>Cancelar</Link>
                    </Button>
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    {afterSaveLabel ? <p>Después sigue el del {afterSaveLabel}.</p> : null}
                    <p className="hidden xl:block">
                      Enter pasa al campo siguiente. Ctrl + Enter (o ⌘ + Enter) guarda.
                    </p>
                  </div>
                </div>
              </StepCard>

              {/* El Debe y el Haber, para quien quiera mirarlos: después de guardar y a lo ancho. */}
              <BooksPreview entries={shown} emptyText={booksEmptyText} />
            </div>

            {/* En la compu, el ticket acompaña mientras se carga. En una pantalla baja se
                aprieta para entrar entero; si igual no entra (muchos medios), se desliza adentro
                de su columna y un «sigue» lo dice. El margen negativo deja lugar a su sombra,
                que el recorte del scroll se comería. */}
            <aside className="relative hidden xl:sticky xl:top-20 xl:block">
              <div
                ref={asideRef}
                className={cn(
                  '-mx-3 max-h-[calc(100dvh-6rem)] overflow-y-auto px-3 pb-4 [scrollbar-width:none]',
                  asideMore &&
                    '[mask-image:linear-gradient(to_bottom,black_calc(100%_-_4rem),transparent_calc(100%_-_1rem))]',
                )}
              >
                {renderTicket(true)}
                {sold > 0 ? (
                  <p className="mt-3 text-center text-sm">
                    <a
                      href={`#${saveStepId}`}
                      className={cn(
                        GO_SAVE_LINK,
                        'min-h-8 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {GO_SAVE_LABEL}
                      <ArrowDown className="size-3.5" aria-hidden />
                    </a>
                  </p>
                ) : null}
              </div>
              {asideMore ? (
                <button
                  type="button"
                  className="absolute bottom-1 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-xs font-medium whitespace-nowrap shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    const el = asideRef.current
                    el?.scrollTo({ top: el.scrollHeight })
                  }}
                >
                  El ticket sigue
                  <ArrowDown className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </aside>
          </div>

          {/* Sin lugar para el ticket al costado (celular, tablet, notebook chica): el total
              siempre a la vista, el ticket a un toque y un atajo al paso de guardar. Va pegada
              abajo DENTRO de la página (no fija a la pantalla): así no pisa el menú del costado. */}
          <div className="sticky bottom-0 z-30 -mx-4 mt-6 -mb-4 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md sm:-mx-6 sm:-mb-8 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Total vendido
                </p>
                <p
                  className={cn(
                    'mt-0.5 font-serif font-semibold leading-none tracking-tight whitespace-nowrap',
                    // Nueve cifras no entran al lado del botón en un celular angosto.
                    sold >= 100_000_000_00 ? 'text-xl' : 'text-2xl',
                  )}
                >
                  {sold > 0 ? (
                    <MoneyTicker
                      cents={sold}
                      decimals={sold % 100 === 0 ? 0 : 2}
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
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {sold > 0 ? (
                  <a href={`#${saveStepId}`} className={cn(GO_SAVE_LINK, 'text-xs')}>
                    {GO_SAVE_LABEL}
                    <ArrowDown className="size-3.5" aria-hidden />
                  </a>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2 rounded-full px-4"
                  onClick={() => setTicketOpen(true)}
                >
                  <ReceiptText className="size-4" aria-hidden />
                  Ver ticket
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : null}

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] outline-none"
          // El foco va a la hoja (no a la X): es para leer, y así el lector arranca por el título.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
          // Si se cerró con «Revisar y guardar», en vez de volver a «Ver ticket» baja al último paso.
          onCloseAutoFocus={(event) => {
            if (!goSaveAfterClose.current) return
            goSaveAfterClose.current = false
            event.preventDefault()
            goToSave()
          }}
        >
          <SheetGrabber />
          <SheetHeader className="sr-only">
            <SheetTitle>Ticket del cierre del {dayLabel}</SheetTitle>
            <SheetDescription>
              Lo que cargaste hasta ahora. Se guarda con el botón del último paso.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm">
            {renderTicket(false)}
            {/* Dónde se guarda, dicho a la vista, y el camino hasta ahí. No guarda: lleva. */}
            <div className="mt-5 grid gap-2.5 text-center">
              <p className="text-xs text-muted-foreground">
                {sold > 0
                  ? 'Esto todavía no está guardado: se guarda en el último paso.'
                  : 'Se guarda en el último paso, cuando cargues los importes.'}
              </p>
              {sold > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 gap-2 rounded-full text-base"
                  onClick={() => {
                    goSaveAfterClose.current = true
                    setTicketOpen(false)
                  }}
                >
                  {GO_SAVE_LABEL}
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
