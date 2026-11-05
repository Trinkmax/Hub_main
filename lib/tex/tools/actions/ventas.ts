import 'server-only'

import { z } from 'zod'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import {
  buildPostingContext,
  type CatalogParty,
  loadOpenItems,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { getSalesRangeDefaults } from '@/lib/accounting/queries/forms'
import { listSalesTargets } from '@/lib/accounting/queries/projection'
import { DEDUCTION_KINDS } from '@/lib/accounting/schemas'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { CHANNELS, type Channel } from '@/lib/accounting/types'
import { addMonthsToYearMonth, monthOf, monthRange, serviceDayInCordoba } from '@/lib/dates'
import { prepareDocument } from '../../document-action'
import { type Resolved, resolveTreasury } from '../../resolve'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  dayField,
  defineTool,
  monthField,
  pesosField,
  pesosToCents,
  type TexExecutor,
  type TexToolContext,
} from '../types'
import { alicuotaField, rateBpOf, type TreasuryFacts, withNotices } from './_compras-values'
import {
  type CierreDraft,
  CLOSE_PAPERS,
  COBRO_RESTOS,
  COBRO_SCOPES,
  COMMISSION_MODES,
  cierrePlan,
  closeMethodsOf,
  cobroPlan,
  facturaVentaPlan,
  objetivosCopiados,
  objetivosDeLista,
  objetivosPorDia,
  SALE_PAPERS,
} from './_ventas-values'
import { findParty } from './compras'

/** Quién paga en «Registrar un cobro». */
const RECEIVABLE_KINDS = [
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
] as const

/** Un cliente de los que ofrece el formulario: los del sistema (señas, consumidor final) no. */
async function findCustomer(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  wanted: string,
): Promise<Resolved<CatalogParty>> {
  const found = await findParty(ctx, catalog, wanted, ['customer'])
  if (!found.ok) return found
  return found.value.systemKey === null
    ? found
    : {
        ok: false,
        message: `«${found.value.name}» no es un cliente al que se le pueda cargar esto.`,
      }
}

function salesPointsOf(catalog: PostingCatalog) {
  return catalog.salesPoints
    .filter((p) => p.active)
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ number: p.number, label: p.label, defaultChannel: p.defaultChannel }))
}

/** Adónde entra la plata: la que dijo, o el banco y si no la caja. La tarjeta de la empresa no. */
async function incomeTreasury(
  ctx: TexToolContext,
  catalog: PostingCatalog,
  wanted: string | undefined,
): Promise<Resolved<TreasuryFacts>> {
  const usable = catalog.treasuries
    .filter((t) => t.active && t.kind !== 'credit_card')
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
  let id: string | null
  if (wanted) {
    const resolved = await resolveTreasury(ctx, wanted)
    if (!resolved.ok) return resolved
    id = resolved.value.id
  } else {
    id =
      usable.find((t) => t.kind === 'bank')?.id ??
      usable.find((t) => t.kind === 'cash')?.id ??
      usable[0]?.id ??
      null
  }
  const found = usable.find((t) => t.id === id)
  return found
    ? { ok: true, value: { id: found.id, name: found.name, kind: found.kind } }
    : { ok: false, message: 'Ahí no puede entrar plata: elegí una caja, un banco o una billetera.' }
}

const canalField = z.enum(CHANNELS).optional()
const montoCero = z.number().min(0).max(100_000_000_000)

/** Cierre del día, cobros, factura de venta y objetivos. */
export const ventasActionTools = [
  defineTool({
    name: 'preparar_cierre',
    description:
      'Prepara el cierre del día: lo vendido por cada medio de cobro, el efectivo contado y lo facturado. Los medios que no diga van en cero. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      fecha: dayField(
        'El día que se cierra, yyyy-MM-dd. Si no lo dijo, la noche de hoy (antes de las 5, la de ayer).',
      ).optional(),
      ventas: z
        .array(
          z.object({
            medio: z.string().min(1).describe('El nombre del medio: «Efectivo», «Débito».'),
            monto: montoCero.describe('En pesos.'),
            clientes: z
              .array(z.object({ cliente: z.string().min(1), monto: pesosField() }))
              .max(50)
              .optional()
              .describe('En cuenta corriente: lo de cada cliente.'),
          }),
        )
        .min(1)
        .max(40),
      efectivo_contado: montoCero.optional().describe('Lo que se contó en la caja, si lo dijo.'),
      facturado: z
        .array(
          z.object({
            papel: z.enum(CLOSE_PAPERS).optional().describe('Por defecto, factura_b.'),
            punto_de_venta: z.number().int().min(0).max(99_999).optional(),
            desde: z
              .number()
              .int()
              .min(1)
              .max(99_999_999)
              .optional()
              .describe('Si no lo dijo, sigue del último.'),
            hasta: z.number().int().min(1).max(99_999_999).optional(),
            total: pesosField('Con IVA, en pesos.'),
            alicuota: alicuotaField('En %: 21, 10.5, 27… Por defecto, 21.').optional(),
            canal: canalField,
            cliente: z.string().min(1).optional().describe('En las A.'),
          }),
        )
        .max(50)
        .optional(),
      turno: z.string().max(20).optional().describe('Si ese día ya tiene un cierre.'),
      total_sistema: montoCero
        .optional()
        .describe('El total del sistema de caja, si lo dijo: si no coincide, no se guarda.'),
      motivo: z
        .string()
        .max(300)
        .optional()
        .describe('Por qué se facturó más de lo vendido (una factura de otro día).'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el cierre',
    done: () => 'Preparé el cierre',
    run: async (input, ctx) => {
      const date = input.fecha ?? serviceDayInCordoba()
      const catalog = await loadPostingCatalog(ctx.tenantId)

      const sales: Array<CierreDraft['sales'][number]> = []
      for (const venta of input.ventas) {
        const customers: Array<{ partyId: string; name: string; cents: number }> = []
        for (const item of venta.clientes ?? []) {
          const customer = await findCustomer(ctx, catalog, item.cliente)
          if (!customer.ok) return { kind: 'error', message: customer.message }
          customers.push({
            partyId: customer.value.id,
            name: customer.value.tradeName ?? customer.value.name,
            cents: pesosToCents(item.monto),
          })
        }
        sales.push({ method: venta.medio, cents: pesosToCents(venta.monto), customers })
      }

      const invoiced: Array<CierreDraft['invoiced'][number]> = []
      for (const line of input.facturado ?? []) {
        let party = null
        if (line.cliente) {
          const customer = await findCustomer(ctx, catalog, line.cliente)
          if (!customer.ok) return { kind: 'error', message: customer.message }
          party = {
            id: customer.value.id,
            name: customer.value.tradeName ?? customer.value.name,
          }
        }
        invoiced.push({
          voucherType: line.papel ?? 'factura_b',
          pointOfSale: line.punto_de_venta ?? null,
          from: line.desde ?? null,
          to: line.hasta ?? null,
          totalCents: pesosToCents(line.total),
          rateBp: line.alicuota === undefined ? null : rateBpOf(line.alicuota),
          channel: line.canal ?? null,
          party,
        })
      }

      const [firstOpenDate, closes, ranges] = await Promise.all([
        loadFirstOpenDate(ctx.tenantId),
        listDocuments(ctx.tenantId, {
          from: date,
          to: date,
          kinds: ['sales_close'],
          status: 'posted',
          limit: 20,
        }),
        getSalesRangeDefaults(ctx.tenantId),
      ])

      const plan = cierrePlan({
        date,
        methods: closeMethodsOf(catalog),
        sales,
        cashCountedCents:
          input.efectivo_contado === undefined ? null : pesosToCents(input.efectivo_contado),
        invoiced,
        salesPoints: salesPointsOf(catalog),
        rangeDefaults: ranges.filter((r) => r.pointOfSale > 0 && r.lastNumberTo >= 0),
        existing: closes.rows.map((d) => ({
          title: d.description.trim() !== '' ? d.description : d.title,
          totalCents: d.totalCents,
        })),
        shift: input.turno ?? null,
        controlTotalCents:
          input.total_sistema === undefined ? null : pesosToCents(input.total_sistema),
        reason: input.motivo ?? null,
        ctx: buildPostingContext(catalog),
        limits: {
          booksStart: catalog.settings.booksStartDate,
          serviceDay: serviceDayInCordoba(),
          firstOpenDate,
        },
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return prepareDocument(ctx, plan.form, plan.values, plan.ticket)
    },
  }),

  defineTool({
    name: 'preparar_cobro',
    description:
      'Prepara «entró plata»: la liquidación de una tarjeta o una app, o un cliente que paga, aplicada a sus ventas pendientes. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      quien: z.string().min(1).describe('Quién pagó: la tarjeta, la app o el cliente.'),
      entro: pesosField('Lo que entró, en pesos, ya con los descuentos.'),
      caja: z.string().min(1).optional().describe('A dónde entró. Si no lo dijo, el banco.'),
      fecha: dayField('Qué día entró, yyyy-MM-dd. Si no lo dijo, hoy.').optional(),
      ventas: z
        .enum(COBRO_SCOPES)
        .optional()
        .describe(
          'De qué ventas es. Por defecto: lo atrasado en tarjetas y apps; a un cliente, lo más viejo.',
        ),
      partidas: z
        .array(z.string().min(1))
        .max(60)
        .optional()
        .describe('Ventas puntuales: su partida_id (ver_participe) o una parte de su nombre.'),
      usar_a_favor: z.boolean().optional().describe('Si descuenta lo que tiene a favor.'),
      bruto: pesosField('El total de la liquidación, antes de descuentos, si lo dijo.').optional(),
      descuentos: z
        .array(
          z.object({
            tipo: z.enum(DEDUCTION_KINDS),
            monto: pesosField(),
            certificado: z.string().max(40).optional().describe('Obligatorio en ret_ganancias.'),
          }),
        )
        .max(9)
        .optional()
        .describe('Lo que le descontaron, si lo dijo. Si no, se estima con sus tasas.'),
      resto: z
        .enum(COBRO_RESTOS)
        .optional()
        .describe('Qué hacer con lo que no cierra: mandalo solo después de preguntárselo.'),
      factura_comision: z
        .object({
          modo: z.enum(COMMISSION_MODES).optional(),
          tipo: z.enum(['liquidacion', 'factura_a', 'factura_b', 'otro_comprobante']).optional(),
          punto_de_venta: z.number().int().min(0).max(99_999).optional(),
          numero: z.number().int().min(1).max(99_999_999).optional(),
        })
        .optional()
        .describe('Si no lo dijo, cómo factura la comisión ese pagador.'),
      referencia: z
        .string()
        .max(60)
        .optional()
        .describe('El n.º de liquidación o de transferencia.'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el cobro',
    done: () => 'Preparé el cobro',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const found = await findParty(ctx, catalog, input.quien, RECEIVABLE_KINDS)
      if (!found.ok) return { kind: 'error', message: found.message }
      const party = found.value
      const treasury = await incomeTreasury(ctx, catalog, input.caja)
      if (!treasury.ok) return { kind: 'error', message: treasury.message }

      // Las mismas que lee la hoja: sus cuentas «nos debe», sin «IVA a documentar».
      const all = await loadOpenItems(ctx.tenantId, { openItemsOf: [{ partyId: party.id }] })
      const customersAccount = catalog.accounts.find(
        (a) => a.systemKey === 'receivable_customers',
      )?.id
      const control = new Set([
        party.receivableAccountId,
        ...(customersAccount ? [customersAccount] : []),
      ])
      const items = all.filter((item) => item.openCents > 0 && control.has(item.accountId))

      const plan = cobroPlan({
        date: input.fecha ?? ctx.today,
        party: {
          id: party.id,
          name: party.tradeName ?? party.name,
          kind: party.kind,
          commissionVatMode: party.commissionVatMode,
          rates: party.rates,
        },
        items,
        treasury: treasury.value,
        receivedCents: pesosToCents(input.entro),
        reference: input.referencia ?? null,
        scope: input.ventas ?? null,
        lines: input.partidas ?? null,
        useCredits: input.usar_a_favor ?? false,
        grossCents: input.bruto === undefined ? null : pesosToCents(input.bruto),
        deductions: input.descuentos
          ? input.descuentos.map((d) => ({
              kind: d.tipo,
              cents: pesosToCents(d.monto),
              certificate: d.certificado ?? null,
            }))
          : null,
        rest: input.resto ?? null,
        voucher: {
          mode: input.factura_comision?.modo ?? null,
          type: input.factura_comision?.tipo ?? null,
          pointOfSale: input.factura_comision?.punto_de_venta ?? null,
          number: input.factura_comision?.numero ?? null,
        },
        feesOtherAccountId: catalog.accounts.find((a) => a.systemKey === 'fees_other')?.id ?? '',
        walletTreasuryName:
          party.kind === 'payment_wallet'
            ? (catalog.treasuries.find((t) => t.bankPartyId === party.id)?.name ?? null)
            : null,
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return withNotices(
        await prepareDocument(ctx, plan.form, plan.values, plan.ticket),
        plan.notices,
      )
    },
  }),

  defineTool({
    name: 'preparar_factura_venta',
    description:
      'Prepara una factura de venta suelta que ya se hizo: un evento, un catering, un sponsoreo. Lo de todas las noches va en el cierre, no acá. Para emitirla con ARCA o para notas de crédito y débito, llevá a ventas.nueva_factura con ir_a. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: z.string().min(1).describe('Nombre, CUIT o id.'),
      numero: z.number().int().min(1).max(99_999_999).optional(),
      punto_de_venta: z.number().int().min(0).max(99_999).optional(),
      papel: z
        .enum(SALE_PAPERS)
        .optional()
        .describe('Si no lo dijo, el que le corresponde al cliente.'),
      total: pesosField('Con IVA, en pesos.').optional(),
      alicuota: alicuotaField('Del total, en %: 21, 10.5, 27… Por defecto, 21.').optional(),
      netos: z
        .array(z.object({ alicuota: alicuotaField(), neto: pesosField() }))
        .max(6)
        .optional()
        .describe('Solo si dijo el neto de cada alícuota.'),
      no_gravado: pesosField().optional(),
      exento: pesosField().optional(),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      vence: dayField('Vencimiento yyyy-MM-dd. Si no lo dijo, el plazo del cliente.').optional(),
      canal: canalField.describe('Por defecto, eventos.'),
      cobrada: z
        .object({
          caja: z.string().min(1).optional().describe('Si no lo dijo, el banco.'),
          monto: pesosField('Si cobró solo una parte.').optional(),
        })
        .optional()
        .describe('Si ya se la pagaron: se guarda junto con el cobro.'),
      nota: z.string().max(1000).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la factura',
    done: () => 'Preparé la factura',
    run: async (input, ctx) => {
      const catalog = await loadPostingCatalog(ctx.tenantId)
      const customer = await findCustomer(ctx, catalog, input.cliente)
      if (!customer.ok) return { kind: 'error', message: customer.message }
      let collect = null
      if (input.cobrada) {
        const treasury = await incomeTreasury(ctx, catalog, input.cobrada.caja)
        if (!treasury.ok) return { kind: 'error', message: treasury.message }
        collect = {
          treasury: treasury.value,
          amountCents: input.cobrada.monto === undefined ? null : pesosToCents(input.cobrada.monto),
        }
      }
      const channel: Channel | null = input.canal ?? null
      const plan = facturaVentaPlan({
        customer: {
          id: customer.value.id,
          name: customer.value.tradeName ?? customer.value.name,
          ivaCondition: customer.value.ivaCondition,
          taxId: customer.value.taxId,
          paymentTermDays: customer.value.paymentTermDays,
        },
        paper: input.papel ?? null,
        pointOfSale: input.punto_de_venta ?? null,
        number: input.numero ?? null,
        issueDate: input.fecha ?? ctx.today,
        dueDate: input.vence ?? null,
        channel,
        salesPoints: salesPointsOf(catalog),
        totalCents: input.total === undefined ? null : pesosToCents(input.total),
        rateBp: input.alicuota === undefined ? null : rateBpOf(input.alicuota),
        nets: (input.netos ?? []).map((n) => ({
          rateBp: rateBpOf(n.alicuota),
          netCents: pesosToCents(n.neto),
        })),
        nonTaxedCents: input.no_gravado === undefined ? null : pesosToCents(input.no_gravado),
        exemptCents: input.exento === undefined ? null : pesosToCents(input.exento),
        collect,
        notes: input.nota ?? null,
      })
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return prepareDocument(ctx, plan.form, plan.values, plan.ticket)
    },
  }),

  defineTool({
    name: 'preparar_objetivos',
    description:
      'Prepara los objetivos de venta de la Proyección: por día, pegando una lista de un mes o copiando otro mes. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      dias: z
        .array(
          z.object({
            fecha: dayField(),
            objetivo: montoCero.optional().describe('En pesos. 0 lo saca.'),
            nota: z.string().max(120).optional().describe('«2x1 burger».'),
          }),
        )
        .max(62)
        .optional(),
      copiar: z
        .object({
          mes: monthField('A qué mes, yyyy-MM.'),
          de_mes: monthField('De qué mes. Si no lo dijo, el anterior.').optional(),
        })
        .optional(),
      lista: z
        .object({
          mes: monthField('De qué mes, yyyy-MM.'),
          texto: z.string().min(1).max(5000).describe('Un monto por renglón, tal como lo pasó.'),
          desde_dia: z.number().int().min(1).max(31).optional(),
        })
        .optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando los objetivos',
    done: () => 'Preparé los objetivos',
    run: async (input, ctx) => {
      const given = [input.dias, input.copiar, input.lista].filter((v) => v !== undefined)
      if (given.length !== 1) {
        return { kind: 'error', message: 'Mandá dias, copiar o lista: uno de los tres.' }
      }
      let plan: ReturnType<typeof objetivosPorDia>
      if (input.copiar) {
        const month = input.copiar.mes
        const fromMonth = input.copiar.de_mes ?? addMonthsToYearMonth(month, -1)
        const [targets, current] = await Promise.all([
          listSalesTargets(ctx.tenantId, monthRange(fromMonth)),
          listSalesTargets(ctx.tenantId, monthRange(month)),
        ])
        plan = objetivosCopiados({ month, fromMonth, targets, current })
      } else if (input.lista) {
        const current = await listSalesTargets(ctx.tenantId, monthRange(input.lista.mes))
        plan = objetivosDeLista({
          month: input.lista.mes,
          text: input.lista.texto,
          fromDay: input.lista.desde_dia ?? null,
          current,
        })
      } else {
        const days = input.dias ?? []
        const first = days[0]
        const current = first
          ? await listSalesTargets(ctx.tenantId, monthRange(monthOf(first.fecha)))
          : []
        plan = objetivosPorDia({
          days: days.map((d) => ({
            day: d.fecha,
            targetCents: d.objetivo === undefined ? undefined : pesosToCents(d.objetivo),
            note: d.nota ?? null,
          })),
          current,
        })
      }
      if (!plan.ok) return { kind: 'error', message: plan.message }
      return {
        kind: 'prepared',
        prepared: { executor: 'ventas.objetivos', payload: plan.values, ticket: plan.ticket },
      }
    },
  }),
]

export const ventasExecutors: Readonly<Record<string, TexExecutor>> = {
  'ventas.objetivos': simpleExecutor(
    salesTargetsSchema,
    (payload, ctx) => saveSalesTargets(ctx.slug, payload),
    (_saved, payload, ctx) => {
      const day = payload.items[0]?.day
      const link = texScreenHref(ctx.slug, 'ventas.proyeccion', day ? { mes: monthOf(day) } : {})
      return { href: link.ok ? link.href : null, point: 'Objetivo' }
    },
  ),
}
