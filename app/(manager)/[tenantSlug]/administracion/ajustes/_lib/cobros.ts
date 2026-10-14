/**
 * Lo que «Medios de cobro» MUESTRA (rediseño de octubre 2026), puro: cuánto te
 * llega de cada $ 10.000 según cómo te pagan, a dónde va cada cobro dicho en
 * palabras, en qué grupo del cierre del día cae cada medio y qué hay que
 * guardar cuando se cambia el orden. Lo prueba
 * `administracion-ajustes-cobros.test.ts`.
 *
 * Ninguna cuenta es nueva: «de cada $ 10.000» es `prefillDeductions`, lo mismo
 * que precarga «Registrar un cobro» con las tasas del partícipe. Y el grupo de
 * cada medio sale de `describeCloseMethod`, el del Cierre del día: la columna
 * de Ajustes y la del cierre se arman con la misma regla.
 */

import {
  Banknote,
  Bike,
  CreditCard,
  HandCoins,
  type LucideIcon,
  NotebookPen,
  QrCode,
} from 'lucide-react'
import {
  type CloseMethodGroup,
  type CloseMethodLookup,
  describeCloseMethod,
  groupCloseMethods,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-view'
import { prefillDeductions } from '@/lib/accounting/posting/collection'
import type {
  Channel,
  PartyKind,
  PartyRates,
  SalesMethodKind,
  TreasuryKind,
} from '@/lib/accounting/types'
import { formatCentsShort } from '@/lib/money'
import { formatBp } from './percent'

// ─── De cada $ 10.000 ────────────────────────────────────────────────────────

/** La venta de ejemplo con la que se muestra todo: $ 10.000, en centavos. */
export const SAMPLE_GROSS_CENTS = 1_000_000

const RATE_KEYS = [
  'commissionBp',
  'iibbWithholdingBp',
  'vatWithholdingBp',
  'incomeTaxWithholdingBp',
  'sircupaBp',
] as const satisfies ReadonlyArray<keyof PartyRates>

/** ¿Hay ALGUNA tasa cargada? Sin ninguna no se sabe cuánto descuenta (no es «no descuenta»). */
export function hasRates(rates: PartyRates | null | undefined): rates is PartyRates {
  if (!rates) return false
  return RATE_KEYS.some((key) => {
    const value = rates[key]
    return value !== null && value !== undefined && Number.isFinite(value)
  })
}

export type ChargeBreakdown = {
  grossCents: number
  commissionCents: number
  /** El IVA de la comisión (21 % de la comisión). */
  commissionVatCents: number
  /** Ingresos Brutos, IVA, Ganancias y lo que retiene la billetera. */
  withholdingsCents: number
  netCents: number
}

/**
 * Cómo se reparte una venta de $ 10.000 con esas tasas. `null` si no hay
 * ninguna tasa cargada: sin dato no es sin descuento, y nunca se afirma que
 * «llegan $ 10.000».
 */
export function chargeBreakdown(rates: PartyRates | null | undefined): ChargeBreakdown | null {
  if (!hasRates(rates)) return null
  let commission = 0
  let commissionVat = 0
  let withholdings = 0
  for (const d of prefillDeductions(SAMPLE_GROSS_CENTS, rates)) {
    if (d.taxKind === 'comision') commission += d.amountCents
    else if (d.taxKind === 'iva_comision') commissionVat += d.amountCents
    else withholdings += d.amountCents
  }
  return {
    grossCents: SAMPLE_GROSS_CENTS,
    commissionCents: commission,
    commissionVatCents: commissionVat,
    withholdingsCents: withholdings,
    // Tasas disparatadas (más del 100 %) no dan plata negativa: no llega nada.
    netCents: Math.max(0, SAMPLE_GROSS_CENTS - commission - commissionVat - withholdings),
  }
}

/** Lo que te llega de cada $ 10.000, en centavos. `null` = todavía no se cargó cuánto descuenta. */
export function netOfTenThousand(rates: PartyRates | null | undefined): number | null {
  return chargeBreakdown(rates)?.netCents ?? null
}

/**
 * Lo que dice la píldora de un medio: «Comisión 6,29 % + IVA», «Sin comisión»,
 * «Solo retenciones»… o `null` si no hay nada cargado (ahí la píldora pide
 * «Cargar la comisión»).
 */
export function rateLabel(rates: PartyRates | null | undefined): string | null {
  if (!hasRates(rates)) return null
  const commission = rates.commissionBp
  const withholds =
    (rates.iibbWithholdingBp ?? 0) +
      (rates.vatWithholdingBp ?? 0) +
      (rates.incomeTaxWithholdingBp ?? 0) +
      (rates.sircupaBp ?? 0) >
    0
  if (commission === null || commission === undefined) return 'Solo retenciones'
  if (commission === 0) return withholds ? 'Sin comisión, con retenciones' : 'Sin comisión'
  return `Comisión ${formatBp(commission)} + IVA${withholds ? ' y retenciones' : ''}`
}

// ─── A dónde va cada cobro ───────────────────────────────────────────────────

export type FlowSource = {
  name: string
  kind: SalesMethodKind
  settlementDays: number
  treasuryName: string | null
  partyName: string | null
}

/**
 * Qué pasa con lo cobrado, en una línea (va después de una flecha): «Entra a
 * Caja», «Queda en camino a Mercado Pago», «Llega a los 10 días · Tarjetas de
 * crédito (Posnet)». Las mismas palabras que el Cierre del día, con el plazo
 * en días en vez de una fecha (acá no hay un día en particular).
 */
export function flowText(m: FlowSource): string {
  switch (m.kind) {
    case 'treasury':
      return `Entra a ${m.treasuryName ?? 'una caja'}`
    case 'settled_now':
      return `Queda en camino a ${m.partyName ?? m.treasuryName ?? 'la billetera'}`
    case 'receivable': {
      const days = Math.max(0, Math.trunc(m.settlementDays))
      const when =
        days === 0
          ? 'Llega en el día'
          : days === 1
            ? 'Llega al día siguiente'
            : `Llega a los ${days} días`
      // Si quien paga se llama igual que el medio («PedidosYa»), no se repite.
      const who = m.partyName && m.partyName !== m.name ? ` · ${m.partyName}` : ''
      return `${when}${who}`
    }
    case 'customer_account':
      return 'Queda en la cuenta de cada cliente'
    case 'advance':
      return 'Se descuenta de las señas'
  }
}

/** Para la tabla: «En el momento», «En camino», «A los 10 días». */
export function arrivalWord(m: Pick<FlowSource, 'kind' | 'settlementDays'>): string {
  switch (m.kind) {
    case 'treasury':
      return 'En el momento'
    case 'settled_now':
      return 'En camino'
    case 'receivable': {
      const days = Math.max(0, Math.trunc(m.settlementDays))
      return days === 0 ? 'En el día' : days === 1 ? 'Al día siguiente' : `A los ${days} días`
    }
    case 'customer_account':
      return 'Cuando paga el cliente'
    case 'advance':
      return 'Ya entró'
  }
}

// ─── Los grupos del cierre ───────────────────────────────────────────────────

/**
 * Cómo se llama y qué ícono lleva cada grupo. Es copia de `GROUP_META` del
 * formulario del Cierre del día (que no exporta la suya): un test compara los
 * títulos contra ese archivo para que no se desvíen.
 */
export const CLOSE_GROUP_META: Readonly<
  Record<CloseMethodGroup, { title: string; icon: LucideIcon }>
> = {
  cash: { title: 'Efectivo', icon: Banknote },
  wallet: { title: 'Billeteras y transferencias', icon: QrCode },
  cards: { title: 'Tarjetas', icon: CreditCard },
  delivery: { title: 'Apps de delivery', icon: Bike },
  account: { title: 'Cuenta corriente', icon: NotebookPen },
  advance: { title: 'Señas', icon: HandCoins },
}

/** El título de un grupo: «Mercado Pago» si todos sus medios lo son (como en el Cierre). */
export function closeGroupTitle(
  group: CloseMethodGroup,
  methods: ReadonlyArray<{ mercadoPago: boolean }>,
): string {
  if (group === 'wallet' && methods.length > 0 && methods.every((m) => m.mercadoPago)) {
    return 'Mercado Pago'
  }
  return CLOSE_GROUP_META[group].title
}

export type LookupMethod = {
  id: string
  kind: SalesMethodKind
  channel: Channel
  treasuryAccountId: string | null
  partyId: string | null
}
export type LookupTreasury = {
  id: string
  name: string
  kind: TreasuryKind
  bankPartyId: string | null
}
export type LookupParty = {
  id: string
  name: string
  tradeName?: string | null
  systemKey: string | null
}

/**
 * Lo que el Cierre del día mira de un medio para agruparlo: su caja, quién lo
 * paga, si es el efectivo y si es de Mercado Pago. Copia la regla de
 * `ventas/cierre/page.tsx` con el Mercado Pago DE FÁBRICA: el partícipe
 * `mercado_pago` y las billeteras que cuelgan de él. (El Cierre mira además la
 * conexión de Importar › Mercado Pago; con otra billetera conectada un medio
 * podría caer en otro grupo: es el riesgo anotado en la spec.)
 */
export function closeLookup(
  method: LookupMethod,
  catalog: { treasuries: readonly LookupTreasury[]; parties: readonly LookupParty[] },
): CloseMethodLookup {
  const treasury = catalog.treasuries.find((t) => t.id === method.treasuryAccountId) ?? null
  const party = catalog.parties.find((p) => p.id === method.partyId) ?? null
  const mpPartyId = catalog.parties.find((p) => p.systemKey === 'mercado_pago')?.id ?? null
  const mpTreasuryIds = catalog.treasuries
    .filter((t) => t.kind === 'wallet' && mpPartyId !== null && t.bankPartyId === mpPartyId)
    .map((t) => t.id)
  const isCash = method.kind === 'treasury' && treasury?.kind === 'cash'
  const mercadoPago =
    method.channel !== 'delivery' &&
    ((party !== null && party.id === mpPartyId) ||
      (treasury !== null && mpTreasuryIds.includes(treasury.id)))
  return {
    treasury: treasury ? { id: treasury.id, name: treasury.name, kind: treasury.kind } : null,
    party: party ? { id: party.id, name: party.tradeName ?? party.name } : null,
    isCash,
    mercadoPago,
  }
}

export type GroupedMethod<M> = M & { group: CloseMethodGroup; mercadoPago: boolean }

/** Los medios con su grupo del cierre (el día no importa: el grupo no depende de la fecha). */
export function withCloseGroup<M extends LookupMethod & { settlementDays: number }>(
  methods: readonly M[],
  catalog: { treasuries: readonly LookupTreasury[]; parties: readonly LookupParty[] },
): GroupedMethod<M>[] {
  return methods.map((m) => {
    const lookup = closeLookup(m, catalog)
    const view = describeCloseMethod(m, '2026-01-01', lookup)
    return { ...m, group: view.group, mercadoPago: lookup.mercadoPago }
  })
}

export { groupCloseMethods }

/**
 * ¿El orden deja separados dos medios del mismo grupo? En el cierre los del
 * mismo tipo se muestran juntos, así que la columna pegada no coincidiría.
 */
export function splitsAGroup(groups: readonly CloseMethodGroup[]): boolean {
  const closed = new Set<CloseMethodGroup>()
  let previous: CloseMethodGroup | null = null
  for (const group of groups) {
    if (group !== previous) {
      if (closed.has(group)) return true
      if (previous !== null) closed.add(previous)
      previous = group
    }
  }
  return false
}

// ─── El título que afirma ────────────────────────────────────────────────────

export type ChargeRow = {
  name: string
  /** El medio tiene a alguien que descuenta (tarjeta, app, billetera). */
  charges: boolean
  /** Lo que llega de cada $ 10.000; `null` = falta cargar la comisión. */
  netCents: number | null
}

export type ChargeTitle = {
  title: string
  sentence: string
  /** «Sin comisión cargada: Rappi, Uber Eats y Mercado Pago Delivery.» */
  missing: string | null
  /** El peor caso, para «¿Cómo se calcula?». */
  worst: ChargeRow | null
}

/** «Rappi» · «Rappi y Pedix» · «Rappi, Uber Eats y Pedix». */
export function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

const MISSING_MAX = 4

/**
 * El título del panel de medios, que AFIRMA en vez de describir: el peor caso
 * («lo que más te descuenta»), o qué falta cargar para poder decirlo. Solo
 * mira los medios prendidos.
 */
export function chargeTitle(rows: readonly ChargeRow[]): ChargeTitle {
  if (rows.length === 0) {
    return {
      title: 'Todavía no hay ningún medio de cobro prendido.',
      sentence: 'Sin medios no se puede cargar el cierre del día: prendé o agregá los que usás.',
      missing: null,
      worst: null,
    }
  }
  const charging = rows.filter((r) => r.charges)
  const known = charging.filter((r): r is ChargeRow & { netCents: number } => r.netCents !== null)
  const lacking = charging.filter((r) => r.netCents === null).map((r) => r.name)
  const missing =
    lacking.length === 0
      ? null
      : `Sin comisión cargada: ${joinWords(
          lacking.length > MISSING_MAX
            ? [...lacking.slice(0, MISSING_MAX - 1), `${lacking.length - (MISSING_MAX - 1)} más`]
            : lacking,
        )}.`

  if (known.length === 0) {
    return {
      title:
        charging.length === 0
          ? 'Todo lo que cobrás te llega entero.'
          : 'Todavía no cargaste cuánto te descuenta cada uno.',
      sentence:
        charging.length === 0
          ? 'Ningún medio prendido tiene comisión: lo que entra es lo que vendiste.'
          : 'Con la comisión de cada tarjeta y cada app, acá ves cuánto te llega según cómo te pagan.',
      missing,
      worst: null,
    }
  }
  // El peor: el que menos deja; a igualdad, el primero en el orden del cierre.
  const worst = known.reduce((a, b) => (b.netCents < a.netCents ? b : a))
  const amount = formatCentsShort(worst.netCents)
  const whole = formatCentsShort(SAMPLE_GROSS_CENTS)
  if (worst.netCents >= SAMPLE_GROSS_CENTS) {
    return {
      title: 'Con lo que cargaste, ningún medio te descuenta.',
      sentence: 'Si una tarjeta o una app te cobra comisión, cargala en su medio.',
      missing,
      worst: null,
    }
  }
  return {
    title:
      known.length === 1
        ? `Con ${worst.name}, de cada ${whole} te llegan ${amount}.`
        : `Lo que más te descuenta es ${worst.name}: de cada ${whole} te llegan ${amount}.`,
    sentence: 'Estimado con las comisiones que cargaste. El efectivo llega entero.',
    missing,
    worst,
  }
}

// ─── Cambiar el orden ────────────────────────────────────────────────────────

export type SortedMethod = { id: string; sort: number; active: boolean }

/**
 * Qué guardar cuando se cambia el orden: `{ id, sort }` SOLO de los medios
 * cuyo lugar cambia. Los prendidos se reparten los `sort` que ya tenían, de
 * menor a mayor (10, 20, …): así los apagados no se tocan y quedan donde
 * estaban. Si entre los prendidos hay `sort` repetidos, no alcanza con
 * repartirlos: todos pasan a `posición × 10`.
 *
 * `order` son los ids de los prendidos en el orden nuevo. Un id que no es de un
 * medio prendido se ignora; un prendido que falte queda al final, en su orden.
 */
export function reorderPlan(
  methods: readonly SortedMethod[],
  order: readonly string[],
): Array<{ id: string; sort: number }> {
  const active = methods.filter((m) => m.active)
  const byId = new Map(active.map((m) => [m.id, m]))
  const seen = new Set<string>()
  const next: SortedMethod[] = []
  for (const id of order) {
    const m = byId.get(id)
    if (m && !seen.has(id)) {
      next.push(m)
      seen.add(id)
    }
  }
  for (const m of active) if (!seen.has(m.id)) next.push(m)

  const sorts = active.map((m) => m.sort).sort((a, b) => a - b)
  const repeated = new Set(sorts).size !== sorts.length
  const plan: Array<{ id: string; sort: number }> = []
  next.forEach((m, index) => {
    const sort = repeated ? (index + 1) * 10 : (sorts[index] ?? (index + 1) * 10)
    if (sort !== m.sort) plan.push({ id: m.id, sort })
  })
  return plan
}

/** Mueve un id un lugar para arriba (−1) o para abajo (+1). Fuera de rango, queda igual. */
export function moveId(order: readonly string[], id: string, dir: -1 | 1): string[] {
  const index = order.indexOf(id)
  const target = index + dir
  if (index < 0 || target < 0 || target >= order.length) return [...order]
  const next = [...order]
  const [item] = next.splice(index, 1)
  if (item !== undefined) next.splice(target, 0, item)
  return next
}

// ─── La lista de CUIT ────────────────────────────────────────────────────────

/** Qué es cada uno, en una palabra (la lista «CUIT de tarjetas, apps, bancos y organismos»). */
export const PARTY_KIND_WORD: Readonly<Record<PartyKind, string>> = {
  supplier: 'Proveedor',
  customer: 'Clientes',
  card_processor: 'Tarjetas',
  payment_wallet: 'Billetera',
  delivery_platform: 'App de delivery',
  bank: 'Banco',
  tax_agency: 'Organismo',
  payroll: 'Sueldos',
  partner: 'Socio',
  other: 'Otro',
}

/** El orden de la lista: primero los que cobran, después bancos y organismos. */
export const PARTY_KIND_ORDER: Readonly<Record<string, number>> = {
  payment_wallet: 0,
  card_processor: 1,
  delivery_platform: 2,
  bank: 3,
  tax_agency: 4,
  payroll: 5,
  other: 6,
  supplier: 7,
  customer: 8,
}
