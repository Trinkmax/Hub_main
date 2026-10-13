'use client'

import {
  Banknote,
  Bike,
  CreditCard,
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
import { EntryPreview } from '@/components/administracion/entry-preview'
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
  groupCloseMethods,
  invoiceSplit,
  targetProgress,
} from '../_lib/close-view'
import {
  CashCount,
  ExampleTicket,
  ExistingCloses,
  GroupIcon,
  InvoiceSplitPanel,
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

/** El asiento va plegado: el dueño mira el ticket; el Debe y el Haber quedan a un toque. */
const ENTRY_LABEL = 'Ver cómo queda en los libros'
const ENTRY_EMPTY = 'Completá los importes para ver cómo queda en los libros.'

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
    const amountError = methodError(m.id, 'amountCents')
    const payer = m.payer !== null && m.payer !== m.name && m.payer !== groupTitle ? m.payer : null
    return (
      <div
        key={m.id}
        className="grid items-start gap-x-3 gap-y-1.5 @min-[17rem]:grid-cols-[minmax(0,1fr)_9rem] @min-[26rem]:grid-cols-[minmax(0,1fr)_12rem]"
      >
        <div className="flex min-w-0 items-start gap-2.5 @min-[17rem]:pt-1 md:@min-[17rem]:pt-0.5">
          {Icon ? <GroupIcon icon={Icon} /> : null}
          <div className="min-w-0">
            <Label htmlFor={inputId} className="leading-snug">
              {m.name}
            </Label>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {Icon ? null : <span aria-hidden="true">→ </span>}
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
            align="end"
            invalid={Boolean(amountError)}
            aria-describedby={amountError ? `${inputId}-error` : undefined}
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
          const amountError = errorOf(`methods.${index}.customers.${j}.amountCents`)
          return (
            <div
              key={r.key}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start"
            >
              <div className="grid gap-1">
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

  const ticket = (
    <CloseTicket
      dayTitle={dayLabel}
      shift={values.shift}
      lines={loaded.map((m) => ({ id: m.id, name: m.name, cents: amountOf(m.id) }))}
      soldCents={sold}
      channelsText={channelsText}
      split={split}
      cash={
        cashMethod
          ? { expectedCents: cashSold, countedCents: cashCountedSent, diffCents: cashDiff }
          : null
      }
      arrivals={arrivals}
      target={progress}
    />
  )

  // Los resúmenes de los pasos entran en un renglón también en el celular: si al cargar el
  // primer importe el título cambiara de alto, el campo se movería justo mientras se escribe.

  // El paso del efectivo: contado (con su resultado), salteado o todavía sin tocar.
  const cashCounting = cashOpen && cashCounted !== null
  const cashStepState: StepState = cashCounting || !cashOpen ? 'done' : 'todo'
  const cashStepSummary = !cashOpen
    ? 'Salteado: queda lo que cargaste.'
    : cashCounting
      ? cashDiff > 0
        ? `Faltan ${moneyLabel(cashDiff)} en la caja.`
        : cashDiff < 0
          ? `Sobran ${moneyLabel(-cashDiff)} en la caja.`
          : 'Coincide con lo vendido.'
      : 'Contá los billetes de la caja.'

  const invoicedStepSummary =
    !split || split.kind === 'empty'
      ? 'Lo que salió con factura ese día.'
      : split.kind === 'none'
        ? `Todo sin factura: ${moneyLabel(split.uninvoicedCents)}.`
        : split.kind === 'all'
          ? `Todo con factura: ${moneyLabel(split.invoicedCents)}.`
          : split.kind === 'over'
            ? `Facturaste ${moneyLabel(split.overCents)} de más.`
            : `${moneyLabel(split.invoicedCents)} con factura (${split.invoicedPercent} %).`

  const reviewSummary =
    sold <= 0
      ? 'Cuando cargues al menos un medio con ventas, guardás.'
      : !split || split.kind === 'empty'
        ? `Vendiste ${moneyLabel(sold)}.`
        : split.kind === 'none'
          ? `Vendiste ${moneyLabel(sold)}, todo sin factura.`
          : split.kind === 'all'
            ? `Vendiste ${moneyLabel(sold)}, todo con factura.`
            : split.kind === 'over'
              ? `Vendiste ${moneyLabel(sold)} y facturaste ${moneyLabel(split.invoicedCents)}: al guardar te preguntamos por qué.`
              : `Vendiste ${moneyLabel(sold)}: ${moneyLabel(split.invoicedCents)} con factura y ${moneyLabel(split.uninvoicedCents)} sin factura.`

  return (
    <>
      {existing.length > 0 ? (
        <ExistingCloses
          closes={existing}
          dayLabel={dayLabel}
          base={base}
          canAddShift={!showForm}
          onAddShift={() => setShowForm(true)}
        />
      ) : null}

      {showForm ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
        >
          {/* `min-w-0`: un texto largo que no se parte nunca ensancha la columna (ni la página). */}
          <div className="min-w-0 space-y-4 sm:space-y-5">
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
                  className="sm:max-w-xs"
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
              state={sold > 0 ? 'done' : 'current'}
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

              <div className="mt-4 flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                <MoneyHero
                  size="md"
                  cents={sold > 0 ? sold : null}
                  decimals={sold % 100 === 0 ? 0 : 2}
                  label="Total vendido"
                  sentence={channelsText ?? undefined}
                />
                <MoneyField
                  label="Total del cierre de caja"
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
                  fieldClassName="sm:w-60 sm:shrink-0"
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
                  cashStepState === 'todo' ? <StatusPill tone="muted">Opcional</StatusPill> : null
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
                        El punto de venta es el número con el que facturás en ARCA (por ejemplo,
                        0003), no la caja registradora. Cargalo una vez y acá vas a poder anotar qué
                        parte del día salió con factura.
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                        <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                          <Link href={`${base}/ajustes?tab=puntos-de-venta`}>
                            Cargar mis puntos de venta
                          </Link>
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Si hoy no facturaste, guardá el cierre igual.
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground text-pretty">
                      Un rango por tipo y punto de venta. El «desde» ya viene puesto: escribí el
                      «hasta» y el total. Si pegás «0003-00014501 a 0003-00014662» en el «hasta», se
                      completa solo.
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
                      return (
                        <div
                          key={row.key}
                          className={cn(
                            'grid gap-4 rounded-xl p-3 sm:p-4',
                            // Una fila precargada que nadie tocó no cuenta: se ve en borrador.
                            rowCounts(row)
                              ? 'bg-secondary/50'
                              : 'border border-dashed border-border/80',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">
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
                                className="-my-1.5 size-11 text-muted-foreground md:size-9"
                                aria-label={`Quitar la fila ${index + 1}`}
                                onClick={() => removeRow(row.key)}
                              >
                                <X className="size-4" />
                              </Button>
                            ) : null}
                          </div>

                          {/* Dos por fila: al lado del ticket, cuatro no entran («0004 · Delivery»).
                              En el celular los dos combos van uno abajo del otro. */}
                          <div className="grid grid-cols-2 gap-4">
                            <Field
                              id={`${rid}-type`}
                              label="Comprobante"
                              error={rowError(row, 'voucherType')}
                              className="col-span-2 sm:col-span-1"
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
                              className="col-span-2 sm:col-span-1"
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
                                // Con el «desde» puesto, un ejemplo más chico que ese número confunde.
                                placeholder={row.from ? undefined : '00014662'}
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
                  </>
                )}

                {/* El reparto del día, siempre a la vista. */}
                <InvoiceSplitPanel soldCents={sold} split={split} channels={channelLines} />
              </div>
            </StepCard>

            {/* ── 4 · Revisar y guardar ── */}
            <StepCard
              open
              n={stepNumber.save}
              id={`paso-${stepNumber.save}`}
              state={sold > 0 ? 'current' : 'todo'}
              title="Revisá y guardá"
              summary={reviewSummary}
            >
              <div className="grid gap-4">
                {/* En el celular, el asiento va acá (antes de guardar); en la compu, bajo el ticket. */}
                <div className="lg:hidden">
                  <EntryPreview entries={shown} label={ENTRY_LABEL} emptyText={ENTRY_EMPTY} />
                </div>
                <FormBanner banner={posting.banner} />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {/* En el celular el texto con el total no entra en un renglón: se parte en dos. */}
                  <Button
                    type="submit"
                    className="h-auto min-h-12 px-6 py-2.5 text-base whitespace-normal text-balance sm:min-w-[280px] sm:whitespace-nowrap"
                    disabled={posting.pending}
                  >
                    {submitLabel}
                  </Button>
                  <Button asChild variant="ghost" className="h-12 px-5">
                    <Link href={`${base}/ventas`}>Cancelar</Link>
                  </Button>
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {afterSaveLabel ? <p>Después sigue el del {afterSaveLabel}.</p> : null}
                  <p className="hidden lg:block">
                    Enter pasa al campo siguiente. Ctrl + Enter (o ⌘ + Enter) guarda.
                  </p>
                </div>
              </div>
            </StepCard>

            {/* Lugar para la barra fija del celular: lo último siempre se puede leer. */}
            <div aria-hidden="true" className="h-20 lg:hidden" />
          </div>

          {/* En la compu, el ticket acompaña mientras se carga. Si no entra de alto (muchos
              medios, pantalla baja) se desliza adentro de su columna, y el desvanecido de abajo
              avisa que sigue. El margen negativo deja lugar a su sombra, que el recorte del
              scroll se comería. */}
          <aside className="hidden lg:sticky lg:top-20 lg:-mx-3 lg:block lg:max-h-[calc(100dvh-6rem)] lg:space-y-4 lg:overflow-y-auto lg:px-3 lg:pb-8 lg:[mask-image:linear-gradient(to_bottom,black_calc(100%_-_2rem),transparent)]">
            {ticket}
            <EntryPreview entries={shown} label={ENTRY_LABEL} emptyText={ENTRY_EMPTY} />
          </aside>

          {/* En el celular: el total siempre a la vista y el ticket a un toque. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md lg:hidden">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Total vendido
                </p>
                <p className="mt-0.5 font-serif text-2xl font-semibold leading-none tracking-tight">
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
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 gap-2 rounded-full px-4"
                onClick={() => setTicketOpen(true)}
              >
                <ReceiptText className="size-4" aria-hidden />
                Ver ticket
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] outline-none"
          // El foco va a la hoja (no a la X): es para leer, y así el lector arranca por el título.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <SheetGrabber />
          <SheetHeader className="sr-only">
            <SheetTitle>Ticket del cierre del {dayLabel}</SheetTitle>
            <SheetDescription>
              Lo que cargaste hasta ahora. Se guarda con el botón del último paso.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm">{ticket}</div>
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
