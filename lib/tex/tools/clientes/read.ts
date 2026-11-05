import 'server-only'

import { z } from 'zod'
import { listCustomerProgramaCounts, listTags } from '@/lib/customers/queries'
import { addDays, addMonthsToYearMonth, daysBetween, monthRange } from '@/lib/dates'
import { listMenu } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import {
  getPointsRedemptionConfig,
  listCustomerLedger,
  listCustomerRedemptions,
  listPartnerBenefits,
  listPartners,
  listRewards,
  listRules,
  listTierBenefits,
  listTiers,
} from '@/lib/points/queries'
import { listCustomerPunchCards, listPunchCardTemplates } from '@/lib/punch-cards/queries'
import { getChurnRisk, getCustomerInsights, getTopCustomersBySpent } from '@/lib/stats/queries'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'
import { cappedBySize, compact, periodFields, texPeriod } from '../read/common'
import { capped, dayField, defineTool, money, monthField, noInput } from '../types'
import {
  clubTierRows,
  earnRateWords,
  type MenuNames,
  partnerRow,
  punchCardRow,
  punchCardStats,
  rewardRow,
  ruleRow,
} from './_club-values'
import { fail } from './_tickets'
import {
  birthdayRows,
  customerCardData,
  customerName,
  customerRow,
  dayOf,
  newCustomerRow,
  OWNER_ONLY,
  parseCustomerQuery,
  pickByName,
  rankVisits,
  tierNames,
  topCustomerRow,
} from './_values'
import {
  categoryWindowMonths,
  countAcceptingPromos,
  customerById,
  customersByIds,
  customersWithBirthdate,
  findCustomers,
  newCustomers,
  punchCardProgress,
  resolveCustomer,
  tagsWithCounts,
  tierMembers,
  topCustomersBy,
  visitsInPeriod,
} from './queries'

/** Lo que se muestra de una lista de clientes. */
const LIST_MAX = 30
const TOP_DEFAULT = 10
/** El ledger alcanza para ver qué vence: la ventana de categoría es de meses. */
const LEDGER_READ = 200

export const clienteField = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe('El cliente: nombre y apellido, los últimos números del teléfono o su id.')

/** Los nombres de la carta, solo si hay reglas que los necesitan. */
async function menuNames(tenantId: string): Promise<MenuNames> {
  const menu = await listMenu({ tenantId })
  const items = new Map(menu.items.map((item) => [item.id, item.name]))
  return {
    item: (id) => items.get(id) ?? null,
    category: (id) => categoryPathLabel(menu.categories, id) || null,
  }
}

/** Mirar clientes y el club. Nada de esto escribe, y nada de esto saca un teléfono o un mail enteros. */
export const clientesReadTools = [
  defineTool({
    name: 'buscar_cliente',
    description:
      'Busca clientes por nombre, apellido o números del teléfono y da su id, puntos, nivel, visitas y última visita. También lista a los de un nivel o a los que tienen una etiqueta («quiénes son los de tal nivel»). Usala cuando no estás seguro de quién es.',
    input: z.object({
      buscar: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Parte del nombre o del apellido, o números del teléfono.'),
      nivel: z.string().trim().min(1).max(60).optional().describe('Solo este nivel: nombre o id.'),
      etiqueta: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe('Solo los que tienen esta etiqueta: nombre o id.'),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Buscando al cliente',
    done: () => 'Busqué al cliente',
    run: async (input, ctx) => {
      if (!input.buscar && !input.nivel && !input.etiqueta) {
        return fail('Preguntale a quién busca: nombre, teléfono, nivel o etiqueta.')
      }
      const tiers = await listTiers({ tenantId: ctx.tenantId })
      let tierId: string | null = null
      if (input.nivel) {
        const tier = pickByName(tiers, input.nivel, (t) => t.name, 'un nivel')
        if (!tier.ok) return fail(tier.message)
        tierId = tier.value.id
      }
      let tagId: string | null = null
      if (input.etiqueta) {
        const tag = pickByName(
          await listTags({ tenantId: ctx.tenantId }),
          input.etiqueta,
          (t) => t.name,
          'una etiqueta',
        )
        if (!tag.ok) return fail(tag.message)
        tagId = tag.value.id
      }
      const query = input.buscar ? parseCustomerQuery(input.buscar) : undefined
      if (input.buscar && query?.names.length === 0 && !query.phone) {
        return fail('Preguntale el nombre o más números del teléfono.')
      }
      const { rows, total } = await findCustomers(ctx.tenantId, {
        query,
        tierId,
        tagId,
        limit: LIST_MAX + 1,
      })
      const names = tierNames(tiers)
      return {
        kind: 'data',
        data: {
          cuantos: total,
          ...capped(
            rows.map((row) => customerRow(row, names)),
            LIST_MAX,
          ),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_cliente',
    description:
      'La ficha de un cliente: sus puntos canjeables y de categoría, su nivel y cuánto le falta para el próximo, qué le vence, visitas, cuánto gastó, última visita, etiquetas, canjes, movimientos de puntos y tarjetas de sellos. El teléfono completo, las notas y los avisos no salen de la pantalla: para verlos, llevalo a su ficha.',
    input: z.object({ cliente: clienteField }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando la ficha del cliente',
    done: () => 'Miré la ficha del cliente',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const { id } = found.value
      const [customer, tiers, ledger, redemptions, stats, cards, windowMonths] = await Promise.all([
        customerById(ctx, id),
        listTiers({ tenantId: ctx.tenantId }),
        listCustomerLedger({ tenantId: ctx.tenantId, customerId: id, limit: LEDGER_READ }),
        listCustomerRedemptions({ tenantId: ctx.tenantId, customerId: id }),
        getCustomerInsights(ctx.tenantId, id),
        listCustomerPunchCards(ctx.slug, id),
        categoryWindowMonths(ctx.tenantId),
      ])
      if (!customer) return fail('Ese cliente ya no está.')
      return {
        kind: 'data',
        data: customerCardData({
          customer,
          tiers,
          ledger,
          redemptions,
          stats,
          cards,
          windowMonths,
          now: new Date(),
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_mejores_clientes',
    description:
      'Los mejores clientes: los que más gastaron, los que más vinieron o los que más puntos tienen, de siempre o de un período. Usala para «quién es el que más viene», «los mejores clientes del mes».',
    input: z.object({
      por: z
        .enum(['gasto', 'visitas', 'puntos'])
        .optional()
        .describe('Por qué ordenar. Si no lo dijo, por lo que gastó.'),
      cuantos: z
        .number()
        .int()
        .min(1)
        .max(LIST_MAX)
        .optional()
        .describe(`Cuántos. Si no lo dijo, ${TOP_DEFAULT}.`),
      mes: monthField('Solo ese mes, yyyy-MM. Sin período, de siempre.').optional(),
      desde: dayField('Desde, yyyy-MM-dd.').optional(),
      hasta: dayField('Hasta, yyyy-MM-dd.').optional(),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando los mejores clientes',
    done: () => 'Miré los mejores clientes',
    run: async (input, ctx) => {
      const by = input.por ?? 'gasto'
      const limit = input.cuantos ?? TOP_DEFAULT
      if (input.mes || input.desde || input.hasta) {
        if (by === 'puntos') {
          return fail('Los puntos son el saldo de hoy: no se miran por período.')
        }
        const period = texPeriod(input, ctx.today)
        if (!period.ok) return fail(period.message)
        const { rows, truncated } = await visitsInPeriod(ctx.tenantId, {
          from: period.from,
          to: period.to,
        })
        const ranking = rankVisits(rows, by)
        const top = ranking.slice(0, limit)
        const people = new Map(
          (
            await customersByIds(
              ctx.tenantId,
              top.map((row) => row.customerId),
            )
          ).map((person) => [person.id, person]),
        )
        return {
          kind: 'data',
          data: compact({
            periodo: period.label,
            clientes_con_visitas: ranking.length,
            nota: truncated ? 'Son demasiadas visitas: pedí un período más corto.' : null,
            filas: top.flatMap((row) => {
              const person = people.get(row.customerId)
              if (!person) return []
              return [
                {
                  cliente_id: row.customerId,
                  nombre: customerName(person),
                  gastado: money(row.cents),
                  visitas: row.visits,
                },
              ]
            }),
            hay_mas: ranking.length > limit,
          }),
        }
      }
      if (by === 'gasto') {
        const rows = await getTopCustomersBySpent(ctx.tenantId, limit + 1)
        const spent = rows.filter((row) => Number(row.total_spent_cents) > 0)
        return { kind: 'data', data: capped(spent.map(topCustomerRow), limit) }
      }
      const rows = await topCustomersBy(
        ctx.tenantId,
        by === 'visitas' ? 'total_visits' : 'points_balance',
        limit + 1,
      )
      return {
        kind: 'data',
        data: capped(
          rows.map((row) =>
            compact({
              cliente_id: row.id,
              nombre: customerName(row),
              visitas: row.total_visits,
              puntos: row.points_balance,
              gastado: money(row.total_spent_cents),
              ultima_visita: dayOf(row.last_visit_at),
            }),
          ),
          limit,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_cumpleanos',
    description:
      'Quién cumple años en un período, en orden, con su id. Para hoy o un solo día, mandá desde y hasta iguales. Sin período, el mes en curso. Usala para «quién cumple hoy», «los cumples de esta semana».',
    input: z.object(periodFields),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando los cumpleaños',
    done: () => 'Miré los cumpleaños',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return fail(period.message)
      const [{ rows, truncated, withoutBirthdate }, tiers] = await Promise.all([
        customersWithBirthdate(ctx.tenantId),
        listTiers({ tenantId: ctx.tenantId }),
      ])
      const found = birthdayRows(
        rows,
        { from: period.from, to: period.to },
        ctx.today,
        tierNames(tiers),
      )
      return {
        kind: 'data',
        data: compact({
          periodo: period.label,
          cuantos: found.length,
          clientes_sin_cumple_cargado: withoutBirthdate,
          nota: truncated
            ? 'Hay más clientes de los que pude leer: la lista puede estar corta.'
            : null,
          ...capped(found, LIST_MAX),
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_clientes_nuevos',
    description:
      'Cuántos clientes nuevos se sumaron en un período, de dónde vinieron (reservas o walk-in), cuántos ya consumieron, contra el período anterior y los últimos que entraron. Sin período, el mes en curso.',
    input: z.object(periodFields),
    need: { roles: OWNER_ONLY },
    doing: () => 'Contando los clientes nuevos',
    done: () => 'Conté los clientes nuevos',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return fail(period.message)
      const previous = period.month
        ? monthRange(addMonthsToYearMonth(period.month, -1))
        : {
            from: addDays(period.from, -(daysBetween(period.from, period.to) + 1)),
            to: addDays(period.from, -1),
          }
      const report = await newCustomers(
        ctx.tenantId,
        { from: period.from, to: period.to },
        previous,
      )
      return {
        kind: 'data',
        data: {
          periodo: period.label,
          nuevos: report.total,
          por_origen: compact({
            reservas: report.reservations,
            walk_in: report.walkin,
            importados: report.imported || null,
          }),
          ya_consumieron: report.alreadyCame,
          periodo_anterior: report.previous,
          ...capped(report.rows.map(newCustomerRow), 20),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_total_clientes',
    description:
      'Cuántos clientes tiene el bar: en total, cuántos con puntos (ya consumieron) y cuántos solo contacto, de dónde vinieron y cuántos aceptan promos. Son los mismos números de la lista de Personas.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Contando los clientes',
    done: () => 'Conté los clientes',
    run: async (_input, ctx) => {
      const tenantId = ctx.tenantId
      const [all, reservations, walkin, promos] = await Promise.all([
        listCustomerProgramaCounts({ tenantId }),
        listCustomerProgramaCounts({ tenantId, segment: 'reserva' }),
        listCustomerProgramaCounts({ tenantId, segment: 'walkin' }),
        countAcceptingPromos(tenantId),
      ])
      return {
        kind: 'data',
        data: {
          total: all.all,
          con_puntos: all.with_points,
          solo_contacto: all.contact_only,
          reservas: reservations.all,
          walk_in: walkin.all,
          aceptan_promos: promos,
        },
      }
    },
  }),

  defineTool({
    name: 'ver_clientes_que_dejaron_de_venir',
    description:
      'Los buenos clientes que dejaron de venir: venían seguido y ya pasó el doble de lo que tardaban en volver. Ordenados por lo que gastaron. Es la misma lista de Estadísticas.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando quién dejó de venir',
    done: () => 'Miré quién dejó de venir',
    run: async (_input, ctx) => {
      const rows = await getChurnRisk(ctx.tenantId)
      return {
        kind: 'data',
        data: {
          cuantos: rows.length,
          ...capped(
            rows.map((row) =>
              compact({
                cliente_id: row.customer_id,
                nombre: customerName(row),
                visitas: row.total_visits,
                venia_cada_dias: Math.round(Number(row.visit_frequency_days)),
                dias_sin_venir: row.days_since_last_visit,
                ultima_visita: dayOf(row.last_visit_at),
                gastado: money(row.total_spent_cents),
              }),
            ),
            LIST_MAX,
          ),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_etiquetas_clientes',
    description:
      'Las etiquetas de clientes del bar y cuántos clientes tiene cada una. Para ver quiénes son, buscar_cliente con la etiqueta.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las etiquetas',
    done: () => 'Miré las etiquetas',
    run: async (_input, ctx) => {
      const tags = await tagsWithCounts(ctx.tenantId)
      return {
        kind: 'data',
        data: capped(
          tags.map((tag) => ({ id: tag.id, nombre: tag.name, clientes: tag.count })),
          LIST_MAX * 2,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_club',
    description:
      'El club de un vistazo: los niveles con sus socios y beneficios, cuánto duran los puntos de categoría, las reglas de puntos con su id, pagar con puntos, el regalo de bienvenida y cuántas recompensas, aliados y punch cards hay. Usala para «cuántos socios hay en cada nivel», «qué beneficios tiene cada nivel», «cómo se ganan los puntos».',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando el club',
    done: () => 'Miré el club',
    run: async (_input, ctx) => {
      const tenantId = ctx.tenantId
      const [tiers, benefits, rules, rewards, partners, punch, redemption, welcome, windowMonths] =
        await Promise.all([
          listTiers({ tenantId }),
          listTierBenefits({ tenantId }),
          listRules({ tenantId }),
          listRewards({ tenantId }),
          listPartners({ tenantId }),
          listPunchCardTemplates(tenantId),
          getPointsRedemptionConfig(tenantId),
          getWelcomeRewardConfig(tenantId),
          categoryWindowMonths(tenantId),
        ])
      const members = await tierMembers(
        tenantId,
        tiers.map((tier) => tier.id),
      )
      const menu = rules.some((rule) => rule.type === 'per_item') ? await menuNames(tenantId) : null
      return {
        kind: 'data',
        data: compact({
          niveles: clubTierRows(
            tiers,
            benefits,
            members.byTier,
            new Map(rewards.map((reward) => [reward.id, reward.name])),
            new Map(partners.map((partner) => [partner.id, partner.name])),
          ),
          sin_nivel: members.withoutTier,
          puntos_de_categoria_duran_meses: windowMonths,
          reglas: rules.map((rule) => ruleRow(rule, menu)),
          tasa: earnRateWords(rules),
          pagar_con_puntos: redemption.enabled
            ? {
                activo: true,
                un_punto_vale: money(redemption.ratePointsToCents),
                tope: `${redemption.maxPct} %`,
              }
            : { activo: false },
          bienvenida: compact({
            activa: welcome.enabled,
            regalo: welcome.reward?.name ?? null,
            puntos_de_regalo: welcome.bonus_points || null,
          }),
          recompensas: {
            activas: rewards.filter((reward) => reward.active).length,
            total: rewards.length,
          },
          aliados: {
            activos: partners.filter((partner) => partner.active).length,
            total: partners.length,
          },
          punch_cards: {
            activas: punch.filter((card) => card.active).length,
            total: punch.length,
          },
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_recompensas',
    description:
      'El catálogo de recompensas del club: cuántos puntos cuesta cada una, su stock, desde qué nivel y si está pausada, con su id.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las recompensas',
    done: () => 'Miré las recompensas',
    run: async (_input, ctx) => {
      const [rewards, tiers] = await Promise.all([
        listRewards({ tenantId: ctx.tenantId }),
        listTiers({ tenantId: ctx.tenantId }),
      ])
      const names = tierNames(tiers)
      return {
        kind: 'data',
        data: cappedBySize(
          rewards.map((reward) => rewardRow(reward, names)),
          LIST_MAX * 2,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_aliados',
    description:
      'Las marcas aliadas del club con sus beneficios, a qué niveles llega cada uno y qué niveles no reciben nada, con sus ids.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando los aliados',
    done: () => 'Miré los aliados',
    run: async (_input, ctx) => {
      const [partners, benefits, tiers] = await Promise.all([
        listPartners({ tenantId: ctx.tenantId }),
        listPartnerBenefits({ tenantId: ctx.tenantId }),
        listTiers({ tenantId: ctx.tenantId }),
      ])
      return {
        kind: 'data',
        data: cappedBySize(
          partners.map((partner) => partnerRow(partner, benefits, tiers)),
          LIST_MAX,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_punch_cards',
    description:
      'Las punch cards o tarjetas de sellos: cuántos sellos pide cada una, qué premio da, cómo se sella, para qué niveles, cuántas van en curso y cuántas se completaron, con su id.',
    input: noInput,
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las punch cards',
    done: () => 'Miré las punch cards',
    run: async (_input, ctx) => {
      const [templates, tiers, progress] = await Promise.all([
        listPunchCardTemplates(ctx.tenantId),
        listTiers({ tenantId: ctx.tenantId }),
        punchCardProgress(ctx.tenantId),
      ])
      const names = tierNames(tiers)
      const stats = punchCardStats(progress.rows)
      return {
        kind: 'data',
        data: cappedBySize(
          templates.map((template) => punchCardRow(template, names, stats.get(template.id))),
          LIST_MAX,
        ),
      }
    },
  }),
]
