import { formatDayMonth, isoDayInCordoba } from '@/lib/dates'
import type { DataIssue, IssueGroup } from '@/lib/purchasing/checks'
import {
  effectiveDeliveryDate,
  longDayLabel,
  relativeDayLabel,
  weekdaysText,
} from '@/lib/purchasing/dates'
import type { EventDeadline, SupplierDeadline } from '@/lib/purchasing/deadlines'
import type { DraftLine } from '@/lib/purchasing/draft'
import type { PlannedEvent } from '@/lib/purchasing/events'
import {
  COUNT_KIND_LABELS,
  expectedPacks,
  FREQUENCY_LABELS,
  type PurCount,
  type PurItem,
  type PurOrder,
  type PurOrderLine,
  type PurSupplier,
} from '@/lib/purchasing/types'
import { formatAmount, formatQty, packsText, roundQty } from '@/lib/purchasing/units'
import type { TexTicketRow, TexTicketWarning } from '../../protocol'
import { type Found, pickNamed, textKey } from '../negocio/_carta-values'
import { cappedBySize, compact, shortText } from '../read/common'

/**
 * Lo que Tex lee y arma de Compras (los pedidos a proveedores), puro. Lo que se pide va en
 * presentaciones («3 × Caja x 12»), con el mismo texto del WhatsApp y del panel (`packsText`). Lo prueba
 * `tex-pedidos.test.ts`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Lo que se le muestra de cada pedido en la lista: el detalle, con `pedido`. */
const LINES_IN_LIST = 30
const ORDERS_MAX = 40
const SEARCH_MAX = 15

export const ORDER_FILTERS = [
  'para_mandar',
  'enviados',
  'por_llegar',
  'con_diferencias',
  'cerrados',
] as const
export type OrderFilter = (typeof ORDER_FILTERS)[number]

const STATUS_WORDS: Record<PurOrder['status'], string> = {
  draft: 'para revisar y mandar',
  sent: 'enviado, esperando respuesta',
  confirmed: 'confirmado, por llegar',
  with_differences: 'llegó con diferencias',
  completed: 'completado',
  discarded: 'descartado',
}

// ─── Cómo se lee cada cosa ───────────────────────────────────────────────────

type PackLike = {
  packs: number | null | undefined
  packLabel: string | null
  packSize: number | null
  unit: string
}

/** «3 × Caja x 12», «a definir», «no se pide». */
export function packsLabel(line: PackLike): string {
  if (line.packs == null) return 'a definir'
  if (line.packs <= 0) return 'no se pide'
  return packsText(line)
}

/** Lo que había cuando contó la cocina. */
export function stockText(line: PurOrderLine): string | null {
  switch (line.countState) {
    case null:
      return line.addedByHand ? null : 'no se contó'
    case 'enough':
      return 'alcanza'
    case 'none':
      return 'no hay'
    case 'low':
      return `poco (≈ ${formatAmount(line.countedQty, line.unit)})`
    default:
      return formatAmount(line.countedQty, line.unit)
  }
}

function orderedOf(line: PurOrderLine): PackLike {
  return { ...line, packs: line.orderedPacks }
}

function dayOf(timestamp: string | null): string | null {
  const day = timestamp ? isoDayInCordoba(timestamp) : null
  return day ? formatDayMonth(day) : null
}

/** «Limón: 2 kg», hasta los que entran; el resto se cuenta. */
function shortLines(lines: readonly PurOrderLine[], text: (l: PurOrderLine) => string): string[] {
  const out = lines.slice(0, LINES_IN_LIST).map((l) => `${l.name}: ${text(l)}`)
  if (lines.length > LINES_IN_LIST) out.push(`y ${lines.length - LINES_IN_LIST} más`)
  return out
}

function draftLineDetail(line: PurOrderLine) {
  return compact({
    renglon: line.id,
    producto: line.name,
    pedir: packsLabel(orderedOf(line)),
    sugerido:
      line.suggestedPacks == null
        ? line.addedByHand
          ? undefined
          : 'a definir (no tiene objetivo)'
        : formatQty(line.suggestedPacks),
    habia: stockText(line),
    objetivo: line.targetQty == null ? undefined : formatAmount(line.targetQty, line.unit),
    eventos: line.eventNames.length ? line.eventNames : undefined,
    para_eventos: line.eventQty > 0 ? formatAmount(line.eventQty, line.unit) : undefined,
    en_camino: line.inTransitQty > 0 ? formatAmount(line.inTransitQty, line.unit) : undefined,
    a_mano: line.addedByHand || undefined,
  })
}

/** Un pedido como lo lee Tex: lo que importa en su estado. Con `detail`, cada renglón con su cuenta. */
export function orderData(input: {
  order: PurOrder
  supplier: PurSupplier | null
  today: string
  detail: boolean
}) {
  const { order, supplier, today, detail } = input
  const base = {
    id: order.id,
    proveedor: supplier?.name ?? 'Sin proveedor',
    estado: STATUS_WORDS[order.status],
  }
  const ordered = order.lines.filter((l) => (l.orderedPacks ?? 0) > 0)
  switch (order.status) {
    case 'draft': {
      const expected = effectiveDeliveryDate(order.expectedDate, supplier, today)
      const undefinedNames = order.lines.filter((l) => l.orderedPacks == null).map((l) => l.name)
      return compact({
        ...base,
        entrega: expected ? relativeDayLabel(expected, today) : null,
        sin_whatsapp: supplier && !supplier.whatsapp ? 'el botón copia el mensaje' : null,
        sin_dias_de_entrega:
          supplier && !supplier.deliveryWeekdays.length ? 'el mensaje pregunta cuándo puede' : null,
        falta: !supplier
          ? 'elegir a qué proveedor se le pide'
          : undefinedNames.length
            ? `decir cuánto pedir de ${undefinedNames.join(', ')}`
            : null,
        nota_para_el_proveedor: shortText(order.supplierNote, 200),
        renglones: detail
          ? order.lines.map(draftLineDetail)
          : shortLines(order.lines, (l) => packsLabel(orderedOf(l))),
      })
    }
    case 'sent':
      return compact({
        ...base,
        enviado: dayOf(order.sentAt),
        entrega_prevista: order.expectedDate ? relativeDayLabel(order.expectedDate, today) : null,
        renglones: detail
          ? ordered.map((l) => ({
              renglon: l.id,
              producto: l.name,
              pedido: packsText(orderedOf(l)),
            }))
          : shortLines(ordered, (l) => packsText(orderedOf(l))),
      })
    case 'confirmed':
      return compact({
        ...base,
        confirmado: dayOf(order.confirmedAt),
        con_cambios: order.confirmedWithChanges || null,
        llega: order.expectedDate ? relativeDayLabel(order.expectedDate, today) : null,
        nota_para_la_cocina: shortText(order.kitchenNote, 200),
        renglones: shortLines(ordered, (l) => {
          const viene = expectedPacks(l)
          const text = viene > 0 ? packsText({ ...l, packs: viene }) : 'no viene'
          return l.confirmedPacks != null && l.confirmedPacks !== l.orderedPacks
            ? `${text} (se pidió ${packsText(orderedOf(l))})`
            : text
        }),
      })
    case 'with_differences': {
      const diffs = order.lines.filter(
        (l) => l.receivedState === 'partial' || l.receivedState === 'missing',
      )
      return compact({
        ...base,
        recibio: order.receivedByName ?? 'la cocina',
        recibido: dayOf(order.receivedAt),
        diferencias: diffs.map((l) => {
          const got = l.receivedPacks ?? 0
          const expected = packsText({ ...l, packs: expectedPacks(l) })
          return `${l.name}: se esperaba ${expected} y ${got > 0 ? `llegó ${packsText({ ...l, packs: got })}` : 'no llegó'}`
        }),
      })
    }
    default:
      return compact({
        ...base,
        estado:
          order.status === 'discarded'
            ? order.discardReason === 'skipped'
              ? 'descartado («Hoy no pido»)'
              : 'descartado (lo reemplazó otro conteo)'
            : base.estado,
        cuando: dayOf(order.closedAt ?? order.discardedAt ?? order.receivedAt),
        productos: ordered.length,
      })
  }
}

export function filterStatuses(filter: OrderFilter | undefined): readonly PurOrder['status'][] {
  switch (filter) {
    case 'para_mandar':
      return ['draft']
    case 'enviados':
      return ['sent']
    case 'por_llegar':
      return ['confirmed']
    case 'con_diferencias':
      return ['with_differences']
    case 'cerrados':
      return ['completed', 'discarded']
    default:
      return ['draft', 'sent', 'confirmed', 'with_differences']
  }
}

const SECTION: Record<PurOrder['status'], string> = {
  draft: 'para_mandar',
  sent: 'enviados',
  confirmed: 'por_llegar',
  with_differences: 'con_diferencias',
  completed: 'cerrados',
  discarded: 'cerrados',
}

/** Los pedidos agrupados como en el panel, cortados por tamaño para que Tex no lea un JSON roto. */
export function ordersData(input: {
  orders: readonly PurOrder[]
  suppliers: readonly PurSupplier[]
  today: string
}) {
  const byId = new Map(input.suppliers.map((s) => [s.id, s]))
  const rows = input.orders.map((order) => ({
    section: SECTION[order.status],
    row: orderData({
      order,
      supplier: order.supplierId ? (byId.get(order.supplierId) ?? null) : null,
      today: input.today,
      detail: false,
    }),
  }))
  const { filas, hay_mas } = cappedBySize(rows, ORDERS_MAX, 10_000)
  const grouped: Record<string, unknown[]> = {}
  for (const { section, row } of filas) {
    const list = grouped[section] ?? []
    list.push(row)
    grouped[section] = list
  }
  return { ...grouped, ...(hay_mas ? { hay_mas: 'pedí un estado o un proveedor' } : {}) }
}

export function openCountData(count: PurCount | null) {
  if (!count) return null
  return {
    quien: count.countedByName,
    desde: dayOf(count.createdAt),
    tipo: COUNT_KIND_LABELS[count.kind],
  }
}

const EVENT_STATUS: Record<PlannedEvent['status'], string> = {
  sums: 'suma a los pedidos',
  no_recipe: 'el formato no tiene receta',
  needs_variant: 'falta elegir la variante: hasta entonces no suma',
  skipped: 'se dijo que no suma',
  notice_only: 'la receta es solo un aviso',
}

/** Qué pasa con lo de un proveedor para un evento, en una frase (lo mismo que dice el panel). */
export function deadlineText(row: SupplierDeadline, today: string): string {
  const day = (d: string | null) => (d ? relativeDayLabel(d, today) : '¿?')
  switch (row.status) {
    case 'count':
      return `lo trae el conteo del ${longDayLabel(row.countDate ?? today)} (pedir hasta ${day(row.orderBy)})`
    case 'counted':
      return 'lo vio un conteo y alcanzaba con lo que había'
    case 'draft':
      return `está en el pedido para revisar: mandarlo hasta ${day(row.orderBy)}`
    case 'draft_late':
      return `está en el pedido para revisar, pero llega ${day(row.arrives)}: tarde`
    case 'ordered':
      return row.received ? `llegó ${day(row.arrives)}` : `pedido, llega ${day(row.arrives)}`
    case 'ordered_late':
      return `pedido, pero llega ${day(row.arrives)}: tarde`
    case 'today':
      return 'hay que pedirlo hoy (ningún conteo llega a tiempo)'
    case 'late':
      return `tarde: había que pedirlo hasta ${day(row.orderBy)}${row.arrives ? `; pedido hoy llega ${day(row.arrives)}` : ''}`
    case 'todo':
      return `pedirlo aparte hasta ${day(row.orderBy)} (ningún conteo llega a tiempo)`
    default:
      return 'sin proveedor: asignarle uno en Insumos'
  }
}

/**
 * Los eventos de la semana con hasta cuándo pedirle a cada proveedor para que todo llegue N días antes. Lo
 * que no es «lo trae un conteo», «alcanzaba» o «pedido a tiempo» es lo que hay que mirar.
 */
export function eventsData(deadlines: readonly EventDeadline[], today: string) {
  return deadlines.slice(0, 12).map((e) => {
    const p = e.planned
    return compact({
      evento: p.label,
      compras: EVENT_STATUS[p.status],
      variantes:
        p.status === 'needs_variant' ? p.variants.map((v) => v.variant).join(', ') : undefined,
      personas: p.status === 'sums' ? p.guests : undefined,
      tiene_que_llegar_hasta:
        p.status === 'sums' ? relativeDayLabel(e.mustArriveBy, today) : undefined,
      proveedores: e.suppliers.length
        ? e.suppliers.map((row) => ({
            proveedor: row.supplier?.name ?? 'Sin proveedor',
            insumos: row.items.length,
            estado: deadlineText(row, today),
          }))
        : undefined,
    })
  })
}

export function issuesData(issues: readonly DataIssue[]) {
  if (!issues.length) return null
  const byGroup: Partial<Record<IssueGroup, number>> = {}
  for (const issue of issues) byGroup[issue.group] = (byGroup[issue.group] ?? 0) + 1
  return {
    total: issues.length,
    por_grupo: byGroup,
    ejemplos: issues.slice(0, 6).map((i) => i.text),
  }
}

// ─── Insumos y proveedores ───────────────────────────────────────────────────

/** «coca zero» encuentra «Coca Cola Zero»; también por marca y código. */
function matches(item: PurItem, wanted: string): boolean {
  const key = textKey(`${item.name} ${item.brand ?? ''} ${item.code ?? ''}`)
  return textKey(wanted)
    .split(' ')
    .every((word) => key.includes(word))
}

/** «Caja x 12», «por kg», «por unidad»: cómo se compra. */
export function packLabelOf(item: Pick<PurItem, 'packLabel' | 'packSize' | 'unit'>): string {
  const one = packsText({
    packs: 1,
    packLabel: item.packLabel,
    packSize: item.packSize,
    unit: item.unit,
  })
  if (one.startsWith('1 × ')) return one.slice(4)
  const unit = one.replace(/^1 /, '')
  return `por ${unit === 'u' ? 'unidad' : unit}`
}

export function itemsData(input: {
  items: readonly PurItem[]
  suppliers: readonly PurSupplier[]
  /** Por insumo, el proveedor del borrador donde ya está. */
  inDraft: ReadonlyMap<string, string>
  text: string
  supplierId: string | null
}) {
  const names = new Map(input.suppliers.map((s) => [s.id, s.name]))
  const found = input.items.filter(
    (i) =>
      i.active &&
      matches(i, input.text) &&
      (input.supplierId === null || i.supplierId === input.supplierId),
  )
  return {
    insumos: found.slice(0, SEARCH_MAX).map((i) =>
      compact({
        id: i.id,
        insumo: i.name,
        marca: i.brand ?? undefined,
        codigo: i.code ?? undefined,
        se_cuenta_en: i.unit,
        se_compra: packLabelOf(i),
        proveedor: i.supplierId ? (names.get(i.supplierId) ?? 'sin proveedor') : 'sin proveedor',
        objetivo: i.targetQty == null ? undefined : formatAmount(i.targetQty, i.unit),
        frecuencia: FREQUENCY_LABELS[i.frequency],
        ya_en_el_pedido_de: input.inDraft.get(i.id),
      }),
    ),
    hay_mas: found.length > SEARCH_MAX,
  }
}

/** El celular de un proveedor, sin mostrarlo entero: Tex no necesita el número. */
export function phoneTail(whatsapp: string | null): string {
  return whatsapp ? `cargado (termina en ${whatsapp.slice(-4)})` : 'falta'
}

export function suppliersData(input: {
  suppliers: readonly PurSupplier[]
  items: readonly PurItem[]
  text: string | null
  missingOnly: boolean
}) {
  const used = new Map<string, number>()
  for (const i of input.items) {
    if (i.active && i.supplierId) used.set(i.supplierId, (used.get(i.supplierId) ?? 0) + 1)
  }
  const wanted = input.text ? textKey(input.text) : null
  const rows = input.suppliers.filter((s) => {
    if (wanted && !textKey(s.name).includes(wanted)) return false
    if (input.missingOnly) return s.active && (!s.whatsapp || !s.deliveryWeekdays.length)
    return true
  })
  return {
    proveedores: rows.slice(0, ORDERS_MAX).map((s) =>
      compact({
        id: s.id,
        proveedor: s.name,
        contacto: s.contactName ?? undefined,
        whatsapp: phoneTail(s.whatsapp),
        entrega: s.deliveryWeekdays.length ? weekdaysText(s.deliveryWeekdays) : 'faltan los días',
        pedir_con:
          s.leadDays === 1 ? '1 día de anticipación' : `${s.leadDays} días de anticipación`,
        insumos: used.get(s.id) ?? 0,
        activo: s.active ? undefined : false,
      }),
    ),
    hay_mas: rows.length > ORDERS_MAX,
    sin_whatsapp: input.suppliers.filter((s) => s.active && !s.whatsapp).length,
    sin_dias_de_entrega: input.suppliers.filter((s) => s.active && !s.deliveryWeekdays.length)
      .length,
  }
}

export function pickSupplier(
  suppliers: readonly PurSupplier[],
  wanted: string,
): Found<PurSupplier> {
  return pickNamed(suppliers, wanted, {
    option: (s) => `${s.name}${s.active ? '' : ' (desactivado)'} (id ${s.id})`,
    none: `No encontré el proveedor «${wanted.trim()}» en Compras. Mirá los que hay con ver_proveedores_compras.`,
  })
}

// ─── Qué productos y cuánto ──────────────────────────────────────────────────

export type WantedProduct = { producto: string; cantidad: number }

export type ProductPlan = {
  /** Lo nuevo de cada renglón que ya está en el pedido. */
  packs: Map<string, number>
  /** Lo que se suma, en el orden en que lo dijo. */
  added: Array<{ item: PurItem; packs: number }>
}

/**
 * Cada producto que nombró, contra el pedido primero (por renglón, por insumo o por nombre) y después
 * contra la lista de insumos. Nunca elige a ojo: si hay dos que coinciden, Tex pregunta.
 */
export function resolveProducts(input: {
  wanted: readonly WantedProduct[]
  lines: readonly PurOrderLine[]
  items: readonly PurItem[]
}): Found<ProductPlan> {
  const packs = new Map<string, number>()
  const added: ProductPlan['added'] = []
  const inOrder = new Set(input.lines.map((l) => l.itemId).filter(Boolean))
  const active = input.items.filter((i) => i.active)
  for (const want of input.wanted) {
    const text = want.producto.trim()
    const qty = roundQty(want.cantidad)
    const asId = UUID_RE.test(text) ? text.toLowerCase() : null
    let line = asId ? input.lines.find((l) => l.id === asId || l.itemId === asId) : undefined
    if (!line && !asId) {
      const named = pickNamed(input.lines, text, {
        option: (l) => `${l.name} (renglón ${l.id})`,
        none: '',
      })
      if (named.ok) line = named.value
      else if (named.many) return named
    }
    if (line) {
      if (packs.has(line.id)) return { ok: false, message: `«${line.name}» está dos veces.` }
      packs.set(line.id, qty)
      continue
    }
    let item: PurItem | undefined
    if (asId) {
      item = active.find((i) => i.id === asId)
    } else {
      const named = pickNamed(active, text, {
        option: (i) =>
          `${i.name}${i.brand ? ` · ${i.brand}` : ''}, se compra ${packLabelOf(i)} (id ${i.id})`,
        none: '',
      })
      if (named.ok) item = named.value
      else if (named.many) return named
    }
    if (!item) {
      return {
        ok: false,
        message: `No encontré «${text}» en la lista de insumos de Compras. Buscalo con buscar_insumos; si no está, se suma en Compras › Insumos.`,
      }
    }
    const existing = inOrder.has(item.id)
      ? input.lines.find((l) => l.itemId === item.id)
      : undefined
    if (existing) {
      if (packs.has(existing.id))
        return { ok: false, message: `«${existing.name}» está dos veces.` }
      packs.set(existing.id, qty)
      continue
    }
    if (added.some((a) => a.item.id === item.id)) {
      return { ok: false, message: `«${item.name}» está dos veces.` }
    }
    if (qty <= 0) {
      return { ok: false, message: `«${item.name}» no está en el pedido: no hay nada que sacar.` }
    }
    added.push({ item, packs: qty })
  }
  return { ok: true, value: { packs, added } }
}

/** Lo que nombró, entre los renglones de un pedido: lo que se confirma solo puede ser de ahí. */
export function resolveInOrder(
  wanted: readonly WantedProduct[],
  lines: readonly PurOrderLine[],
): Found<Map<string, number>> {
  const out = new Map<string, number>()
  for (const want of wanted) {
    const text = want.producto.trim()
    const missing = `«${text}» no está en este pedido.`
    let line: PurOrderLine | undefined
    if (UUID_RE.test(text)) {
      const id = text.toLowerCase()
      line = lines.find((l) => l.id === id || l.itemId === id)
    } else {
      const named = pickNamed(lines, text, {
        option: (l) => `${l.name} (renglón ${l.id})`,
        none: missing,
      })
      if (!named.ok) return named
      line = named.value
    }
    if (!line) return { ok: false, message: missing }
    if (out.has(line.id)) return { ok: false, message: `«${line.name}» está dos veces.` }
    out.set(line.id, roundQty(want.cantidad))
  }
  return { ok: true, value: out }
}

// ─── Lo que muestra el tique ─────────────────────────────────────────────────

/** Lo que cambia, renglón por renglón: «2 kg → 3 kg». */
export function changeRows(input: {
  lines: readonly PurOrderLine[]
  plan: ProductPlan
}): TexTicketRow[] {
  const rows: TexTicketRow[] = []
  for (const line of input.lines) {
    if (!input.plan.packs.has(line.id)) continue
    const next = input.plan.packs.get(line.id) ?? null
    if (next === line.orderedPacks) continue
    rows.push({
      label: line.name,
      value: `${packsLabel(orderedOf(line))} → ${packsLabel({ ...line, packs: next })}`,
    })
  }
  for (const a of input.plan.added) {
    rows.push({ label: a.item.name, value: `nuevo: ${packsLabel({ ...a.item, packs: a.packs })}` })
  }
  return rows
}

/** Lo que va en el WhatsApp, como lo va a leer el proveedor. */
export function sendRows(lines: readonly DraftLine[]): TexTicketRow[] {
  return lines.map((l) => ({ label: l.name, value: packsLabel(l) }))
}

/** Insumos que en la lista son de otro proveedor: van igual en este pedido, pero se avisa. */
export function otherSupplierWarning(input: {
  added: ProductPlan['added']
  supplierId: string | null
  suppliers: readonly PurSupplier[]
}): TexTicketWarning | null {
  if (!input.supplierId) return null
  const names = new Map(input.suppliers.map((s) => [s.id, s.name]))
  const others = input.added.filter(
    (a) => a.item.supplierId && a.item.supplierId !== input.supplierId,
  )
  if (!others.length) return null
  return {
    key: 'otro_proveedor',
    title: others
      .map((a) => `${a.item.name} se le compra a ${names.get(a.item.supplierId ?? '') ?? 'otro'}`)
      .join('; '),
    body: 'Va igual en este pedido.',
  }
}

export function deliveryText(expected: string | null, today: string): string {
  return expected ? `entrega ${relativeDayLabel(expected, today)}` : 'sin días de entrega'
}

// ─── Los días de entrega ─────────────────────────────────────────────────────

const WEEKDAY_KEYS: Record<string, number> = {
  domingo: 0,
  dom: 0,
  lunes: 1,
  lun: 1,
  martes: 2,
  mar: 2,
  miercoles: 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sabado: 6,
  sab: 6,
}

/** «lunes», «miércoles», «sáb» → 1, 3, 6. */
export function parseWeekdays(names: readonly string[]): Found<number[]> {
  const days = new Set<number>()
  for (const name of names) {
    const day = WEEKDAY_KEYS[textKey(name)]
    if (day === undefined) return { ok: false, message: `«${name}» no es un día de la semana.` }
    days.add(day)
  }
  return { ok: true, value: [...days].sort((a, b) => a - b) }
}
