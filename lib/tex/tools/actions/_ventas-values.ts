/**
 * Lo que Tex arma para ventas, sin tocar la base: de lo que dijo la persona (ya pasado a ids) a lo mismo
 * que manda cada pantalla, con su tique. Puro: el cierre es el de `sales-close-form.tsx`, el cobro sale
 * de `buildCollectionValues` y los objetivos, de las mismas cuentas de la planilla. Lo que hay que leer
 * de la base lo trae `ventas.ts`. Lo prueba `tests/lib/tex-actions-ventas.test.ts`.
 *
 * Cada función devuelve `{ ok: false, message }` cuando falta algo: el mensaje es para Tex y le dice qué
 * preguntar.
 */

import {
  parseTargetsList,
  type TargetsImportResult,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/targets-import'
import { invoiceSplit } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-view'
import {
  buildCollectionValues,
  type CommissionVoucherType,
  type DeductionKind,
  emptyDeductions,
  settlementSummary,
  type VoucherMode,
} from '@/components/administracion/acciones/cobrar-cuenta'
import type { PostingCatalog } from '@/lib/accounting/context'
import { netFromGross, vatFromNet, vatRateLabel } from '@/lib/accounting/iva'
import { letterFor } from '@/lib/accounting/letter'
import { prefillDeductions } from '@/lib/accounting/posting/collection'
import {
  type SalesCloseBuildInput,
  summarizeSalesClose,
} from '@/lib/accounting/posting/sales-close'
import { copyMonthTargets, type TargetOfDay } from '@/lib/accounting/projection'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import type {
  Channel,
  CommissionVatMode,
  IvaCondition,
  OpenItemRef,
  PartyKind,
  PartyRates,
  PostingContext,
  SalesMethodKind,
  VatRateBp,
} from '@/lib/accounting/types'
import { VOUCHER_CATALOG, voucherDisplay, voucherLabel } from '@/lib/accounting/voucher-types'
import {
  addDays,
  capitalizeFirst,
  formatDayMonth,
  formatMonthLabel,
  formatWeekdayDayMonth,
  monthOf,
  weekdayName,
} from '@/lib/dates'
import type { TexTicketWarning } from '../../protocol'
import { money, type TexTicketDraft, zodIssuesText } from '../types'
import {
  byDue,
  type DocumentPlan,
  dayRow,
  fail,
  matchByName,
  notice,
  type PlanFailure,
  pickLines,
  row,
  rows,
  type TreasuryFacts,
} from './_compras-values'

// ─── Cierre del día ──────────────────────────────────────────────────────────

/** Un medio de cobro activo, con lo que hace falta para el cierre. */
export type CloseMethodFact = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  /** El efectivo que se puede contar: lleva «Efectivo contado». */
  isCash: boolean
}

/** Los medios activos, en el orden de Ajustes › Medios de cobro. Es lo que manda el formulario. */
export function closeMethodsOf(
  catalog: Pick<PostingCatalog, 'methods' | 'treasuries'>,
): CloseMethodFact[] {
  return catalog.methods
    .filter((m) => m.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      channel: m.channel,
      isCash:
        m.kind === 'treasury' &&
        catalog.treasuries.some((t) => t.id === m.treasuryAccountId && t.kind === 'cash'),
    }))
}

export const CLOSE_PAPERS = [
  'factura_b',
  'factura_a',
  'tique_factura_b',
  'tique_factura_a',
  'nota_credito_b',
  'nota_credito_a',
  'nota_debito_b',
  'nota_debito_a',
] as const
export type ClosePaper = (typeof CLOSE_PAPERS)[number]

export type CloseSalesPoint = { number: number; label: string; defaultChannel: Channel }

export type CierreDraft = {
  date: string
  methods: readonly CloseMethodFact[]
  /** Por el nombre del medio, como lo dijo. */
  sales: ReadonlyArray<{
    method: string
    cents: number
    /** En cuenta corriente, lo de cada cliente. */
    customers: ReadonlyArray<{ partyId: string; name: string; cents: number }>
  }>
  cashCountedCents: number | null
  invoiced: ReadonlyArray<{
    voucherType: ClosePaper
    pointOfSale: number | null
    /** `null`: el último «hasta» + 1. */
    from: number | null
    to: number | null
    totalCents: number
    /** `null`: 21 %. */
    rateBp: VatRateBp | null
    /** `null`: el del punto de venta. */
    channel: Channel | null
    /** En las A: el cliente con su CUIT. */
    party: { id: string; name: string } | null
  }>
  salesPoints: readonly CloseSalesPoint[]
  rangeDefaults: ReadonlyArray<{ voucherType: string; pointOfSale: number; lastNumberTo: number }>
  /** Los cierres ya cargados ese día: uno más pide turno. */
  existing: ReadonlyArray<{ title: string; totalCents: number }>
  shift: string | null
  controlTotalCents: number | null
  /** Por qué se facturó más de lo vendido. */
  reason: string | null
  ctx: PostingContext
  limits: { booksStart: string; serviceDay: string; firstOpenDate: string | null }
}

/** Lo que la pantalla del cierre no deja cargar. `null`: ese día se puede. */
export function closeDateIssue(date: string, limits: CierreDraft['limits']): string | null {
  if (date < limits.booksStart) {
    return `Administración arranca el ${formatDayMonth(limits.booksStart)}: las ventas de antes no se cargan.`
  }
  if (date > limits.serviceDay) {
    return `El ${formatWeekdayDayMonth(date)} todavía no llegó: el cierre se carga después de la noche.`
  }
  if (limits.firstOpenDate && date < limits.firstOpenDate) {
    return `${formatMonthLabel(date)} está cerrado: no se pueden cargar cierres de ese mes.`
  }
  return null
}

function namesOf(list: ReadonlyArray<{ name: string }>): string {
  return list.map((item) => item.name).join(', ')
}

/** Lo que manda «Cierre del día»: todos los medios activos (los que no dijo, en cero) y los rangos. */
export function cierrePlan(draft: CierreDraft): PlanFailure | DocumentPlan<'sales_close'> {
  const { date, methods } = draft
  const issue = closeDateIssue(date, draft.limits)
  if (issue) return fail(issue)
  if (methods.length === 0) {
    return fail(
      'No hay medios de cobro activos: hay que prenderlos en Ajustes › Medios de cobro. Llevala con ir_a.',
    )
  }
  const needsShift = draft.existing.length > 0
  const shift = draft.shift?.trim() ? draft.shift.trim() : null
  if (needsShift && shift === null) {
    const first = draft.existing[0]
    return fail(
      `Ese día ya tiene un cierre${first ? ` (${first.title}, ${money(first.totalCents)})` : ''}. Preguntale si este es otro turno y pasalo en turno (por ejemplo, «noche»); si es el mismo, ya está cargado.`,
    )
  }

  // ── Por medio ──
  const amounts = new Map<string, number>()
  const customers = new Map<string, CierreDraft['sales'][number]['customers']>()
  for (const sale of draft.sales) {
    const match = matchByName(sale.method, methods, (m) => [m.name, m.id])
    if (match.kind === 'many') {
      return fail(`«${sale.method}» puede ser ${namesOf(match.options)}. Preguntale cuál.`)
    }
    if (match.kind === 'none') {
      return fail(`No hay un medio de cobro «${sale.method}». Los que hay: ${namesOf(methods)}.`)
    }
    const method = match.value
    if (amounts.has(method.id)) return fail(`${method.name} está dos veces: sumalo en uno solo.`)
    amounts.set(method.id, sale.cents)
    if (method.kind === 'customer_account') {
      if (sale.cents > 0 && sale.customers.length === 0) {
        return fail(`En ${method.name} hace falta a qué clientes se le anotó y cuánto a cada uno.`)
      }
      const sum = sale.customers.reduce((acc, c) => acc + c.cents, 0)
      if (sum !== sale.cents) {
        return fail(
          `Lo de cada cliente en ${method.name} suma ${money(sum)}, y dijo ${money(sale.cents)}. Preguntale cuál está bien.`,
        )
      }
      customers.set(method.id, sale.customers)
    }
  }
  const sold = [...amounts.values()].reduce((acc, cents) => acc + cents, 0)
  if (sold <= 0) return fail('Preguntale cuánto se vendió por cada medio de cobro.')

  const cashMethod = methods.find((m) => m.isCash) ?? null
  if (draft.cashCountedCents !== null && cashMethod === null) {
    return fail('No hay un medio de efectivo activo: no hay contra qué comparar lo contado.')
  }
  const counted = cashMethod ? draft.cashCountedCents : null

  // ── Lo facturado ──
  const pointsList = draft.salesPoints.map((p) => `${p.number} (${p.label})`).join(', ')
  const invoiced: Array<SalesCloseBuildInput['invoiced'][number]> = []
  for (const line of draft.invoiced) {
    const label = voucherLabel(line.voucherType)
    const only = draft.salesPoints.length === 1 ? draft.salesPoints[0] : undefined
    const byChannel = line.channel
      ? draft.salesPoints.filter((p) => p.defaultChannel === line.channel)
      : []
    const pointOfSale =
      line.pointOfSale ??
      only?.number ??
      (byChannel.length === 1 ? (byChannel[0]?.number ?? null) : null)
    if (pointOfSale === null) {
      return fail(
        draft.salesPoints.length === 0
          ? 'No hay puntos de venta activos: hay que cargarlos en Ajustes › Puntos de venta.'
          : `Preguntale de qué punto de venta es ${label}. Los que hay: ${pointsList}.`,
      )
    }
    const point = draft.salesPoints.find((p) => p.number === pointOfSale)
    if (!point) {
      return fail(`El punto de venta ${pointOfSale} no está activo. Los que hay: ${pointsList}.`)
    }
    const last = draft.rangeDefaults.find(
      (r) => r.voucherType === line.voucherType && r.pointOfSale === pointOfSale,
    )
    const from = line.from ?? (last ? last.lastNumberTo + 1 : null)
    if (line.to === null || from === null) {
      return fail(
        `Preguntale de qué número a qué número facturó con ${label} en el punto ${pointOfSale}${from !== null ? ` (seguiría del ${from})` : ''}.`,
      )
    }
    const letterA = VOUCHER_CATALOG[line.voucherType].letter === 'A'
    if (letterA && line.party === null) {
      return fail(`${label} necesita el cliente con su CUIT: preguntale a quién se le hizo.`)
    }
    invoiced.push({
      voucherType: line.voucherType,
      pointOfSale,
      numberFrom: from,
      numberTo: line.to,
      channel: line.channel ?? point.defaultChannel,
      partyId: letterA ? (line.party?.id ?? null) : null,
      amountMode: 'total',
      totalCents: line.totalCents,
      vatRateBp: line.rateBp ?? 2100,
      aliquots: [],
      nonTaxedCents: 0,
      exemptCents: 0,
    })
  }

  // ── Lo que se manda ──
  const methodValues = methods.map((m) => {
    const list = customers.get(m.id) ?? []
    return {
      salesMethodId: m.id,
      amountCents: amounts.get(m.id) ?? 0,
      customers: list.map((c) => ({ partyId: c.partyId, amountCents: c.cents })),
    }
  })
  const summary = summarizeSalesClose(
    {
      date,
      shift: null,
      warningsAck: [],
      methods: methodValues,
      invoiced,
      cashCountedCents: null,
      controlTotalCents: null,
      overrideReason: null,
      instantSettlements: [],
    },
    draft.ctx,
  )
  const exceeding = summary.channels.filter((c) => c.uninvoicedCents < 0)
  const reason = draft.reason?.trim() ? draft.reason.trim() : null
  if (exceeding.length > 0 && (reason === null || reason.length < 5)) {
    const channels = exceeding.map((c) => CHANNEL_LABELS[c.channel] ?? c.channel).join(' y ')
    return fail(
      `En ${channels} se facturó más de lo vendido. Preguntale por qué (por ejemplo, una factura de otro día) y pasalo en motivo, o revisá los importes.`,
    )
  }

  // ── El tique ──
  const split = invoiceSplit(sold, summary.channels)
  const cashSold = cashMethod ? (amounts.get(cashMethod.id) ?? 0) : 0
  const cashDiff = counted !== null ? cashSold - counted : 0
  const dayName = `${capitalizeFirst(weekdayName(date))} ${formatDayMonth(date)}`
  return {
    ok: true,
    form: 'sales_close',
    values: {
      date,
      shift: needsShift ? shift : null,
      methods: methodValues,
      invoiced,
      cashCountedCents: counted,
      controlTotalCents: draft.controlTotalCents,
      overrideReason: exceeding.length > 0 ? reason : null,
      instantSettlements: [],
    },
    ticket: {
      kind: 'cierre',
      title: 'Cierre del día',
      subtitle: needsShift && shift ? `${dayName} · turno ${shift}` : dayName,
      rows: rows([
        ...methods.flatMap((m) => {
          const cents = amounts.get(m.id) ?? 0
          return cents > 0
            ? [
                row(m.name, money(cents)),
                ...(customers.get(m.id) ?? []).map((c) => row(`· ${c.name}`, money(c.cents))),
              ]
            : []
        }),
        counted !== null && row('Efectivo contado', money(counted)),
        cashDiff > 0 && row('Faltan en la caja', money(cashDiff)),
        cashDiff < 0 && row('Sobran en la caja', money(-cashDiff)),
        split.invoicedCents > 0 && row('Con factura', money(split.invoicedCents)),
        split.uninvoicedCents > 0 && row('Sin factura', money(split.uninvoicedCents)),
        split.overCents > 0 && row('Facturado de más', money(split.overCents)),
        exceeding.length > 0 && reason && row('Por qué', reason),
      ]),
      total: row('Vendido', money(sold)),
      confirmLabel: 'Cargar el cierre',
    },
  }
}

// ─── «Entró plata» ───────────────────────────────────────────────────────────

const DEDUCTION_WORDS: Readonly<Record<DeductionKind, string>> = {
  comision: 'Comisión',
  iva_comision: 'IVA de la comisión',
  percepcion_iva_comision: 'Percepción de IVA',
  ret_iva: 'Retención de IVA',
  ret_iibb: 'Retención de Ingresos Brutos',
  sircupa: 'Retención de la cuenta bancaria',
  ret_ganancias: 'Retención de Ganancias',
  otro: 'Otros cargos',
  diferencia: 'Diferencia sin explicar',
}

export const COBRO_SCOPES = ['lo_atrasado', 'todas', 'a_cuenta'] as const
export type CobroScope = (typeof COBRO_SCOPES)[number]

/** Las tres salidas de «Faltan explicar $ X» de la hoja, y las dos de cuando no cierra para el otro lado. */
export const COBRO_RESTOS = [
  'comision',
  'otro',
  'diferencia',
  'a_cuenta',
  'queda_pendiente',
] as const
export type CobroResto = (typeof COBRO_RESTOS)[number]

export const COMMISSION_MODES = ['viene_en_la_liquidacion', 'llega_despues', 'no_factura'] as const
export type CommissionMode = (typeof COMMISSION_MODES)[number]

const MODE_OF: Readonly<Record<CommissionMode, VoucherMode>> = {
  viene_en_la_liquidacion: 'included',
  llega_despues: 'later',
  no_factura: 'none',
}

const MODE_WORDS: Readonly<Record<VoucherMode, string>> = {
  included: 'Viene en la liquidación',
  later: 'Llega después',
  none: 'No factura',
}

export type CobroDraft = {
  date: string
  party: {
    id: string
    name: string
    kind: PartyKind
    commissionVatMode: CommissionVatMode
    rates: PartyRates
  }
  /** Sus partidas abiertas en las cuentas «nos debe», como las lee la hoja. */
  items: readonly OpenItemRef[]
  treasury: TreasuryFacts
  receivedCents: number
  reference: string | null
  scope: CobroScope | null
  /** Ventas puntuales: el id de la partida o una parte de cómo se llaman. */
  lines: readonly string[] | null
  /** Descontar los saldos a favor (o lo que se le debe). */
  useCredits: boolean
  /** «Total de la liquidación». */
  grossCents: number | null
  /** Lo que dijo. `null`: se estiman con sus tasas, como los precarga la hoja. */
  deductions: ReadonlyArray<{
    kind: DeductionKind
    cents: number
    certificate: string | null
  }> | null
  rest: CobroResto | null
  voucher: {
    mode: CommissionMode | null
    type: CommissionVoucherType | null
    pointOfSale: number | null
    number: number | null
  }
  /** `ctx.sys.fees_other.id`. */
  feesOtherAccountId: string
  /** La caja de esa billetera, si es una: conviene contarla. */
  walletTreasuryName: string | null
}

export type CobroPlan = DocumentPlan<'collection'> & { notices: TexTicketWarning[] }

/**
 * Hasta dónde llega lo que se cobró, la más vieja primero: la hoja lo hace tildando y escribiendo
 * cuánto se cobra de cada una.
 */
function fillOldest(items: readonly OpenItemRef[], budget: number): Map<string, number> {
  const out = new Map<string, number>()
  let left = budget
  for (const item of [...items].sort(byDue)) {
    if (left <= 0) break
    const take = Math.min(left, item.openCents)
    if (take > 0) out.set(item.lineId, take)
    left -= take
  }
  return out
}

/** Lo que manda «Registrar un cobro» (`buildCollectionValues`). */
export function cobroPlan(draft: CobroDraft): PlanFailure | CobroPlan {
  const { party, date, receivedCents } = draft
  const isCustomer = party.kind === 'customer'
  const debts = draft.items.filter((i) => i.side === 'debit' && i.openCents > 0).sort(byDue)
  const creditItems = draft.items.filter((i) => i.side === 'credit' && i.openCents > 0)
  const credits = new Set(draft.useCredits ? creditItems.map((i) => i.lineId) : [])
  const creditUsed = creditItems
    .filter((i) => credits.has(i.lineId))
    .reduce((sum, i) => sum + i.openCents, 0)
  const debtTotal = debts.reduce((sum, d) => sum + d.openCents, 0)
  const late = debts.filter((d) => d.dueDate !== null && d.dueDate <= date)

  // ── De qué ventas es ──
  let selected: readonly OpenItemRef[]
  if (draft.lines !== null) {
    const picked = pickLines(draft.lines, debts)
    if (!picked.ok) return picked
    selected = picked.items
  } else if (draft.scope === 'a_cuenta') {
    selected = []
  } else if (draft.scope === 'todas') {
    selected = debts
  } else if (draft.scope === 'lo_atrasado') {
    selected = late
  } else {
    // Un cliente paga lo más viejo primero; una tarjeta o una app liquidan lo que ya tenía que llegar.
    selected = isCustomer ? debts : late
    if (!isCustomer && late.length === 0 && debts.length > 0) {
      return fail(
        `De ${party.name} no hay ventas atrasadas, y hay ${money(debtTotal)} por llegar. Preguntale si es de eso (ventas: todas) o si queda a cuenta (ventas: a_cuenta).`,
      )
    }
  }
  if (draft.useCredits && selected.length === 0) {
    return fail('Para usar lo que tiene a favor, hace falta saber qué venta cancela.')
  }
  const applied = selected.reduce((sum, d) => sum + d.openCents, 0)

  // ── Los descuentos: la misma cuenta de la hoja ──
  const estimable = !isCustomer || prefillDeductions(1_000_000, party.rates).length > 0
  const baseGross =
    draft.grossCents ?? (selected.length > 0 ? Math.max(0, applied - creditUsed) : null)
  const estimated =
    draft.deductions === null && estimable && baseGross !== null && baseGross > 0
      ? prefillDeductions(baseGross, party.rates)
      : []
  const deductions = emptyDeductions()
  for (const d of estimated) deductions[d.taxKind] = { amount: d.amountCents, cert: '' }
  for (const d of draft.deductions ?? []) {
    deductions[d.kind] = {
      amount: (deductions[d.kind].amount ?? 0) + d.cents,
      cert: d.certificate ?? '',
    }
  }
  const totalOf = () => Object.values(deductions).reduce((sum, d) => sum + (d.amount ?? 0), 0)

  // ── ¿Cierra? Un cliente sin tasas no pide explicación: lo que no alcanza queda debiendo ──
  let gross = baseGross
  const plain = isCustomer && !estimable
  if (plain && draft.grossCents === null) {
    gross = receivedCents + totalOf()
  } else if (gross === null) {
    gross = receivedCents + totalOf()
  } else {
    const missing = gross - receivedCents - totalOf()
    if (missing !== 0) {
      const deducted = totalOf()
      const base =
        draft.grossCents !== null
          ? `La liquidación es de ${money(gross)}`
          : selected.length === 1
            ? `La venta es de ${money(gross)}`
            : `Las ventas suman ${money(gross)}`
      const line =
        deducted > 0
          ? `${base} y, con ${money(deducted)} de descuentos${estimated.length > 0 ? ' estimados' : ''}, tendrían que entrar ${money(gross - deducted)}`
          : base
      if (draft.rest === null) {
        return fail(
          missing > 0
            ? `${line}, pero entraron ${money(receivedCents)}: faltan explicar ${money(missing)}. Preguntale qué dice la liquidación y pasalo en descuentos; o en resto: comision, otro o diferencia. Si el resto de esas ventas llega después, resto: queda_pendiente.`
            : `${line}, pero entraron ${money(receivedCents)}: hay ${money(-missing)} de más. Preguntale si revisa los descuentos, o mandá resto: a_cuenta.`,
        )
      }
      if (draft.rest === 'a_cuenta') {
        if (missing > 0) {
          return fail(
            `Entró menos de lo que da la cuenta (faltan ${money(missing)}): no hay nada que dejar a cuenta.`,
          )
        }
        gross = receivedCents + totalOf()
      } else if (draft.rest === 'queda_pendiente') {
        if (missing < 0) {
          return fail(
            `Entró más de lo que da la cuenta (sobran ${money(-missing)}): eso solo puede quedar a_cuenta.`,
          )
        }
        gross = receivedCents + totalOf()
      } else {
        if (missing < 0) {
          return fail(
            `Entró más de lo que da la cuenta (sobran ${money(-missing)}): eso solo puede quedar a_cuenta.`,
          )
        }
        deductions[draft.rest] = {
          amount: (deductions[draft.rest].amount ?? 0) + missing,
          cert: deductions[draft.rest].cert,
        }
      }
    }
  }
  const apps = fillOldest(selected, gross + creditUsed)
  const appliedNow = [...apps.values()].reduce((sum, cents) => sum + cents, 0)

  // ── La factura de la comisión ──
  const hasCommission =
    (deductions.comision.amount ?? 0) +
      (deductions.iva_comision.amount ?? 0) +
      (deductions.percepcion_iva_comision.amount ?? 0) >
    0
  const naturalMode: VoucherMode =
    party.commissionVatMode === 'per_settlement'
      ? 'included'
      : party.commissionVatMode === 'monthly_invoice'
        ? 'later'
        : 'none'
  const asked = draft.voucher.mode ? MODE_OF[draft.voucher.mode] : naturalMode
  // Sin comisión no hay nada que documentar: la hoja igual pediría el número, acá no se pregunta.
  const voucherMode: VoucherMode = hasCommission ? asked : 'none'
  if (
    voucherMode === 'included' &&
    (draft.voucher.pointOfSale === null || draft.voucher.number === null)
  ) {
    return fail(
      `La factura de la comisión de ${party.name} viene en la liquidación: preguntale el punto de venta y el número. Si no los tiene a mano, mandá factura_comision con modo llega_despues.`,
    )
  }
  const voucherType: CommissionVoucherType =
    draft.voucher.type ?? (party.kind === 'card_processor' ? 'liquidacion' : 'factura_a')

  const values = buildCollectionValues({
    partyId: party.id,
    date,
    apps,
    creditItems,
    credits,
    grossValue: gross,
    rows: deductions,
    feesOtherAccountId: draft.feesOtherAccountId,
    received: receivedCents,
    treasuryId: draft.treasury.id,
    reference: draft.reference ?? '',
    voucherMode,
    voucherType,
    voucherPos: draft.voucher.pointOfSale === null ? '' : String(draft.voucher.pointOfSale),
    voucherNumber: draft.voucher.number === null ? '' : String(draft.voucher.number),
  })

  // ── El tique ──
  const onAccount = gross + creditUsed - appliedNow
  const stillOwed = debtTotal - appliedNow
  const summary = settlementSummary({ grossCents: gross, receivedCents })
  const estimatedKinds = new Set<DeductionKind>(
    draft.deductions === null ? estimated.map((d) => d.taxKind) : [],
  )
  const deductionRows = (Object.keys(deductions) as DeductionKind[]).flatMap((kind) => {
    const amount = deductions[kind].amount ?? 0
    return amount > 0
      ? [
          row(
            `${DEDUCTION_WORDS[kind]}${estimatedKinds.has(kind) ? ' (estimado)' : ''}`,
            money(amount),
          ),
        ]
      : []
  })
  const notices: TexTicketWarning[] = []
  if (estimatedKinds.size > 0) {
    notices.push(
      notice(
        'tex_descuentos_estimados',
        `Los descuentos son los que suele cobrar ${party.name}: corregilos con la liquidación.`,
      ),
    )
  }
  if (draft.walletTreasuryName) {
    notices.push(
      notice(
        'tex_contar_billetera',
        `Para ${draft.walletTreasuryName} es más fácil contar la caja: mirás lo que hay en la app y queda anotado solo.`,
      ),
    )
  }
  return {
    ok: true,
    form: 'collection',
    values,
    notices,
    ticket: {
      kind: 'cobro',
      title: 'Entró plata',
      subtitle:
        voucherMode === 'included' &&
        draft.voucher.pointOfSale !== null &&
        draft.voucher.number !== null
          ? `${party.name} · ${voucherDisplay(voucherType, draft.voucher.pointOfSale, draft.voucher.number)}`
          : party.name,
      rows: rows([
        row('Entra a', draft.treasury.name),
        dayRow('Fecha', date),
        appliedNow > 0 &&
          row(apps.size === 1 ? 'Paga 1 venta' : `Paga ${apps.size} ventas`, money(appliedNow)),
        creditUsed > 0 && row('Usa lo que había a favor', money(creditUsed)),
        ...deductionRows,
        hasCommission && row('Factura de la comisión', MODE_WORDS[voucherMode]),
        summary &&
          summary.discountCents > 0 &&
          row('Te descontaron', `${money(summary.discountCents)} (${summary.percentText})`),
        onAccount > 0 && row('Queda a cuenta', money(onAccount)),
        stillOwed > 0 && row('Te sigue debiendo', money(stillOwed)),
        draft.reference && row(isCustomer ? 'Referencia' : 'N.º de liquidación', draft.reference),
      ]),
      total: row('Entró', money(receivedCents)),
      confirmLabel: 'Anotar el cobro',
    },
  }
}

// ─── Factura de venta suelta ─────────────────────────────────────────────────

export const SALE_PAPERS = ['factura_a', 'factura_b', 'tique_factura_a', 'tique_factura_b'] as const
export type SalePaper = (typeof SALE_PAPERS)[number]

export type FacturaVentaDraft = {
  customer: {
    id: string
    name: string
    ivaCondition: IvaCondition
    taxId: string | null
    paymentTermDays: number
  }
  /** `null`: la letra que le corresponde al cliente. */
  paper: SalePaper | null
  /** `null`: el de eventos, o el primero. */
  pointOfSale: number | null
  number: number | null
  issueDate: string
  dueDate: string | null
  /** `null`: eventos. */
  channel: Channel | null
  salesPoints: readonly CloseSalesPoint[]
  /** Con IVA. Si vienen `nets`, no se usa. */
  totalCents: number | null
  /** `null`: 21 %. */
  rateBp: VatRateBp | null
  nets: ReadonlyArray<{ rateBp: VatRateBp; netCents: number }>
  nonTaxedCents: number | null
  exemptCents: number | null
  /** «Sí, ya me pagó»: se guarda junto con el cobro. */
  collect: { treasury: TreasuryFacts; amountCents: number | null } | null
  notes: string | null
}

/** Las alícuotas de un total, igual que la factura: el neto sale del total y el ajuste, de la resta. */
export function saleAliquots(
  totalCents: number,
  rateBp: VatRateBp,
): Array<{ vatRateBp: VatRateBp; netCents: number; vatAdjustCents: number }> {
  if (rateBp === 0) return [{ vatRateBp: rateBp, netCents: totalCents, vatAdjustCents: 0 }]
  const net = netFromGross(totalCents, rateBp)
  const adjust = totalCents - net - vatFromNet(net, rateBp)
  return [{ vatRateBp: rateBp, netCents: net, vatAdjustCents: adjust }]
}

/**
 * Lo que manda «Factura aparte» con «Ya la hice en otro sistema». La emisión con ARCA y las notas de
 * crédito o débito se hacen en su pantalla.
 */
export function facturaVentaPlan(
  draft: FacturaVentaDraft,
): PlanFailure | DocumentPlan<'sales_invoice'> {
  const { customer, issueDate } = draft
  if (draft.number === null) {
    return fail(
      'Para cargarla hace falta el número de la factura: preguntáselo. Si todavía no la hizo, llevala con ir_a a ventas.nueva_factura: desde ahí se emite con ARCA.',
    )
  }
  const paper: SalePaper = draft.paper ?? `factura_${letterFor(customer.ivaCondition)}`
  const letterA = VOUCHER_CATALOG[paper].letter === 'A'
  if (letterA && !customer.taxId) {
    return fail(
      `${voucherLabel(paper)} necesita el CUIT de ${customer.name}: preguntáselo y cargalo con preparar_proveedor (tipo cliente), o preguntale si fue una B.`,
    )
  }
  const point =
    draft.pointOfSale !== null
      ? draft.salesPoints.find((p) => p.number === draft.pointOfSale)
      : (draft.salesPoints.find((p) => p.defaultChannel === 'events') ?? draft.salesPoints[0])
  if (!point) {
    const list = draft.salesPoints.map((p) => `${p.number} (${p.label})`).join(', ')
    return fail(
      draft.pointOfSale !== null && list
        ? `El punto de venta ${draft.pointOfSale} no está activo. Los que hay: ${list}.`
        : 'No hay puntos de venta activos: hay que cargarlos en Ajustes › Puntos de venta.',
    )
  }

  // ── Los importes ──
  const detail =
    draft.nets.length > 0 || (draft.nonTaxedCents ?? 0) > 0 || (draft.exemptCents ?? 0) > 0
  const rateBp = draft.rateBp ?? 2100
  if (!detail && draft.totalCents === null) {
    return fail('Preguntale el total de la factura.')
  }
  const aliquots = detail
    ? draft.nets.map((n) => ({ vatRateBp: n.rateBp, netCents: n.netCents, vatAdjustCents: 0 }))
    : saleAliquots(draft.totalCents ?? 0, rateBp)
  const nonTaxed = detail ? (draft.nonTaxedCents ?? 0) : 0
  const exempt = detail ? (draft.exemptCents ?? 0) : 0
  let total = nonTaxed + exempt
  const vatRows: Array<{ label: string; value: string }> = []
  for (const a of aliquots) {
    const vat = a.vatRateBp === 0 ? 0 : vatFromNet(a.netCents, a.vatRateBp) + a.vatAdjustCents
    total += a.netCents + vat
    vatRows.push(row(`Neto ${vatRateLabel(a.vatRateBp)}`, money(a.netCents)))
    if (a.vatRateBp !== 0) vatRows.push(row(`IVA ${vatRateLabel(a.vatRateBp)}`, money(vat)))
  }
  if (detail && draft.totalCents !== null && draft.totalCents !== total) {
    return fail(
      `Lo cargado suma ${money(total)}, y dijo que el total es ${money(draft.totalCents)}. Preguntale cuál está bien.`,
    )
  }

  const channel = draft.channel ?? 'events'
  const due = draft.dueDate ?? addDays(issueDate, Math.max(0, customer.paymentTermDays))
  const collect = draft.collect
  return {
    ok: true,
    form: 'sales_invoice',
    values: {
      docKind: 'sales_invoice',
      partyId: customer.id,
      voucherType: paper,
      pointOfSale: point.number,
      number: draft.number,
      issueDate,
      dueDate: draft.dueDate,
      channel,
      aliquots,
      nonTaxedCents: nonTaxed,
      exemptCents: exempt,
      relatedDocumentId: null,
      collectNow: collect
        ? {
            treasuryAccountId: collect.treasury.id,
            amountCents: collect.amountCents,
            date: issueDate,
            reference: null,
          }
        : null,
      notes: draft.notes,
    },
    ticket: {
      kind: 'factura_venta',
      title: 'Factura de venta',
      subtitle: `${customer.name} · ${voucherDisplay(paper, point.number, draft.number)}`,
      rows: rows([
        dayRow('Fecha', issueDate),
        !collect && dayRow('Vence', due),
        row('Canal', CHANNEL_LABELS[channel] ?? channel),
        ...vatRows,
        nonTaxed > 0 && row('No gravado', money(nonTaxed)),
        exempt > 0 && row('Exento', money(exempt)),
        collect && row('Cobrada en', collect.treasury.name),
        collect?.amountCents !== null &&
          collect?.amountCents !== undefined &&
          row('Cobra ahora', money(collect.amountCents)),
        draft.notes && row('Nota', draft.notes),
      ]),
      total: row('Total', money(total)),
      confirmLabel: collect ? 'Cargar factura y cobro' : 'Cargar la factura',
    },
  }
}

// ─── Los objetivos de la Proyección ──────────────────────────────────────────

export type TargetItem = { day: string; targetCents?: number | null; note?: string | null }

export type ObjetivosPlan = {
  ok: true
  values: { items: TargetItem[] }
  /** El mes al que lleva después de guardar. */
  month: string
  ticket: TexTicketDraft
}

/** Cuántos días se nombran en el tique antes de «y N más». */
const TARGET_ROWS = 7

function targetsTicket(input: {
  month: string
  items: readonly TargetItem[]
  savedOf: (day: string) => number | null
  note: string | null
}): TexTicketDraft {
  const shown = input.items.slice(0, TARGET_ROWS)
  const rest = input.items.slice(TARGET_ROWS)
  const words = (item: TargetItem) => {
    if (item.targetCents === undefined) return item.note ? `Nota: ${item.note}` : '—'
    const now =
      item.targetCents === null || item.targetCents === 0 ? 'Sin objetivo' : money(item.targetCents)
    const before = input.savedOf(item.day)
    return before !== null && before !== (item.targetCents ?? 0) ? `${money(before)} → ${now}` : now
  }
  const sum = input.items.reduce((acc, item) => acc + (item.targetCents ?? 0), 0)
  return {
    kind: 'objetivos',
    title: 'Objetivos',
    subtitle: formatMonthLabel(input.month),
    rows: rows([
      ...shown.map((item) => row(formatWeekdayDayMonth(item.day), words(item))),
      rest.length > 0 &&
        row(
          `Y ${rest.length} días más`,
          money(rest.reduce((acc, i) => acc + (i.targetCents ?? 0), 0)),
        ),
      input.note && row('Ojo', input.note),
    ]),
    total: sum > 0 ? row('Suman', money(sum)) : null,
    entry: [],
    warnings: [],
    confirmLabel: 'Guardar los objetivos',
  }
}

function checkedItems(items: readonly TargetItem[]): PlanFailure | { ok: true } {
  const parsed = salesTargetsSchema.safeParse({ items })
  return parsed.success ? { ok: true } : fail(zodIssuesText(parsed.error))
}

function savedLookup(current: readonly TargetOfDay[]): (day: string) => number | null {
  const byDay = new Map(current.map((t) => [t.day, t.targetCents]))
  return (day) => byDay.get(day) ?? null
}

/** Por día: lo que manda la celda de la planilla. Viaja solo lo que cambia. */
export function objetivosPorDia(input: {
  days: ReadonlyArray<{ day: string; targetCents: number | null | undefined; note: string | null }>
  current: readonly TargetOfDay[]
}): PlanFailure | ObjetivosPlan {
  const items: TargetItem[] = input.days.map((d) => ({
    day: d.day,
    ...(d.targetCents !== undefined
      ? { targetCents: d.targetCents === 0 ? null : d.targetCents }
      : {}),
    ...(d.note !== null ? { note: d.note } : {}),
  }))
  const checked = checkedItems(items)
  if (!checked.ok) return checked
  const [first] = items
  if (!first) return fail('Preguntale el objetivo de cada día.')
  const month = monthOf(first.day)
  return {
    ok: true,
    values: { items },
    month,
    ticket: targetsTicket({ month, items, savedOf: savedLookup(input.current), note: null }),
  }
}

/** «Copiar octubre»: por día de la semana y número de semana, como el botón de la planilla. */
export function objetivosCopiados(input: {
  month: string
  fromMonth: string
  targets: readonly TargetOfDay[]
  current: readonly TargetOfDay[]
}): PlanFailure | ObjetivosPlan {
  const savedOf = savedLookup(input.current)
  const copied = copyMonthTargets({
    month: input.month,
    fromMonth: input.fromMonth,
    targets: input.targets,
  })
  if (copied.length === 0) {
    return fail(`${formatMonthLabel(input.fromMonth)} no tiene objetivos para copiar.`)
  }
  const items: TargetItem[] = copied.filter((item) => savedOf(item.day) !== item.targetCents)
  if (items.length === 0) return fail('Ya estaba así: no hay nada que cambiar.')
  const checked = checkedItems(items)
  if (!checked.ok) return checked
  const overwritten = items.filter((item) => savedOf(item.day) !== null).length
  return {
    ok: true,
    values: { items },
    month: input.month,
    ticket: targetsTicket({
      month: input.month,
      items,
      savedOf,
      note:
        overwritten > 0
          ? `Se pisan ${overwritten === 1 ? '1 día que ya tenía' : `${overwritten} días que ya tenían`} objetivo.`
          : null,
    }),
  }
}

/** «Pegar una lista»: un monto por renglón, desde el día 1 o desde el que diga. */
export function objetivosDeLista(input: {
  month: string
  text: string
  fromDay: number | null
  current: readonly TargetOfDay[]
}): PlanFailure | ObjetivosPlan {
  const parsed: TargetsImportResult = parseTargetsList(input.text, input.month, {
    fromDay: input.fromDay ?? 1,
  })
  const [bad] = parsed.invalid
  if (bad) {
    return fail(
      `No se entiende el monto del renglón ${bad.line} («${bad.text}»): preguntale cuál es.`,
    )
  }
  if (parsed.overflow > 0) {
    return fail(
      parsed.overflow === 1
        ? 'Sobra 1 renglón: el mes no tiene tantos días. Preguntale desde qué día es.'
        : `Sobran ${parsed.overflow} renglones: el mes no tiene tantos días. Preguntale desde qué día es.`,
    )
  }
  if (parsed.items.length === 0) return fail('No vino ningún monto en la lista.')
  const items: TargetItem[] = parsed.items
  const checked = checkedItems(items)
  if (!checked.ok) return checked
  return {
    ok: true,
    values: { items },
    month: input.month,
    ticket: targetsTicket({
      month: input.month,
      items,
      savedOf: savedLookup(input.current),
      note: null,
    }),
  }
}
