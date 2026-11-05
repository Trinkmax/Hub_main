import 'server-only'

import { z } from 'zod'
import { type SavedParty, saveParty } from '@/lib/accounting/actions/master'
import { saveWeekBudgets } from '@/lib/accounting/actions/week-plan'
import {
  buildPostingContext,
  type CatalogParty,
  loadOpenItems,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { pickTreasury } from '@/lib/accounting/defaults'
import { listRecurringExpenses } from '@/lib/accounting/queries/documents'
import { findPossibleDuplicate, getFormDefaults } from '@/lib/accounting/queries/forms'
import { getParty } from '@/lib/accounting/queries/parties'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import type { PartyKind } from '@/lib/accounting/types'
import { voucherNumberRequired } from '@/lib/accounting/voucher-types'
import { mondayOf, saveWeekBudgetsSchema } from '@/lib/accounting/week-plan'
import { prepareDocument } from '../../document-action'
import { type Resolved, resolveAccount, resolveParty, resolveTreasury } from '../../resolve'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  dayField,
  defineTool,
  pesosField,
  pesosToCents,
  type TexExecutor,
  type TexToolContext,
} from '../types'
import {
  alicuotaField,
  COMPRA_PAPERS,
  type CompraExtras,
  compraPlan,
  type DraftSupplier,
  GASTO_PAPERS,
  gastoPlan,
  imputableAccounts,
  isScreenPaper,
  isUuid,
  matchByName,
  matchImputable,
  notice,
  PAGO_SCOPES,
  pagoPlan,
  planSemanaPlan,
  proveedorPlan,
  type RecurringFacts,
  rateBpOf,
  SCREEN_PAPERS,
  screenPaperMessage,
  type TreasuryFacts,
  textKey,
  withNotices,
} from './_compras-values'

/** A quién se le carga una compra (`PURCHASE_PARTY_KINDS` del formulario). */
const PURCHASE_KINDS: readonly PartyKind[] = ['supplier', 'other', 'tax_agency']
/** A quién se le carga un gasto y entra al plan de la semana (`payableParties`, `listPlanParties`). */
const SUPPLIER_KINDS: readonly PartyKind[] = ['supplier', 'other']
/** Los que cobran por el bar: no se les carga una compra. */
const COLLECTOR_KINDS: readonly PartyKind[] = [
  'card_processor',
  'payment_wallet',
  'delivery_platform',
]
/** A quién se le paga desde la hoja «Pago». */
const PAYABLE_KINDS: readonly PartyKind[] = [
  'supplier',
  'tax_agency',
  'payroll',
  'partner',
  'bank',
  'other',
]

// ─── Lo que se lee antes de armar el tique ───────────────────────────────────

/** Una lectura que ayuda pero no es imprescindible: si falla, se sigue sin eso, como en las hojas. */
async function optional<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch {
    return null
  }
}

/**
 * Un partícipe por su nombre, CUIT o id. El id se busca en el catálogo, porque `resolveParty` lo busca
 * entre los primeros 50 por nombre y un bar puede tener más.
 */
export async function findParty(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  wanted: string,
  kinds: readonly PartyKind[],
): Promise<Resolved<CatalogParty>> {
  if (isUuid(wanted)) {
    const byId = catalog.parties.find((p) => p.id === wanted && p.active && kinds.includes(p.kind))
    return byId
      ? { ok: true, value: byId }
      : { ok: false, message: 'Ese id no es de nadie a quien se le pueda cargar esto.' }
  }
  const resolved = await resolveParty(ctx, wanted, kinds)
  if (!resolved.ok) return resolved
  const party = catalog.parties.find((p) => p.id === resolved.value.id)
  return party
    ? { ok: true, value: party }
    : { ok: false, message: `No encontré a «${wanted}». Preguntale cómo se llama.` }
}

async function existingSupplier(
  ctx: TexToolContext,
  party: CatalogParty,
): Promise<Extract<DraftSupplier, { kind: 'existing' }>> {
  const memory = await optional(getFormDefaults(ctx.tenantId, party.id))
  return {
    kind: 'existing',
    facts: {
      id: party.id,
      name: party.tradeName ?? party.name,
      kind: party.kind,
      ivaCondition: party.ivaCondition,
      taxId: party.taxId,
      paymentTermDays: party.paymentTermDays,
      defaultAccountId: party.defaultAccountId,
      defaultVoucherType: party.defaultVoucherType,
    },
    memory,
  }
}

type NewSupplierInput = {
  nombre: string
  cuit?: string | undefined
  como_factura?: 'responsable_inscripto' | 'monotributo' | 'exento' | 'sin_datos' | undefined
}

/** Antes de crear uno: el CUIT no se repite en todo el bar, y el nombre, entre los del mismo tipo. */
function alreadyThere(
  catalog: PostingCatalog,
  name: string,
  cuit: string | null | undefined,
  kinds: readonly PartyKind[],
): string | null {
  const key = textKey(name)
  const digits = (cuit ?? '').replace(/\D/g, '')
  const same = catalog.parties.find(
    (p) =>
      p.active &&
      ((digits.length === 11 && (p.taxId ?? '').replace(/\D/g, '') === digits) ||
        (kinds.includes(p.kind) &&
          (textKey(p.name) === key || (p.tradeName !== null && textKey(p.tradeName) === key)))),
  )
  return same
    ? `Ya está cargado «${same.tradeName ?? same.name}»: usalo en vez de crear otro.`
    : null
}

function newSupplier(input: NewSupplierInput): Extract<DraftSupplier, { kind: 'new' }> {
  return {
    kind: 'new',
    name: input.nombre,
    ivaCondition: input.como_factura ?? null,
    taxId: input.cuit ?? null,
  }
}

/** El proveedor que dijo, si dijo alguno (o el del gasto fijo): `null` es que no hay. */
async function supplierFrom(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  input: { proveedor?: string | undefined; proveedor_nuevo?: NewSupplierInput | undefined },
  recurring: RecurringFacts | null,
  kinds: readonly PartyKind[],
): Promise<Resolved<DraftSupplier | null>> {
  if (input.proveedor && input.proveedor_nuevo) {
    return { ok: false, message: 'Mandá proveedor o proveedor_nuevo, no los dos.' }
  }
  if (input.proveedor_nuevo) {
    const taken = alreadyThere(
      catalog,
      input.proveedor_nuevo.nombre,
      input.proveedor_nuevo.cuit,
      kinds,
    )
    return taken
      ? { ok: false, message: taken }
      : { ok: true, value: newSupplier(input.proveedor_nuevo) }
  }
  if (input.proveedor) {
    const party = await findParty(ctx, catalog, input.proveedor, kinds)
    if (!party.ok) return party
    return { ok: true, value: await existingSupplier(ctx, party.value) }
  }
  // El del gasto fijo, si se le puede cargar esto; si no, va sin proveedor, como en la hoja.
  const fromRecurring = catalog.parties.find(
    (p) => p.id === recurring?.partyId && p.active && kinds.includes(p.kind),
  )
  return { ok: true, value: fromRecurring ? await existingSupplier(ctx, fromRecurring) : null }
}

async function findRecurring(
  ctx: TexToolContext,
  wanted: string | undefined,
): Promise<Resolved<RecurringFacts | null>> {
  if (!wanted) return { ok: true, value: null }
  const list = await listRecurringExpenses(ctx.tenantId, { today: ctx.today })
  const byId = list.find((r) => r.id === wanted)
  const match = byId
    ? ({ kind: 'one', value: byId } as const)
    : matchByName(wanted, list, (r) => [r.name])
  if (match.kind === 'many') {
    return {
      ok: false,
      message: `«${wanted}» puede ser ${match.options
        .slice(0, 8)
        .map((r) => r.name)
        .join(', ')}. Preguntale cuál.`,
    }
  }
  if (match.kind === 'none') {
    return { ok: false, message: `No hay un gasto fijo «${wanted}». Mirá cuáles hay.` }
  }
  const r = match.value
  return {
    ok: true,
    value: {
      id: r.id,
      name: r.name,
      partyId: r.partyId,
      accountId: r.accountId,
      voucherType: r.voucherType,
      vatRateBp: r.vatRateBp,
      amountCents: r.amountCents,
      treasuryAccountId: r.treasuryAccountId,
    },
  }
}

/** «Va a…»: entre las cuentas que se pueden imputar, que es lo que ofrece el formulario. */
async function findImputation(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  wanted: string | undefined,
): Promise<Resolved<{ id: string; name: string } | null>> {
  if (!wanted) return { ok: true, value: null }
  const narrowed = matchImputable(wanted, catalog.accounts)
  if (narrowed.kind === 'one') {
    return { ok: true, value: { id: narrowed.value.id, name: narrowed.value.name } }
  }
  if (narrowed.kind === 'many') {
    return {
      ok: false,
      message: `«${wanted}» puede ser ${narrowed.options
        .slice(0, 8)
        .map((a) => `${a.code} ${a.name}`)
        .join(', ')}. Elegí una con buscar_cuenta o preguntale.`,
    }
  }
  // No es ninguna de las imputables: que `resolveAccount` diga qué pasa con esa palabra.
  const resolved = await resolveAccount(ctx, wanted)
  if (!resolved.ok) return resolved
  return {
    ok: false,
    message: `«${resolved.value.name}» no sirve para una compra o un gasto: tiene que ser una cuenta de gasto o de activo, sin proveedor. Buscá otra con buscar_cuenta.`,
  }
}

function sortedTreasuries(catalog: PostingCatalog) {
  return [...catalog.treasuries].sort(
    (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'),
  )
}

/** Con qué se paga: la que dijo, o la que propone la hoja (la del gasto fijo, la última con ese proveedor, la Caja). */
async function findTreasury(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  wanted: string | undefined,
  known: { recurring?: string | null | undefined; lastUsed?: string | null | undefined },
): Promise<Resolved<TreasuryFacts>> {
  const all = sortedTreasuries(catalog)
  let id: string | null
  if (wanted) {
    const resolved = await resolveTreasury(ctx, wanted)
    if (!resolved.ok) return resolved
    id = resolved.value.id
  } else {
    id = pickTreasury({
      treasuries: all.filter((t) => t.active),
      lastUsedWithParty: known.recurring ?? known.lastUsed ?? null,
      myLastQuickExpense: known.lastUsed ?? null,
      order: all.map((t) => t.id),
    })
  }
  const found = all.find((t) => t.id === id)
  return found
    ? { ok: true, value: { id: found.id, name: found.name, kind: found.kind } }
    : { ok: false, message: 'No hay ninguna caja activa: hay que cargar una en Ajustes.' }
}

/** Lo que recuerda el sistema del proveedor, para la caja. */
function lastTreasuryOf(supplier: DraftSupplier | null): string | null {
  return supplier?.kind === 'existing' ? (supplier.memory?.treasuryAccountId ?? null) : null
}

function extrasOf(
  input: {
    no_gravado?: number | undefined
    exento?: number | undefined
    impuestos_internos?: number | undefined
    percepcion_iva?: number | undefined
    percepcion_iibb?: number | undefined
    percepcion_ganancias?: number | undefined
    otros_tributos?: number | undefined
  } = {},
): CompraExtras {
  const cents = (pesos: number | undefined) => (pesos === undefined ? null : pesosToCents(pesos))
  return {
    nonTaxedCents: cents(input.no_gravado),
    exemptCents: cents(input.exento),
    internalTaxCents: cents(input.impuestos_internos),
    percIvaCents: cents(input.percepcion_iva),
    percIibbCents: cents(input.percepcion_iibb),
    percGananciasCents: cents(input.percepcion_ganancias),
    otherTaxesCents: cents(input.otros_tributos),
  }
}

/** «¿Ya está cargada?»: el mismo aviso que muestra la pantalla de la compra mientras se carga. */
async function duplicateNotices(
  ctx: TexToolContext,
  params: {
    partyId: string | null
    totalCents: number | null
    issueDate: string
    voucherType: Parameters<typeof voucherNumberRequired>[0]
    pointOfSale: number | null
    number: number | null
  },
) {
  const { partyId, totalCents, number } = params
  if (!partyId || totalCents === null) return []
  if (voucherNumberRequired(params.voucherType) && number === null) return []
  const found = await optional(
    findPossibleDuplicate(ctx.tenantId, { ...params, partyId, totalCents }),
  )
  if (!found) return []
  return [
    notice(
      'tex_posible_duplicado',
      found.match === 'number'
        ? `Parece que ya está cargada: ${found.label}.`
        : `Hay una parecida de hace pocos días: ${found.label}.`,
    ),
  ]
}

// ─── Lo que entra ────────────────────────────────────────────────────────────

const proveedorNuevoField = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    cuit: z.string().max(20).optional(),
    como_factura: z
      .enum(['responsable_inscripto', 'monotributo', 'exento', 'sin_datos'])
      .optional(),
  })
  .optional()
  .describe('Si dijo que es nuevo, en vez de proveedor. Con factura hace falta el CUIT.')

const gastoFijoField = z.string().min(1).optional().describe('El gasto fijo que es: nombre o id.')

const cuentaField = z
  .string()
  .min(1)
  .optional()
  .describe('En qué es: nombre, código o id. Si no lo dijo, la habitual del proveedor.')

const cuitField = z.string().max(20)

// ─── Las herramientas ────────────────────────────────────────────────────────

/** Compra, compra y pago, gasto, pago, proveedores y plan de la semana. */
export const comprasActionTools = [
  defineTool({
    name: 'preparar_compra',
    description:
      'Prepara una compra con forma de factura: factura A, B o C, tique o sin comprobante, a deber o ya pagada («ya la pagué con X» es la compra y pago, con pagada). No guarda nada: muestra un tique para confirmar. Notas de crédito o débito, DDJJ y facturas de comisiones van en su pantalla: mandalas igual y te digo a dónde llevarla.',
    input: z.object({
      proveedor: z.string().min(1).optional().describe('Nombre, CUIT o id.'),
      proveedor_nuevo: proveedorNuevoField,
      papel: z
        .enum([...COMPRA_PAPERS, ...SCREEN_PAPERS])
        .optional()
        .describe('Si no lo dijo, el habitual del proveedor.'),
      punto_de_venta: z.number().int().min(0).max(99_999).optional(),
      numero: z.number().int().min(1).max(99_999_999).optional(),
      remito: z.string().max(40).optional().describe('El número, si va sin factura con remito.'),
      fecha: dayField('La fecha del papel, yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      vence: dayField(
        'Vencimiento yyyy-MM-dd. Si no lo dijo, sale del plazo del proveedor.',
      ).optional(),
      plazo_dias: z.number().int().min(0).max(365).optional().describe('«A 30 días».'),
      total: pesosField('Total del papel, en pesos, con IVA y percepciones.').optional(),
      alicuota: alicuotaField(
        'De un total, en %: 21, 10.5, 27… Si no la dijo, la de siempre.',
      ).optional(),
      iva: pesosField('El IVA impreso, si lo dijo y cargás por total.').optional(),
      netos: z
        .array(
          z.object({
            alicuota: alicuotaField(),
            neto: pesosField(),
            iva: pesosField().optional(),
          }),
        )
        .max(6)
        .optional()
        .describe('Solo si dijo el neto de cada alícuota. Con total, se controla contra el total.'),
      extras: z
        .object({
          no_gravado: pesosField().optional(),
          exento: pesosField().optional(),
          impuestos_internos: pesosField().optional(),
          percepcion_iva: pesosField().optional(),
          percepcion_iibb: pesosField().optional(),
          percepcion_ganancias: pesosField().optional(),
          otros_tributos: pesosField().optional(),
        })
        .optional()
        .describe('Lo que el papel discrimina aparte, en pesos.'),
      cuenta: cuentaField,
      pagada: z
        .object({
          caja: z.string().min(1).optional().describe('Si no lo dijo, la de siempre.'),
          monto: pesosField('Si pagó solo una parte.').optional(),
          fecha: dayField('Si pagó otro día que hoy.').optional(),
          referencia: z.string().max(60).optional(),
        })
        .optional()
        .describe('Si ya la pagó: es la compra y pago.'),
      gasto_fijo: gastoFijoField,
      nota: z.string().max(1000).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la compra',
    done: () => 'Preparé la compra',
    run: async (input, ctx) => {
      const { papel } = input
      if (papel && isScreenPaper(papel)) {
        return { kind: 'error', message: screenPaperMessage(papel) }
      }
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const recurring = await findRecurring(ctx, input.gasto_fijo)
      if (!recurring.ok) return { kind: 'error', message: recurring.message }
      const supplier = await supplierFrom(ctx, catalog, input, recurring.value, PURCHASE_KINDS)
      if (!supplier.ok) {
        // Una tarjeta o una app no le vende al bar: lo que cobra entra con el cobro o desde Importar.
        const collector = input.proveedor
          ? matchByName(
              input.proveedor,
              catalog.parties.filter((p) => COLLECTOR_KINDS.includes(p.kind)),
              (p) => [p.name, p.tradeName],
            )
          : null
        return {
          kind: 'error',
          message:
            collector?.kind === 'one'
              ? `${collector.value.tradeName ?? collector.value.name} no es un proveedor: lo que cobra se descuenta en preparar_cobro. ${screenPaperMessage('factura_de_comisiones')}`
              : supplier.message,
        }
      }
      const account = await findImputation(ctx, catalog, input.cuenta)
      if (!account.ok) return { kind: 'error', message: account.message }

      let pay = null
      if (input.pagada) {
        const treasury = await findTreasury(ctx, catalog, input.pagada.caja, {
          recurring: recurring.value?.treasuryAccountId,
          lastUsed: lastTreasuryOf(supplier.value),
        })
        if (!treasury.ok) return { kind: 'error', message: treasury.message }
        pay = {
          treasury: treasury.value,
          amountCents: input.pagada.monto === undefined ? null : pesosToCents(input.pagada.monto),
          date: input.pagada.fecha ?? null,
          reference: input.pagada.referencia ?? null,
        }
      }

      const issueDate = input.fecha ?? ctx.today
      const plan = compraPlan({
        today: ctx.today,
        supplier: supplier.value,
        paper: papel ?? null,
        pointOfSale: input.punto_de_venta ?? null,
        number: input.numero ?? null,
        remito: input.remito ?? null,
        issueDate,
        dueDate: input.vence ?? null,
        termDays: input.plazo_dias ?? null,
        totalCents: input.total === undefined ? null : pesosToCents(input.total),
        vatRateBp: input.alicuota === undefined ? null : rateBpOf(input.alicuota),
        vatCents: input.iva === undefined ? null : pesosToCents(input.iva),
        nets: (input.netos ?? []).map((n) => ({
          rateBp: rateBpOf(n.alicuota),
          netCents: pesosToCents(n.neto),
          vatCents: n.iva === undefined ? null : pesosToCents(n.iva),
        })),
        extras: extrasOf(input.extras),
        iibbJurisdictionCode: catalog.settings.iibbJurisdictionCode,
        otherTaxesAccountId:
          catalog.accounts.find((a) => a.systemKey === 'other_taxes_expense')?.id ?? null,
        account: account.value,
        imputable: imputableAccounts(catalog.accounts),
        pay,
        recurring: recurring.value,
        notes: input.nota ?? null,
        firstOpenDate: await loadFirstOpenDate(ctx.tenantId),
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }

      const duplicates = await duplicateNotices(ctx, {
        partyId: supplier.value?.kind === 'existing' ? supplier.value.facts.id : null,
        totalCents: plan.totalCents,
        issueDate,
        voucherType: plan.voucherType,
        pointOfSale: plan.pointOfSale,
        number: plan.number,
      })
      return withNotices(await prepareDocument(ctx, plan.form, plan.values, plan.ticket), [
        ...plan.notices,
        ...duplicates,
      ])
    },
  }),

  defineTool({
    name: 'preparar_gasto',
    description:
      'Prepara un gasto chico ya pagado y sin factura de proveedor: hielo del kiosco, un remís, algo con remito o tique. Si le dieron factura, es preparar_compra con pagada. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      monto: pesosField('En pesos. Con un gasto fijo de monto cargado, puede faltar.').optional(),
      cuenta: cuentaField,
      caja: z.string().min(1).optional().describe('Con qué pagó. Si no lo dijo, la de siempre.'),
      proveedor: z.string().min(1).optional().describe('Opcional: nombre, CUIT o id.'),
      proveedor_nuevo: proveedorNuevoField,
      papel: z
        .enum(GASTO_PAPERS)
        .optional()
        .describe('Si no lo dijo y no hay proveedor, sin_comprobante.'),
      punto_de_venta: z
        .number()
        .int()
        .min(0)
        .max(99_999)
        .optional()
        .describe('Del tique, si lo tiene.'),
      numero: z
        .number()
        .int()
        .min(1)
        .max(99_999_999)
        .optional()
        .describe('Del tique, si lo tiene.'),
      remito: z.string().max(40).optional(),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      detalle: z.string().max(240).optional(),
      gasto_fijo: gastoFijoField,
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el gasto',
    done: () => 'Preparé el gasto',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const recurring = await findRecurring(ctx, input.gasto_fijo)
      if (!recurring.ok) return { kind: 'error', message: recurring.message }
      const supplier = await supplierFrom(ctx, catalog, input, recurring.value, SUPPLIER_KINDS)
      if (!supplier.ok) return { kind: 'error', message: supplier.message }
      const account = await findImputation(ctx, catalog, input.cuenta)
      if (!account.ok) return { kind: 'error', message: account.message }
      const treasury = await findTreasury(ctx, catalog, input.caja, {
        recurring: recurring.value?.treasuryAccountId,
        lastUsed: lastTreasuryOf(supplier.value),
      })
      if (!treasury.ok) return { kind: 'error', message: treasury.message }

      const plan = gastoPlan({
        supplier: supplier.value,
        paper: input.papel ?? null,
        pointOfSale: input.punto_de_venta ?? null,
        number: input.numero ?? null,
        remito: input.remito ?? null,
        amountCents: input.monto === undefined ? null : pesosToCents(input.monto),
        account: account.value,
        imputable: imputableAccounts(catalog.accounts),
        treasury: treasury.value,
        date: input.fecha ?? ctx.today,
        detail: input.detalle ?? null,
        recurring: recurring.value,
        firstOpenDate: await loadFirstOpenDate(ctx.tenantId),
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return withNotices(
        await prepareDocument(ctx, plan.form, plan.values, plan.ticket),
        plan.notices,
      )
    },
  }),

  defineTool({
    name: 'preparar_pago',
    description:
      'Prepara un pago a un proveedor, organismo, socio o sueldos. Con monto, cancela sus comprobantes más viejos hasta cubrirlo y lo que sobra queda a cuenta; sin monto, lo vencido y lo de esta semana. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      proveedor: z.string().min(1).describe('Nombre, CUIT o id.'),
      monto: pesosField('En pesos. Si no lo dijo, lo que se le vence.').optional(),
      caja: z.string().min(1).optional().describe('Con qué paga. Si no lo dijo, la de siempre.'),
      que_paga: z
        .enum(PAGO_SCOPES)
        .optional()
        .describe('Si lo dijo: lo_vencido, todo, o a_cuenta (sin aplicarlo a nada).'),
      comprobantes: z
        .array(z.string().min(1))
        .max(30)
        .optional()
        .describe('Comprobantes puntuales: su partida_id (ver_participe) o su número («1290»).'),
      de_cuenta: z.string().min(1).optional().describe('Si se le debe en más de una cuenta.'),
      dar_por_cancelado: z
        .boolean()
        .optional()
        .describe('Si dijo que la diferencia chica (hasta $ 1.000) queda cancelada.'),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      referencia: z.string().max(60).optional().describe('N.º de transferencia.'),
      gasto_fijo: gastoFijoField,
      nota: z.string().max(1000).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el pago',
    done: () => 'Preparé el pago',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const party = await findParty(ctx, catalog, input.proveedor, PAYABLE_KINDS)
      if (!party.ok) return { kind: 'error', message: party.message }
      const partyId = party.value.id
      const recurring = await findRecurring(ctx, input.gasto_fijo)
      if (!recurring.ok) return { kind: 'error', message: recurring.message }
      if (recurring.value?.partyId && recurring.value.partyId !== partyId) {
        return {
          kind: 'error',
          message: `«${recurring.value.name}» es un gasto fijo de otro proveedor. Preguntale cuál es.`,
        }
      }
      const [items, memory, week] = await Promise.all([
        loadOpenItems(ctx.tenantId, { openItemsOf: [{ partyId }] }),
        optional(getFormDefaults(ctx.tenantId, partyId)),
        optional(getWeekPlan(ctx.tenantId, mondayOf(ctx.today))),
      ])
      const treasury = await findTreasury(ctx, catalog, input.caja, {
        lastUsed: memory?.treasuryAccountId,
      })
      if (!treasury.ok) return { kind: 'error', message: treasury.message }

      const plan = pagoPlan({
        today: ctx.today,
        date: input.fecha ?? ctx.today,
        party: {
          id: partyId,
          name: party.value.tradeName ?? party.value.name,
          legalName: party.value.name,
          tradeName: party.value.tradeName,
        },
        items,
        account: input.de_cuenta ?? null,
        accountNames: new Map(catalog.accounts.map((a) => [a.id, a.name])),
        amountCents: input.monto === undefined ? null : pesosToCents(input.monto),
        scope: input.que_paga ?? null,
        lines: input.comprobantes ?? null,
        writeOff: input.dar_por_cancelado ?? false,
        treasury: treasury.value,
        reference: input.referencia ?? null,
        notes: input.nota ?? null,
        recurring: recurring.value,
        taxes: buildPostingContext(catalog),
        week: week?.find((r) => r.partyId === partyId) ?? null,
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return prepareDocument(ctx, plan.form, plan.values, plan.ticket)
    },
  }),

  defineTool({
    name: 'preparar_proveedor',
    description:
      'Prepara el alta o los cambios de un proveedor: su CUIT, cómo factura, a cuántos días se le paga, en qué se le compra. Con tipo cliente, lo mismo para un cliente. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      proveedor: z.string().min(1).optional().describe('A quién se cambia. Sin esto, es un alta.'),
      tipo: z.enum(['proveedor', 'cliente']).optional().describe('Por defecto, proveedor.'),
      nombre: z.string().trim().min(2).max(120).optional().describe('La razón social.'),
      nombre_fantasia: z.string().max(120).optional(),
      cuit: cuitField.optional(),
      como_factura: z
        .enum([
          'responsable_inscripto',
          'monotributo',
          'exento',
          'consumidor_final',
          'no_alcanzado',
          'sin_datos',
        ])
        .optional(),
      plazo_dias: z
        .number()
        .int()
        .min(0)
        .max(365)
        .optional()
        .describe('A cuántos días se le paga.'),
      cuenta: z.string().min(1).optional().describe('En qué se le compra: nombre, código o id.'),
      papel_habitual: z.enum(COMPRA_PAPERS).optional(),
      email: z.string().max(160).optional(),
      telefono: z.string().max(30).optional(),
      direccion: z.string().max(200).optional(),
      notas: z.string().max(500).optional(),
      activo: z.boolean().optional().describe('false lo da de baja.'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la ficha',
    done: () => 'Preparé la ficha',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const kind = input.tipo === 'cliente' ? 'customer' : 'supplier'
      let existing = null
      if (input.proveedor) {
        const kinds: readonly PartyKind[] = kind === 'customer' ? ['customer'] : SUPPLIER_KINDS
        const party = await findParty(ctx, catalog, input.proveedor, kinds)
        if (!party.ok) return { kind: 'error', message: party.message }
        existing = await getParty(ctx.tenantId, party.value.id)
        if (!existing) return { kind: 'error', message: 'Ya no está: preguntale cuál es.' }
      } else if (input.nombre) {
        const kinds: readonly PartyKind[] = kind === 'customer' ? ['customer'] : SUPPLIER_KINDS
        const taken = alreadyThere(catalog, input.nombre, input.cuit, kinds)
        if (taken)
          return { kind: 'error', message: `${taken} Para cambiarlo, pasalo en proveedor.` }
      }
      const account = await findImputation(ctx, catalog, input.cuenta)
      if (!account.ok) return { kind: 'error', message: account.message }

      const plan = proveedorPlan({
        kind,
        existing,
        changes: {
          name: input.nombre ?? null,
          tradeName: input.nombre_fantasia ?? null,
          cuit: input.cuit ?? null,
          condition: input.como_factura ?? null,
          termDays: input.plazo_dias ?? null,
          account: account.value,
          voucherType: input.papel_habitual ?? null,
          email: input.email ?? null,
          phone: input.telefono ?? null,
          address: input.direccion ?? null,
          notes: input.notas ?? null,
          active: input.activo ?? null,
        },
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return {
        kind: 'prepared',
        prepared: {
          executor: 'compras.proveedor',
          payload: { values: plan.values },
          ticket: plan.ticket,
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_plan_semana',
    description:
      'Prepara cuánto se le va a pagar a cada proveedor en una semana (el Plan de la semana). Es un presupuesto: no mueve plata. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd. Si no lo dijo, esta.').optional(),
      pagos: z
        .array(
          z.object({
            proveedor: z.string().min(1).describe('Nombre, CUIT o id.'),
            monto: z.number().min(0).max(100_000_000_000).describe('En pesos. 0 lo saca del plan.'),
          }),
        )
        .min(1)
        .max(100),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el plan de la semana',
    done: () => 'Preparé el plan de la semana',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const items: Array<{ partyId: string; name: string; cents: number }> = []
      const found = await Promise.all(
        input.pagos.map((pago) => findParty(ctx, catalog, pago.proveedor, SUPPLIER_KINDS)),
      )
      for (const [index, party] of found.entries()) {
        if (!party.ok) return { kind: 'error', message: party.message }
        items.push({
          partyId: party.value.id,
          name: party.value.tradeName ?? party.value.name,
          cents: pesosToCents(input.pagos[index]?.monto ?? 0),
        })
      }
      const weekStart = mondayOf(input.semana ?? ctx.today)
      const current = await optional(getWeekPlan(ctx.tenantId, weekStart))
      const plan = planSemanaPlan({ weekStart, items, current: current ?? [] })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return {
        kind: 'prepared',
        prepared: { executor: 'compras.plan_semana', payload: plan.values, ticket: plan.ticket },
      }
    },
  }),
]

function linkTo(
  ctx: TexToolContext,
  screen: string,
  params: Parameters<typeof texScreenHref>[2],
): string | null {
  const link = texScreenHref(ctx.slug, screen, params)
  return link.ok ? link.href : null
}

export const comprasExecutors: Readonly<Record<string, TexExecutor>> = {
  // Se manda tal cual: en una edición, `saveParty` solo toca lo que viene (no lo pasado por zod,
  // que le agrega los valores por defecto).
  'compras.proveedor': simpleExecutor<{ values: Record<string, unknown> }, SavedParty>(
    z.object({ values: z.record(z.string(), z.unknown()) }),
    (payload, ctx) => saveParty(ctx.slug, payload.values),
    (saved, _payload, ctx) => ({
      href: linkTo(ctx, saved.kind === 'customer' ? 'cliente' : 'proveedor', { id: saved.id }),
    }),
  ),
  'compras.plan_semana': simpleExecutor(
    saveWeekBudgetsSchema,
    (payload, ctx) => saveWeekBudgets(ctx.slug, payload),
    (_saved, payload, ctx) => ({
      href: linkTo(ctx, 'compras.semana', { semana: payload.weekStart }),
    }),
  ),
}
