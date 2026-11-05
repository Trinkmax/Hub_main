import 'server-only'

import { z } from 'zod'
import {
  appliedByOthers,
  type DocumentActions,
  documentActions,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { listAccounts } from '@/lib/accounting/queries/accounts'
import { getImputationFlags } from '@/lib/accounting/queries/books'
import { ivaConditionLabel } from '@/lib/accounting/queries/csv'
import {
  type DocumentDetail,
  type DocumentListPage,
  type DocumentListRow,
  type DocumentStatusFilter,
  getDocument,
  listDocuments,
} from '@/lib/accounting/queries/documents'
import {
  DOCUMENT_STATUS_LABELS,
  documentKindLabel,
  documentRef,
  PARTY_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  PURCHASE_DOCUMENT_KINDS,
  SALES_INVOICE_KINDS,
} from '@/lib/accounting/queries/labels'
import {
  getParty,
  getPartyPosition,
  listParties,
  matchesPartyFilter,
  type OpenItemRow,
  type PartyDetail,
  type PartyList,
  type PartyListRow,
  type PartyOption,
  type PartyPosition,
  partyKindsOf,
  searchParties,
} from '@/lib/accounting/queries/parties'
import { isUuid, settleQuery } from '@/lib/accounting/queries/shared'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import { REIMPUTE_CLOSED_MESSAGE, reimputeTargets } from '@/lib/accounting/reimpute'
import { bpLabel } from '@/lib/accounting/taxes'
import type { DocumentKind } from '@/lib/accounting/types'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import {
  mondayOf,
  parseWeekParam,
  paysOnReceipt,
  planLeft,
  type WeekPlanRow,
  weekLabel,
  weekPlanTotals,
} from '@/lib/accounting/week-plan'
import { getArcaVoucherCard } from '@/lib/arca/emit-queries'
import { type Resolved, resolveParty } from '../../resolve'
import {
  capped,
  dayField,
  dayText,
  defineTool,
  money,
  noInput,
  type TexToolContext,
} from '../types'
import { cappedBySize, compact, moneyIf, periodFields, plain, shortText, texPeriod } from './common'

/** Lo que se muestra de una lista. */
const LIST_MAX = 40
/** Lo que se lee de los comprobantes para poder dar los totales: el tope de la consulta. */
const DOCUMENTS_READ = 200
/** Una ficha lleva dos listas, y un comprobante dos más: cada una con su parte de la respuesta. */
const OPEN_ITEMS_MAX_CHARS = 8_000
const OPEN_CREDITS_MAX_CHARS = 3_000
const DOCUMENT_LINES_MAX_CHARS = 7_000
const ENTRY_LINES_MAX_CHARS = 3_000
/** Los que se pueden haber emitido con ARCA: se corrigen con una nota de crédito. */
const ARCA_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'sales_invoice',
  'sales_debit_note',
  'sales_credit_note',
])

// ─── Lo puro: partícipes ─────────────────────────────────────────────────────

export function partyOptionRow(option: PartyOption) {
  return compact({
    id: option.id,
    nombre: option.name,
    fantasia: option.tradeName,
    tipo: PARTY_KIND_LABELS[option.kind] ?? option.kind,
    cuit: option.taxId,
    inactivo: option.active ? null : true,
  })
}

/** Una partida abierta. `partida_id` es lo que se le pasa a pagar o cobrar. */
export function openItemRow(item: OpenItemRow) {
  return compact({
    partida_id: item.lineId,
    comprobante_id: item.documentId,
    comprobante: item.documentLabel,
    fecha: dayText(item.entryDate),
    vence: dayText(item.dueDate),
    dias_vencido: item.daysOverdue !== null && item.daysOverdue > 0 ? item.daysOverdue : null,
    total: money(item.amountCents),
    falta: money(item.openCents),
  })
}

/** `deliveryDays`: 1 = lunes … 7 = domingo. */
const DELIVERY_DAY_NAMES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const

/** La ficha sin los datos de contacto de nadie: se ven en su pantalla. */
export function partyCard(party: PartyDetail) {
  return compact({
    id: party.id,
    nombre: party.name,
    fantasia: party.tradeName,
    tipo: PARTY_KIND_LABELS[party.kind] ?? party.kind,
    cuit: party.taxId,
    condicion_iva: ivaConditionLabel(party.ivaCondition),
    inactivo: party.active ? null : true,
    plazo_de_pago_dias: party.paymentTermDays > 0 ? party.paymentTermDays : null,
    categoria: party.defaultAccountName,
    categoria_id: party.defaultAccountId,
    comprobante_habitual: party.defaultVoucherType ? voucherLabel(party.defaultVoucherType) : null,
    comision: party.commissionBp === null ? null : bpLabel(party.commissionBp),
    dias_de_entrega:
      party.deliveryDays.length > 0
        ? party.deliveryDays.map((day) => DELIVERY_DAY_NAMES[day - 1] ?? String(day))
        : null,
    pedir_con_dias_de_anticipacion: party.orderLeadDays,
  })
}

/** Ficha, saldo y lo abierto de un partícipe. `lado` dice para qué lado se lee el saldo. */
export function partyData(party: PartyDetail, position: PartyPosition) {
  const debts = cappedBySize(position.debtItems.map(openItemRow), LIST_MAX, OPEN_ITEMS_MAX_CHARS)
  const credits = cappedBySize(
    position.creditItems.map(openItemRow),
    LIST_MAX,
    OPEN_CREDITS_MAX_CHARS,
  )
  return {
    ...partyCard(party),
    saldo: compact({
      lado: position.group === 'payables' ? 'le debés' : 'te debe',
      debe: money(position.debtCents),
      a_favor: moneyIf(position.creditCents),
      neto: money(position.netCents),
      vencido: money(position.aging.overdueCents),
      vence_pronto: moneyIf(position.aging.totals.due_soon),
      proximo_vencimiento: dayText(position.aging.nextDueDate),
      estado: plain(position.traffic.text),
    }),
    abiertos: debts,
    ...(position.creditItems.length > 0 ? { a_favor_sin_aplicar: credits } : {}),
  }
}

export function debtRow(row: PartyListRow) {
  return compact({
    id: row.partyId,
    nombre: row.tradeName ?? row.partyName,
    tipo: PARTY_KIND_LABELS[row.partyKind] ?? row.partyKind,
    debe: money(row.debtCents),
    vencido: money(row.overdueCents),
    vence_pronto: moneyIf(row.dueSoonCents),
    a_favor: moneyIf(row.creditCents),
    vencido_mas_viejo: dayText(row.oldestDueDate),
    proximo_vencimiento: dayText(row.nextDueDate),
    estado: plain(row.trafficText),
  })
}

/**
 * A quién se le debe. El total es el del Resumen; `de_proveedores` es el de Compras › Proveedores, que
 * deja afuera a los organismos y a los sueldos. Se dan los dos porque las dos pantallas existen.
 */
export function debtsData(list: PartyList) {
  const owing = list.rows.filter((row) => row.debtCents > 0)
  const isTax = (row: PartyListRow) => matchesPartyFilter(row, 'taxes_payroll')
  const sum = (rows: readonly PartyListRow[]) => rows.reduce((s, row) => s + row.debtCents, 0)
  const { filas, hay_mas } = capped(owing.map(debtRow), LIST_MAX)
  return compact({
    total: money(list.totals.debtCents),
    vencido: money(list.totals.overdueCents),
    vence_pronto: money(list.totals.dueSoonCents),
    a_favor: moneyIf(list.totals.creditCents),
    de_proveedores: money(sum(owing.filter((row) => !isTax(row)))),
    de_impuestos_y_sueldos: moneyIf(sum(owing.filter(isTax))),
    cuantos: owing.length,
    filas,
    hay_mas,
  })
}

// ─── Lo puro: comprobantes ───────────────────────────────────────────────────

/** Los tipos de comprobante, como los piensa la gente. */
export const DOCUMENT_TYPE_FILTER = {
  compras: ['purchase', 'purchase_credit_note', 'purchase_debit_note'],
  gastos: ['expense', 'bank_expense'],
  compras_y_gastos: [...PURCHASE_DOCUMENT_KINDS, 'bank_expense'],
  pagos: ['payment'],
  cierres: ['sales_close'],
  facturas_de_venta: [...SALES_INVOICE_KINDS],
  cobros: ['collection'],
  movimientos: ['transfer', 'cash_movement', 'treasury_adjustment'],
  asientos: ['manual', 'reversal', 'iva_settlement', 'opening'],
} as const satisfies Record<string, readonly DocumentKind[]>

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_FILTER) as [
  keyof typeof DOCUMENT_TYPE_FILTER,
  ...Array<keyof typeof DOCUMENT_TYPE_FILTER>,
]

const DOCUMENT_STATES = {
  vigentes: 'posted',
  impagos: 'unpaid',
  parciales: 'partial',
  pagados: 'paid',
  anulados: 'voided',
  todos: 'all',
} as const satisfies Record<string, DocumentStatusFilter>

const DOCUMENT_STATE_KEYS = Object.keys(DOCUMENT_STATES) as [
  keyof typeof DOCUMENT_STATES,
  ...Array<keyof typeof DOCUMENT_STATES>,
]

export function documentRow(row: DocumentListRow) {
  return compact({
    id: row.id,
    numero: documentRef(row.seq),
    fecha: dayText(row.accountingDate),
    comprobante: row.title,
    participe: row.partyName,
    total: money(row.totalCents),
    falta: row.openCents === null ? null : money(row.openCents),
    estado:
      row.status === 'voided'
        ? DOCUMENT_STATUS_LABELS.voided
        : row.paymentStatus === 'none'
          ? null
          : PAYMENT_STATUS_LABELS[row.paymentStatus],
    sin_factura: isNotInvoicedVoucher(row.voucherType) ? true : null,
    cuenta: row.imputation,
    detalle: shortText(row.description, 70),
  })
}

/**
 * Cuánto suma cada tipo: los anulados no cuentan, y una compra no se suma con su nota de crédito ni
 * con un pago (por eso va separado). Solo si se leyó todo: un total de una parte se leería como
 * verdadero.
 */
export function documentTotals(page: Pick<DocumentListPage, 'rows' | 'totalRows' | 'truncated'>) {
  if (page.truncated || page.totalRows > page.rows.length) return null
  const byKind = new Map<DocumentKind, { cuantos: number; cents: number; openCents: number }>()
  for (const row of page.rows) {
    if (row.status === 'voided') continue
    const sum = byKind.get(row.kind) ?? { cuantos: 0, cents: 0, openCents: 0 }
    sum.cuantos += 1
    sum.cents += row.totalCents
    sum.openCents += row.openCents ?? 0
    byKind.set(row.kind, sum)
  }
  return [...byKind.entries()].map(([kind, sum]) =>
    compact({
      tipo: documentKindLabel(kind),
      cuantos: sum.cuantos,
      total: money(sum.cents),
      falta: moneyIf(sum.openCents),
    }),
  )
}

export function documentsData(page: DocumentListPage, label: string) {
  const totales = documentTotals(page)
  const { filas, hay_mas } = cappedBySize(page.rows.map(documentRow), LIST_MAX)
  return compact({
    periodo: label,
    cuantos: page.totalRows,
    totales,
    nota:
      totales === null
        ? 'Son demasiados para sumarlos: pedí un período más corto o filtrá por tipo o proveedor.'
        : null,
    filas,
    hay_mas,
  })
}

/** Si se puede anular y cómo. La base lo vuelve a decidir al hacerlo. */
export function voidingData(
  doc: Pick<DocumentDetail, 'status' | 'kind' | 'allocations' | 'reversedBy'>,
  actions: DocumentActions,
  opts: { arcaEmitted: boolean; arcaSibling: string | null; canWrite: boolean },
) {
  const blocked = (motivo: string) => ({ se_puede: false, motivo })
  if (doc.status === 'voided') return blocked('Ya está anulado.')
  if (opts.arcaEmitted) return blocked('Ya salió por ARCA: se corrige con una nota de crédito.')
  if (opts.arcaSibling) {
    return blocked(
      `Se cargó junto con ${opts.arcaSibling}, que ya está en ARCA: anularlo anularía también esa factura.`,
    )
  }
  if (doc.reversedBy?.status === 'posted') return blocked('Ya tiene su anulación.')
  if (!actions.void && !actions.reverse) {
    return blocked('Este comprobante no se anula: se deshace reabriendo el mes o el ejercicio.')
  }
  const appliedCents = appliedByOthers(doc.kind)
    ? doc.allocations.reduce((sum, a) => (a.voidedOn ? sum : sum + a.amountCents), 0)
    : 0
  return compact({
    se_puede: true,
    como: actions.void
      ? 'Anular: el mes está abierto.'
      : 'El mes está cerrado: se anula con fecha de hoy, o se corrige con una nota de crédito o un asiento de ajuste.',
    pagos_que_quedan_a_cuenta: moneyIf(appliedCents),
    quien: opts.canWrite ? null : 'Lo anula un dueño con acceso de carga.',
  })
}

function entryLineText(line: {
  side: 'debit' | 'credit'
  accountCode: string
  accountName: string
  amountCents: number
  partyName: string | null
}): string {
  const party = line.partyName ? ` · ${line.partyName}` : ''
  return `${line.side === 'debit' ? 'D' : 'H'} ${line.accountCode} ${line.accountName}${party} ${money(line.amountCents)}`
}

export type DocumentFacts = {
  canWrite: boolean
  arcaEmitted: boolean
  arcaSibling: string | null
  /** Los renglones que se pueden reimputar, por su id, con la cuenta habitual si no es esa. */
  reimputable: ReadonlyMap<string, { usual: string | null }>
  nowMs: number
}

/** El comprobante entero: lo que dice, sus renglones con sus ids, su asiento y si se puede anular. */
export function documentData(doc: DocumentDetail, facts: DocumentFacts) {
  // Lo que puede pasarle al comprobante: qué le toca a esta persona se dice aparte.
  const actions = documentActions(doc, true)
  const open = doc.period?.status === 'open'
  const undoable =
    doc.status === 'posted' && actions.void && facts.nowMs < Date.parse(doc.undoUntil)
  const lines = cappedBySize(
    doc.lines.map((line) => {
      const reimputable = facts.reimputable.get(line.id)
      return compact({
        renglon_id: line.id,
        que: line.roleLabel,
        cuenta: `${line.accountCode} ${line.accountName}`,
        cuenta_id: line.accountId,
        lado: line.side === 'debit' ? 'Debe' : 'Haber',
        importe: money(line.amountCents),
        caja: line.treasuryName,
        medio: line.salesMethodName,
        reimputable: reimputable ? true : null,
        cuenta_habitual: reimputable?.usual ?? null,
      })
    }),
    LIST_MAX,
    DOCUMENT_LINES_MAX_CHARS,
  )
  const entryLines = cappedBySize(
    (doc.entry?.lines ?? []).map(entryLineText),
    LIST_MAX,
    ENTRY_LINES_MAX_CHARS,
  )
  const applied = doc.allocations.filter((a) => a.voidedOn === null)
  return compact({
    id: doc.id,
    numero: documentRef(doc.seq),
    comprobante: doc.title,
    tipo: documentKindLabel(doc.kind),
    estado: DOCUMENT_STATUS_LABELS[doc.status],
    sin_factura: isNotInvoicedVoucher(doc.voucherType) ? true : null,
    participe: doc.partyName,
    participe_id: doc.partyId,
    fecha: dayText(doc.issueDate),
    fecha_contable: dayText(doc.accountingDate),
    vence: dayText(doc.dueDate),
    detalle: shortText(doc.description, 200),
    nota: shortText(doc.notes, 200),
    total: money(doc.totalCents),
    falta: doc.openCents === null ? null : money(doc.openCents),
    estado_de_pago: doc.paymentStatus === 'none' ? null : PAYMENT_STATUS_LABELS[doc.paymentStatus],
    mes: doc.period ? { mes: doc.period.month.slice(0, 7), abierto: open } : null,
    renglones: lines.filas,
    renglones_hay_mas: lines.hay_mas ? true : null,
    reimputar:
      facts.reimputable.size > 0 && !open
        ? { se_puede: false, motivo: REIMPUTE_CLOSED_MESSAGE }
        : null,
    asiento: doc.entry
      ? compact({
          id: doc.entry.id,
          numero: doc.entry.number ?? doc.entry.provisionalNumber,
          provisorio: doc.entry.number === null ? true : null,
          fecha: dayText(doc.entry.entryDate),
          lineas: entryLines.filas,
          lineas_hay_mas: entryLines.hay_mas ? true : null,
        })
      : null,
    aplicado:
      applied.length > 0
        ? capped(applied, 15).filas.map((a) =>
            compact({
              comprobante: a.otherDocumentTitle,
              comprobante_id: a.otherDocumentId,
              fecha: dayText(a.appliedOn),
              importe: money(a.amountCents),
            }),
          )
        : null,
    guardado_junto_con:
      doc.bundleSiblings.length > 0
        ? doc.bundleSiblings.map((s) => ({ id: s.id, comprobante: s.title }))
        : null,
    anulado_por: doc.reversedBy
      ? { id: doc.reversedBy.id, comprobante: doc.reversedBy.title }
      : null,
    reemplazado_por: doc.replacedBy
      ? { id: doc.replacedBy.id, comprobante: doc.replacedBy.title }
      : null,
    anular: voidingData(doc, actions, facts),
    se_puede_deshacer: undoable ? true : null,
  })
}

// ─── Lo puro: el plan de la semana ───────────────────────────────────────────

function planLeftWords(budgetCents: number, paidCents: number) {
  const left = planLeft(budgetCents, paidCents)
  if (left.kind === 'left') return { falta: money(left.cents) }
  if (left.kind === 'over') return { te_pasaste: money(left.cents) }
  return left.kind === 'done' ? { listo: true } : {}
}

export function weekPlanRow(row: WeekPlanRow) {
  return compact({
    id: row.partyId,
    nombre: row.partyName,
    presupuesto: moneyIf(row.budgetCents),
    pagado: moneyIf(row.paidCents),
    comprado: moneyIf(row.purchasedCents),
    deuda: moneyIf(row.debtCents),
    vencido: moneyIf(row.overdueCents),
    ...planLeftWords(row.budgetCents, row.paidCents),
    paga_al_recibir: paysOnReceipt(row) ? true : null,
  })
}

export function weekPlanData(monday: string, rows: readonly WeekPlanRow[]) {
  const totals = weekPlanTotals(rows)
  const { filas, hay_mas } = capped(rows.map(weekPlanRow), LIST_MAX)
  return compact({
    semana: weekLabel(monday),
    lunes: monday,
    presupuesto: money(totals.budgetCents),
    pagado: money(totals.paidCents),
    falta: money(totals.remainingCents),
    te_pasaste: moneyIf(totals.overCents),
    porcentaje: totals.budgetCents > 0 ? `${totals.percent} %` : null,
    comprado: money(totals.purchasedCents),
    deuda: money(totals.debtCents),
    vencido: money(totals.overdueCents),
    filas,
    hay_mas,
  })
}

// ─── Las lecturas ────────────────────────────────────────────────────────────

const PARTY_NOT_FOUND = 'No encontré a ese partícipe. Buscalo con buscar_participe.'

/**
 * Un partícipe, por nombre, CUIT o id. Con un id se lee directo: `resolveParty` lo busca entre los
 * primeros 50 por nombre, y un bar puede tener más.
 */
export async function partyOf(
  ctx: TexToolContext,
  wanted: string,
): Promise<Resolved<{ id: string; name: string }>> {
  if (isUuid(wanted)) {
    const party = await getParty(ctx.tenantId, wanted)
    return party
      ? { ok: true, value: { id: party.id, name: party.tradeName ?? party.name } }
      : { ok: false, message: PARTY_NOT_FOUND }
  }
  const found = await resolveParty(ctx, wanted)
  return found.ok
    ? { ok: true, value: { id: found.value.id, name: found.value.name } }
    : { ok: false, message: found.message }
}

async function arcaFacts(
  ctx: TexToolContext,
  doc: DocumentDetail,
): Promise<{ arcaEmitted: boolean; arcaSibling: string | null }> {
  const emitted = async (id: string) => {
    const card = await settleQuery(getArcaVoucherCard(ctx.tenantId, id))
    return (
      card.ok &&
      card.data?.environment === 'produccion' &&
      (card.data.status === 'posted' || card.data.status === 'authorized')
    )
  }
  if (ARCA_KINDS.has(doc.kind) && (await emitted(doc.id))) {
    return { arcaEmitted: true, arcaSibling: null }
  }
  for (const sibling of doc.bundleSiblings) {
    if (sibling.status !== 'posted' || !ARCA_KINDS.has(sibling.kind)) continue
    if (await emitted(sibling.id)) return { arcaEmitted: false, arcaSibling: sibling.title }
  }
  return { arcaEmitted: false, arcaSibling: null }
}

async function reimputableLines(
  ctx: TexToolContext,
  doc: DocumentDetail,
): Promise<ReadonlyMap<string, { usual: string | null }>> {
  const [accounts, flags] = await Promise.all([
    listAccounts(ctx.tenantId, { includeInactive: true }),
    settleQuery(
      getImputationFlags(ctx.tenantId, { from: doc.accountingDate, to: doc.accountingDate }),
    ),
  ])
  const targets = reimputeTargets(
    doc,
    new Map(accounts.map((account) => [account.id, account])),
    flags.ok ? flags.data.filter((flag) => flag.documentId === doc.id) : [],
  )
  return new Map(
    targets.map((target) => [target.lineId, { usual: target.usual?.accountName ?? null }]),
  )
}

// ─── Las herramientas ────────────────────────────────────────────────────────

/** Proveedores y clientes, lo que se debe, los comprobantes y el plan de la semana. */
export const comprasReadTools = [
  defineTool({
    name: 'buscar_participe',
    description:
      'Busca un proveedor, cliente, organismo, tarjeta o quien sea, por nombre o CUIT, y da su id. Usala para desambiguar o cuando no estás seguro de cómo se llama.',
    input: z.object({
      buscar: z.string().min(1).max(80).describe('Parte del nombre o del CUIT.'),
      grupo: z
        .enum(['proveedores', 'clientes'])
        .optional()
        .describe(
          'Proveedores incluye organismos, sueldos, socios y bancos; clientes incluye tarjetas, billeteras y plataformas.',
        ),
    }),
    need: 'read',
    doing: () => 'Buscando',
    done: () => 'Busqué',
    run: async (input, ctx) => {
      const found = await searchParties(ctx.tenantId, {
        q: input.buscar,
        kinds: input.grupo
          ? partyKindsOf(input.grupo === 'proveedores' ? 'payables' : 'receivables')
          : undefined,
        includeInactive: true,
        limit: 21,
      })
      return { kind: 'data', data: capped(found.map(partyOptionRow), 20) }
    },
  }),

  defineTool({
    name: 'ver_participe',
    description:
      'La ficha de un proveedor o cliente: su saldo, lo vencido y sus comprobantes abiertos con el id de cada partida, que sirve para pagar o cobrar.',
    input: z.object({
      participe: z.string().min(1).describe('El nombre, el CUIT o el id.'),
    }),
    need: 'read',
    doing: () => 'Mirando la ficha',
    done: () => 'Miré la ficha',
    run: async (input, ctx) => {
      let partyId = input.participe
      if (!isUuid(partyId)) {
        const found = await partyOf(ctx, partyId)
        if (!found.ok) return { kind: 'error', message: found.message }
        partyId = found.value.id
      }
      const party = await getParty(ctx.tenantId, partyId)
      if (!party) return { kind: 'error', message: PARTY_NOT_FOUND }
      const position = await getPartyPosition(ctx.tenantId, {
        partyId: party.id,
        group: party.group,
      })
      return { kind: 'data', data: partyData(party, position) }
    },
  }),

  defineTool({
    name: 'ver_deudas',
    description:
      'A quién se le debe y cuánto, de lo más vencido a lo menos, con los totales. Usala para «cuánto debo», «qué venció» o «a quién le pago primero».',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando lo que se debe',
    done: () => 'Miré lo que se debe',
    run: async (_input, ctx) => {
      const list = await listParties(ctx.tenantId, { group: 'payables', asOf: ctx.today })
      return { kind: 'data', data: debtsData(list) }
    },
  }),

  defineTool({
    name: 'buscar_comprobantes',
    description:
      'Busca comprobantes de un período, del más nuevo al más viejo, con lo que suma cada tipo. Filtra por tipo, proveedor o cliente, con o sin factura, estado de pago y texto o número.',
    input: z.object({
      ...periodFields,
      tipo: z.enum(DOCUMENT_TYPES).optional().describe('Sin esto, todos.'),
      participe: z.string().min(1).optional().describe('El nombre, el CUIT o el id.'),
      factura: z.enum(['con', 'sin']).optional(),
      estado: z.enum(DOCUMENT_STATE_KEYS).optional().describe('Sin esto, los vigentes.'),
      texto: z.string().min(1).max(60).optional().describe('En el detalle, o el número.'),
    }),
    need: 'read',
    doing: () => 'Buscando comprobantes',
    done: () => 'Busqué comprobantes',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      let partyId: string | null = null
      if (input.participe) {
        const found = await partyOf(ctx, input.participe)
        if (!found.ok) return { kind: 'error', message: found.message }
        partyId = found.value.id
      }
      const page = await listDocuments(ctx.tenantId, {
        from: period.from,
        to: period.to,
        kinds: input.tipo ? DOCUMENT_TYPE_FILTER[input.tipo] : undefined,
        partyId,
        invoice: input.factura ?? 'todos',
        status: DOCUMENT_STATES[input.estado ?? 'vigentes'],
        q: input.texto ?? null,
        limit: DOCUMENTS_READ,
      })
      return { kind: 'data', data: documentsData(page, period.label) }
    },
  }),

  defineTool({
    name: 'ver_comprobante',
    description:
      'Un comprobante entero: sus renglones con su id, su asiento, lo aplicado y si se puede anular y cómo.',
    input: z.object({ id: z.string().min(1).describe('El id del comprobante.') }),
    need: 'read',
    doing: () => 'Mirando el comprobante',
    done: () => 'Miré el comprobante',
    run: async (input, ctx) => {
      const doc = await getDocument(ctx.tenantId, input.id)
      if (!doc) return { kind: 'error', message: 'Ese comprobante no está.' }
      const [arca, reimputable] = await Promise.all([
        arcaFacts(ctx, doc),
        reimputableLines(ctx, doc),
      ])
      return {
        kind: 'data',
        data: documentData(doc, {
          ...arca,
          reimputable,
          canWrite: ctx.access.write,
          nowMs: Date.now(),
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_plan_semana',
    description:
      'El Plan de la semana: cuánto se presupuestó pagarle a cada proveedor, cuánto se le pagó y cuánto falta. Si no se dice la semana, esta.',
    input: z.object({
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando el plan de la semana',
    done: () => 'Miré el plan de la semana',
    run: async (input, ctx) => {
      const monday = input.semana ? parseWeekParam(input.semana, ctx.today) : mondayOf(ctx.today)
      const rows = await getWeekPlan(ctx.tenantId, monday)
      return { kind: 'data', data: weekPlanData(monday, rows) }
    },
  }),
]
