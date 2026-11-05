import 'server-only'

import { z } from 'zod'
import { listMenu } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import {
  createPartner,
  createPartnerBenefit,
  createPerAmountRule,
  createPerItemRule,
  createReward,
  createTier,
  createTierBenefit,
  toggleRule,
  updatePartner,
  updatePartnerBenefit,
  updatePointsRedemptionConfigAction,
  updateReward,
  updateTier,
  updateTierBenefit,
} from '@/lib/points/actions'
import {
  getPointsRedemptionConfig,
  listActiveRewards,
  listPartnerBenefits,
  listPartners,
  listRewards,
  listRules,
  listTierBenefits,
  listTiers,
} from '@/lib/points/queries'
import {
  createPartnerBenefitSchema,
  createPartnerSchema,
  createRewardSchema,
  createRuleSchema,
  createTierBenefitSchema,
  createTierSchema,
  updatePartnerBenefitSchema,
  updatePartnerSchema,
  updatePointsRedemptionConfigSchema,
  updateRewardSchema,
  updateTierBenefitSchema,
  updateTierSchema,
} from '@/lib/points/schemas'
import { sortedActiveTiers } from '@/lib/points/tiers'
import type { PointsRule } from '@/lib/points/types'
import { createPunchCard, togglePunchCard, updatePunchCard } from '@/lib/punch-cards/actions'
import { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import { createPunchCardSchema, updatePunchCardSchema } from '@/lib/punch-cards/schemas'
import { formatRequiredTiers } from '@/lib/punch-cards/tier-gate'
import { simpleExecutor } from '../../simple-action'
import {
  defineTool,
  money,
  pesosField,
  pesosToCents,
  type TexExecutor,
  zodIssuesText,
} from '../types'
import {
  BENEFIT_WORDS,
  CADENCE_WORDS,
  type PartnerBenefitChange,
  type PartnerChange,
  type PunchCardChange,
  partnerBenefitValues,
  partnerUrl,
  partnerValues,
  punchCardForm,
  punchCardValues,
  type RewardChange,
  rewardCreateForm,
  rewardUpdateValues,
  ruleWords,
  type TierBenefitChange,
  type TierChange,
  tierBenefitValues,
  tierValues,
} from './_club-values'
import {
  CHANGE_NOTHING,
  fail,
  failure,
  guarded,
  place,
  prepared,
  rowsOf,
  settled,
  warn,
  yesNo,
} from './_tickets'
import { OWNER_ONLY, pickByName, pointsWord } from './_values'
import { tierMembers } from './queries'

/**
 * Lo que Tex puede preparar del Club: reglas, niveles, beneficios, recompensas, aliados, punch cards y
 * pagar con puntos. Nada de esto escribe: arma un tique, y al confirmarlo corre la misma server action
 * del formulario. Lo que se edita viaja como lo que cambia y el resto se lee al confirmar.
 */

const rulePayload = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('por_monto'),
    every_cents: z.number().int().min(1),
    points: z.number().int().min(1),
    priority: z.number().int(),
    /** Las reglas que deja de usar esta. */
    replaces: z.array(z.uuid()),
  }),
  z.object({
    accion: z.literal('por_producto'),
    mode: z.enum(['item', 'category']),
    target_id: z.uuid(),
    points: z.number().int().min(1),
    priority: z.number().int(),
    replaces: z.array(z.uuid()),
  }),
  z.object({ accion: z.literal('estado'), rule_id: z.uuid(), active: z.boolean() }),
])

const tierPayload = z.object({
  id: z.uuid().nullable(),
  next_sort: z.number().int(),
  change: z.object({
    name: z.string().optional(),
    min_category_points: z.number().int().optional(),
    color: z.string().nullable().optional(),
    perks: z.string().nullable().optional(),
    active: z.boolean().optional(),
  }),
})

const tierBenefitPayload = z.object({
  id: z.uuid().nullable(),
  tier_id: z.uuid(),
  next_sort: z.number().int(),
  change: z.object({
    kind: z.enum(['recurring_reward', 'discount', 'perk', 'partner']).optional(),
    label: z.string().optional(),
    description: z.string().nullable().optional(),
    reward_id: z.uuid().nullable().optional(),
    cadence: z.enum(['none', 'birthday', 'monthly']).optional(),
    quantity: z.number().int().optional(),
    discount_pct: z.number().nullable().optional(),
    discount_scope: z.string().nullable().optional(),
    partner_id: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  }),
})

const rewardChangeSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  cost_points: z.number().int().optional(),
  stock: z.number().int().nullable().optional(),
  category: z.string().nullable().optional(),
  visible_in_catalog: z.boolean().optional(),
  min_tier_id: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
})

const rewardPayload = z.object({ id: z.uuid().nullable(), change: rewardChangeSchema })

const partnerPayload = z.object({
  id: z.uuid().nullable(),
  change: z.object({
    name: z.string().optional(),
    category: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    active: z.boolean().optional(),
  }),
})

const partnerBenefitPayload = z.object({
  id: z.uuid().nullable(),
  partner_id: z.uuid(),
  change: z.object({
    label: z.string().optional(),
    description: z.string().nullable().optional(),
    discount_pct: z.number().nullable().optional(),
    active: z.boolean().optional(),
    tier_ids: z.array(z.uuid()).optional(),
  }),
})

const punchChangeSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  threshold: z.number().int().optional(),
  reward_id: z.uuid().optional(),
  reward_label: z.string().nullable().optional(),
  tier_ids: z.array(z.uuid()).optional(),
  max_per_day: z.number().int().nullable().optional(),
})

const punchPayload = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('estado'), id: z.uuid(), active: z.boolean() }),
  z.object({ accion: z.literal('alta'), change: punchChangeSchema }),
  z.object({ accion: z.literal('edicion'), id: z.uuid(), change: punchChangeSchema }),
])

// ─── Lo que comparten las herramientas ───────────────────────────────────────

/** Los niveles que dijo la persona, por nombre o id. «Todos» son los activos. */
function tierIdsOf(
  wanted: readonly string[],
  tiers: Awaited<ReturnType<typeof listTiers>>,
): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (wanted.length === 1 && /^tod[oa]s$/i.test(wanted[0]?.trim() ?? '')) {
    return { ok: true, ids: sortedActiveTiers(tiers).map((tier) => tier.id) }
  }
  const ids: string[] = []
  for (const name of wanted) {
    const tier = pickByName(tiers, name, (t) => t.name, 'un nivel')
    if (!tier.ok) return { ok: false, message: tier.message }
    if (!ids.includes(tier.value.id)) ids.push(tier.value.id)
  }
  return { ok: true, ids }
}

function tierNamesText(ids: readonly string[], tiers: Awaited<ReturnType<typeof listTiers>>) {
  const names = ids.map((id) => tiers.find((tier) => tier.id === id)?.name ?? '').filter(Boolean)
  return formatRequiredTiers(names)
}

// ─── Las herramientas ────────────────────────────────────────────────────────

export const clubActionTools = [
  defineTool({
    name: 'preparar_regla_puntos',
    description:
      'Prepara cambiar cómo se ganan los puntos: la tasa por monto («1 punto cada $ 1.000»), puntos por un ítem o una categoría de la carta, o pausar o activar una regla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      regla: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          'Para pausar o activar: su id, de ver_club, o cómo se lee («5 puntos por cada Fernet»).',
        ),
      activa: z.boolean().optional().describe('Con regla: false la pausa, true la activa.'),
      puntos: z
        .number()
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe('Los puntos que da la regla nueva.'),
      cada: pesosField('Por monto: cada cuántos pesos de consumo.').optional(),
      item: z.string().trim().min(1).max(120).optional().describe('Por ítem: nombre o id.'),
      categoria: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Por categoría: nombre o id. Cuenta solo los ítems que están directo en ella.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando la regla',
    done: () => 'Preparé la regla',
    run: async (input, ctx) => {
      const rules = await listRules({ tenantId: ctx.tenantId })
      const menuNames = async () => {
        const menu = await listMenu({ tenantId: ctx.tenantId })
        return {
          menu,
          names: {
            item: (id: string) => menu.items.find((item) => item.id === id)?.name ?? null,
            category: (id: string) => categoryPathLabel(menu.categories, id) || null,
          },
        }
      }

      if (input.regla) {
        if (input.activa === undefined) return fail('Decime si la pausás o la activás.')
        const names = rules.some((r) => r.type === 'per_item') ? (await menuNames()).names : null
        const picked = pickByName(rules, input.regla, (r) => ruleWords(r, names), 'la regla')
        if (!picked.ok) return fail(picked.message)
        const rule = picked.value
        if (rule.active === input.activa) {
          return fail(`Esa regla ya está ${rule.active ? 'activa' : 'pausada'}.`)
        }
        const words = ruleWords(rule, names)
        const otherAmount = rules.some(
          (r) => r.id !== rule.id && r.active && r.type === 'per_amount',
        )
        return prepared(
          'club.regla',
          { accion: 'estado', rule_id: rule.id, active: input.activa },
          {
            kind: 'regla_puntos',
            title: input.activa ? 'Activar regla de puntos' : 'Pausar regla de puntos',
            subtitle: words,
            rows: [],
            warnings:
              input.activa && rule.type === 'per_amount' && otherAmount
                ? [
                    warn(
                      'two_amount_rules',
                      'Quedan dos reglas por monto activas: en Cerrar mesa se suman las dos y en Acreditar cuenta solo la de más prioridad.',
                    ),
                  ]
                : [warn('from_now', 'Rige de acá en más: lo ya acreditado no cambia.')],
            confirmLabel: input.activa ? 'Activar la regla' : 'Pausar la regla',
          },
        )
      }

      if (input.puntos === undefined) {
        return fail('Decime cuántos puntos da la regla, o qué regla querés pausar o activar.')
      }

      if (input.cada !== undefined) {
        const everyCents = pesosToCents(input.cada)
        const same = rules.filter((r) => r.active && r.type === 'per_amount')
        const priority = same[0]?.priority ?? 100
        const valid = createRuleSchema.safeParse({
          type: 'per_amount',
          config: { every_cents: everyCents, points: input.puntos },
          priority,
          active: true,
        })
        if (!valid.success) return fail(zodIssuesText(valid.error))
        const draft: PointsRule = {
          id: '',
          type: 'per_amount',
          config: { every_cents: everyCents, points: input.puntos },
          priority,
          active: true,
        }
        const words = ruleWords(draft, null)
        const unchanged = same.find((r) => ruleWords(r, null) === words)
        if (unchanged && same.length === 1) return fail(`La regla ya es ${words}.`)
        return prepared(
          'club.regla',
          {
            accion: 'por_monto',
            every_cents: everyCents,
            points: input.puntos,
            priority,
            replaces: same.map((r) => r.id),
          },
          {
            kind: 'regla_puntos',
            title: same.length > 0 ? 'Cambiar la regla de puntos' : 'Nueva regla de puntos',
            subtitle: words,
            rows: same.map((r) => ({ label: 'Queda pausada', value: ruleWords(r, null) })),
            warnings: [warn('from_now', 'Rige de acá en más: lo ya acreditado no cambia.')],
            confirmLabel: 'Guardar la regla',
          },
        )
      }

      if (!input.item === !input.categoria) {
        return fail('Para una regla nueva decime cada cuántos pesos, o de qué ítem o categoría.')
      }
      const { menu, names } = await menuNames()
      let mode: 'item' | 'category'
      let targetId: string
      if (input.item) {
        const picked = pickByName(menu.items, input.item, (i) => i.name, 'en la carta el ítem')
        if (!picked.ok) return fail(picked.message)
        mode = 'item'
        targetId = picked.value.id
      } else {
        // El motor no hereda a subcategorías: una categoría sin ítems directos nunca sumaría.
        const usable = menu.categories.filter((category) =>
          menu.items.some((item) => item.category_id === category.id),
        )
        const picked = pickByName(
          usable,
          input.categoria ?? '',
          (c) => c.name,
          'con ítems la categoría',
        )
        if (!picked.ok) return fail(picked.message)
        mode = 'category'
        targetId = picked.value.id
      }
      const config =
        mode === 'item'
          ? { item_id: targetId, points: input.puntos }
          : { category_id: targetId, points: input.puntos }
      const valid = createRuleSchema.safeParse({
        type: 'per_item',
        config,
        priority: 0,
        active: true,
      })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      const same = rules.filter((r) => {
        if (!r.active || r.type !== 'per_item') return false
        const c = r.config as Record<string, unknown>
        return mode === 'item' ? c.item_id === targetId : c.category_id === targetId
      })
      const words = ruleWords(
        { id: '', type: 'per_item', config, priority: 0, active: true },
        names,
      )
      return prepared(
        'club.regla',
        {
          accion: 'por_producto',
          mode,
          target_id: targetId,
          points: input.puntos,
          priority: 0,
          replaces: same.map((r) => r.id),
        },
        {
          kind: 'regla_puntos',
          title: 'Regla de puntos por producto',
          subtitle: words,
          rows: same.map((r) => ({ label: 'Queda pausada', value: ruleWords(r, names) })),
          warnings: [
            warn(
              'from_now',
              'Rige de acá en más, y solo al registrar visitas con su consumo: Acreditar suma por monto.',
            ),
          ],
          confirmLabel: 'Guardar la regla',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_nivel',
    description:
      'Prepara crear o editar un nivel del club: nombre, desde cuántos puntos de categoría, detalle, color, o pausarlo. Los beneficios van con preparar_beneficio_nivel. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      nivel: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es uno nuevo.'),
      nombre: z.string().trim().min(1).max(40).optional().describe('En uno nuevo, obligatorio.'),
      desde_puntos: z
        .number()
        .int()
        .min(0)
        .max(100_000_000)
        .optional()
        .describe('Puntos de categoría para llegar. En uno nuevo, obligatorio.'),
      detalle: z.string().trim().max(300).optional().describe('Texto corto. Vacío: se lo saca.'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('Hexadecimal: #RRGGBB.'),
      activo: z.boolean().optional().describe('false: lo pausa. true: lo activa.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el nivel',
    done: () => 'Preparé el nivel',
    run: async (input, ctx) => {
      const tiers = await listTiers({ tenantId: ctx.tenantId })
      const picked = input.nivel ? pickByName(tiers, input.nivel, (t) => t.name, 'un nivel') : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null
      if (!current) {
        if (!input.nombre) return fail('Preguntale cómo se llama el nivel.')
        if (input.desde_puntos === undefined) {
          return fail('Preguntale desde cuántos puntos de categoría se llega.')
        }
      }
      const change: TierChange = {}
      if (input.nombre !== undefined && input.nombre !== current?.name) change.name = input.nombre
      if (input.desde_puntos !== undefined && input.desde_puntos !== current?.min_category_points) {
        change.min_category_points = input.desde_puntos
      }
      if (input.color !== undefined && input.color !== current?.color) change.color = input.color
      if (input.detalle !== undefined) change.perks = input.detalle || null
      if (input.activo !== undefined && input.activo !== current?.active) {
        change.active = input.activo
      }
      if (current && Object.keys(change).length === 0) return fail(CHANGE_NOTHING)
      const nextSort = Math.max(0, ...tiers.map((tier) => tier.sort)) + 1
      const values = tierValues(current, change, nextSort)
      const valid = (current ? updateTierSchema : createTierSchema).safeParse(values)
      if (!valid.success) return fail(zodIssuesText(valid.error))
      const threshold = values.min_category_points as number
      const twin = tiers.find((t) => t.id !== current?.id && t.min_category_points === threshold)
      if (twin) return fail(`«${twin.name}» ya arranca en ${pointsWord(threshold)}.`)

      const moves = change.min_category_points !== undefined || change.active !== undefined
      const members = current && moves ? await tierMembers(ctx.tenantId, [current.id]) : null
      return prepared(
        'club.nivel',
        { id: current?.id ?? null, next_sort: nextSort, change },
        {
          kind: 'nivel',
          title: current ? 'Editar nivel' : 'Nuevo nivel',
          subtitle: current?.name ?? input.nombre ?? null,
          rows: rowsOf([
            ['Nombre', current ? change.name : null],
            [
              'Desde',
              change.min_category_points !== undefined
                ? `${pointsWord(change.min_category_points)} de categoría`
                : null,
            ],
            ['Detalle', change.perks === null ? 'Sin detalle' : change.perks],
            ['Color', change.color],
            ['Estado', change.active === undefined ? null : change.active ? 'Activo' : 'Pausado'],
            ['Socios hoy', members ? String(members.byTier.get(current?.id ?? '') ?? 0) : null],
          ]),
          warnings:
            moves || !current
              ? [
                  warn(
                    'recompute',
                    'Los socios cambian de nivel con su próximo movimiento de puntos o con el recálculo de cada madrugada: no es al instante.',
                  ),
                ]
              : [],
          confirmLabel: current ? 'Guardar el nivel' : 'Crear el nivel',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_beneficio_nivel',
    description:
      'Prepara sumar, cambiar o pausar un beneficio de un nivel del club: un ítem gratis por mes o por cumpleaños, un descuento, un beneficio o una marca aliada. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      nivel: z.string().trim().min(1).max(60).describe('El nivel: nombre o id.'),
      beneficio: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es uno nuevo.'),
      tipo: z
        .enum(['item_gratis', 'descuento', 'beneficio', 'aliado'])
        .optional()
        .describe('En uno nuevo, obligatorio.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('En uno nuevo, obligatorio.'),
      detalle: z.string().trim().max(200).optional(),
      recompensa: z.string().trim().min(1).max(80).optional().describe('Para item_gratis.'),
      cuando: z.enum(['mensual', 'cumpleanos']).optional().describe('Para item_gratis.'),
      cantidad: z.number().int().min(1).max(20).optional().describe('Para item_gratis.'),
      porcentaje: z.number().min(0).max(100).optional().describe('Para descuento.'),
      en: z.string().trim().max(60).optional().describe('Para descuento: en qué aplica.'),
      aliado: z.string().trim().min(1).max(80).optional().describe('Para aliado: la marca.'),
      activo: z.boolean().optional().describe('false: lo pausa. true: lo activa.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el beneficio',
    done: () => 'Preparé el beneficio',
    run: async (input, ctx) => {
      const tenantId = ctx.tenantId
      const [tiers, benefits, rewards, partners] = await Promise.all([
        listTiers({ tenantId }),
        listTierBenefits({ tenantId }),
        listActiveRewards({ tenantId }),
        listPartners({ tenantId }),
      ])
      const tier = pickByName(tiers, input.nivel, (t) => t.name, 'un nivel')
      if (!tier.ok) return fail(tier.message)
      const own = benefits.filter((benefit) => benefit.tier_id === tier.value.id)
      const picked = input.beneficio
        ? pickByName(own, input.beneficio, (b) => b.label, 'en ese nivel el beneficio')
        : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null
      if (!current && !input.tipo) return fail('Preguntale qué tipo de beneficio es.')
      if (!current && !input.nombre) return fail('Preguntale cómo se llama el beneficio.')

      const change: TierBenefitChange = {}
      if (input.tipo) change.kind = BENEFIT_WORDS[input.tipo]
      if (input.nombre) change.label = input.nombre
      if (input.detalle !== undefined) change.description = input.detalle || null
      if (input.cuando) change.cadence = CADENCE_WORDS[input.cuando]
      if (input.cantidad !== undefined) change.quantity = input.cantidad
      if (input.porcentaje !== undefined) change.discount_pct = input.porcentaje
      if (input.en !== undefined) change.discount_scope = input.en || null
      if (input.activo !== undefined) change.active = input.activo
      let rewardName: string | null = null
      if (input.recompensa) {
        const reward = pickByName(rewards, input.recompensa, (r) => r.name, 'la recompensa activa')
        if (!reward.ok) return fail(reward.message)
        change.reward_id = reward.value.id
        rewardName = reward.value.name
      }
      let partnerName: string | null = null
      if (input.aliado) {
        const partner = pickByName(partners, input.aliado, (p) => p.name, 'la marca')
        if (!partner.ok) return fail(partner.message)
        change.partner_id = partner.value.id
        partnerName = partner.value.name
      }
      if (current && Object.keys(change).length === 0) return fail(CHANGE_NOTHING)

      const nextSort = Math.max(0, ...own.map((benefit) => benefit.sort)) + 1
      const values = tierBenefitValues(tier.value.id, current, change, nextSort)
      const valid = (current ? updateTierBenefitSchema : createTierBenefitSchema).safeParse(values)
      if (!valid.success) return fail(valid.error.issues[0]?.message ?? 'Faltan datos.')

      const recurring = values.kind === 'recurring_reward'
      return prepared(
        'club.beneficio_nivel',
        { id: current?.id ?? null, tier_id: tier.value.id, next_sort: nextSort, change },
        {
          kind: 'beneficio_nivel',
          title: current ? 'Editar beneficio' : 'Nuevo beneficio',
          subtitle: `${tier.value.name} · ${(values.label as string) || ''}`,
          rows: rowsOf([
            ['Regalo', rewardName],
            [
              'Cuándo',
              recurring && (!current || input.cuando)
                ? values.cadence === 'birthday'
                  ? 'Una vez por año, en su cumpleaños'
                  : 'Una vez por mes'
                : null,
            ],
            ['Cantidad', input.cantidad !== undefined ? String(input.cantidad) : null],
            ['Descuento', input.porcentaje !== undefined ? `${input.porcentaje} %` : null],
            ['En', input.en],
            ['Marca', partnerName],
            ['Detalle', input.detalle],
            ['Estado', input.activo === undefined ? null : input.activo ? 'Activo' : 'Pausado'],
          ]),
          warnings:
            recurring && (!current || change.reward_id || change.active)
              ? [
                  warn(
                    'recurring',
                    'A cada socio de este nivel le queda para retirar, solo, una vez por período: sale con la tanda de cada madrugada.',
                  ),
                ]
              : [],
          confirmLabel: current ? 'Guardar el beneficio' : 'Agregar el beneficio',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_recompensa',
    description:
      'Prepara crear o editar una recompensa del catálogo de canje: nombre, cuántos puntos cuesta, stock, desde qué nivel, si se ve en el catálogo, o pausarla. La foto se carga en su pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      recompensa: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es una nueva.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('En una nueva, obligatorio.'),
      detalle: z.string().trim().max(300).optional().describe('Vacío: se lo saca.'),
      puntos: z.number().int().min(1).optional().describe('En una nueva, obligatorio.'),
      stock: z.number().int().min(0).nullable().optional().describe('null: sin límite.'),
      categoria: z.string().trim().max(40).optional().describe('Vacío: sin categoría.'),
      visible: z.boolean().optional().describe('false: no se ve en el catálogo.'),
      desde_nivel: z
        .string()
        .trim()
        .max(60)
        .nullable()
        .optional()
        .describe('Solo desde este nivel: nombre o id. null: para todos.'),
      activa: z.boolean().optional().describe('false: la pausa. true: la activa.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando la recompensa',
    done: () => 'Preparé la recompensa',
    run: async (input, ctx) => {
      const [rewards, tiers] = await Promise.all([
        listRewards({ tenantId: ctx.tenantId }),
        listTiers({ tenantId: ctx.tenantId }),
      ])
      const picked = input.recompensa
        ? pickByName(rewards, input.recompensa, (r) => r.name, 'la recompensa')
        : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null
      const change: RewardChange = {}
      if (input.nombre !== undefined) change.name = input.nombre
      if (input.detalle !== undefined) change.description = input.detalle || null
      if (input.puntos !== undefined) change.cost_points = input.puntos
      if (input.stock !== undefined) change.stock = input.stock
      if (input.categoria !== undefined) change.category = input.categoria || null
      if (input.visible !== undefined) change.visible_in_catalog = input.visible
      if (input.activa !== undefined) change.active = input.activa
      let tierName: string | null = null
      if (input.desde_nivel) {
        const tier = pickByName(tiers, input.desde_nivel, (t) => t.name, 'un nivel')
        if (!tier.ok) return fail(tier.message)
        change.min_tier_id = tier.value.id
        tierName = tier.value.name
      } else if (input.desde_nivel === null) {
        change.min_tier_id = null
        tierName = 'Para todos'
      }
      if (current) {
        if (Object.keys(change).length === 0) return fail(CHANGE_NOTHING)
        const valid = updateRewardSchema.safeParse(rewardUpdateValues(current, change))
        if (!valid.success) return fail(zodIssuesText(valid.error))
      } else {
        if (!input.nombre) return fail('Preguntale cómo se llama la recompensa.')
        if (input.puntos === undefined) return fail('Preguntale cuántos puntos cuesta.')
        if (input.activa === false) {
          return fail('Una recompensa nueva arranca activa: se pausa después de crearla.')
        }
        const valid = createRewardSchema.safeParse({
          name: change.name,
          description: change.description,
          cost_points: change.cost_points,
          stock: change.stock,
          category: change.category,
          visible_in_catalog: change.visible_in_catalog ?? true,
          min_tier_id: change.min_tier_id,
          image_url: null,
        })
        if (!valid.success) return fail(zodIssuesText(valid.error))
      }
      return prepared(
        'club.recompensa',
        { id: current?.id ?? null, change },
        {
          kind: 'recompensa',
          title: current ? 'Editar recompensa' : 'Nueva recompensa',
          subtitle: current?.name ?? input.nombre ?? null,
          rows: rowsOf([
            ['Nombre', current ? change.name : null],
            ['Cuesta', change.cost_points !== undefined ? pointsWord(change.cost_points) : null],
            [
              'Stock',
              change.stock === undefined
                ? null
                : change.stock === null
                  ? 'Sin límite'
                  : String(change.stock),
            ],
            ['Nivel', tierName],
            ['Categoría', change.category],
            ['En el catálogo', yesNo(change.visible_in_catalog)],
            ['Detalle', change.description],
            ['Estado', change.active === undefined ? null : change.active ? 'Activa' : 'Pausada'],
          ]),
          confirmLabel: current ? 'Guardar la recompensa' : 'Crear la recompensa',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_aliado',
    description:
      'Prepara sumar o editar una marca aliada del club: nombre, rubro, web, o activarla para que se vea en la billetera. El logo se carga en su pantalla. Lo que da cada marca va con preparar_beneficio_aliado. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      aliado: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es una marca nueva.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('En una nueva, obligatorio.'),
      rubro: z.string().trim().max(40).optional().describe('Vacío: sin rubro.'),
      web: z.string().trim().max(500).optional().describe('Vacío: sin web.'),
      activo: z
        .boolean()
        .optional()
        .describe('true: se ve en la billetera. false: queda en borrador. Por defecto, borrador.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el aliado',
    done: () => 'Preparé el aliado',
    run: async (input, ctx) => {
      const partners = await listPartners({ tenantId: ctx.tenantId })
      const picked = input.aliado
        ? pickByName(partners, input.aliado, (p) => p.name, 'la marca')
        : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null
      if (!current && !input.nombre) return fail('Preguntale cómo se llama la marca.')
      const change: PartnerChange = {}
      if (input.nombre !== undefined && input.nombre !== current?.name) change.name = input.nombre
      if (input.rubro !== undefined) change.category = input.rubro || null
      if (input.web !== undefined) {
        const url = partnerUrl(input.web)
        if (input.web.trim() && !url) return fail('Esa web no se puede abrir: revisala.')
        change.url = url
      }
      if (input.activo !== undefined && input.activo !== current?.active) {
        change.active = input.activo
      }
      if (current && Object.keys(change).length === 0) return fail(CHANGE_NOTHING)
      const valid = (current ? updatePartnerSchema : createPartnerSchema).safeParse(
        partnerValues(current, change),
      )
      if (!valid.success) return fail(zodIssuesText(valid.error))
      const draft = !(change.active ?? current?.active ?? false)
      return prepared(
        'club.aliado',
        { id: current?.id ?? null, change },
        {
          kind: 'aliado',
          title: current ? 'Editar marca aliada' : 'Nueva marca aliada',
          subtitle: current?.name ?? input.nombre ?? null,
          rows: rowsOf([
            ['Nombre', current ? change.name : null],
            ['Rubro', change.category],
            ['Web', change.url],
            [
              'Estado',
              change.active === undefined
                ? current
                  ? null
                  : 'En borrador'
                : change.active
                  ? 'Se ve en la billetera'
                  : 'En borrador',
            ],
          ]),
          warnings: draft
            ? [warn('draft', 'En borrador no se ve en la billetera de los socios.')]
            : [],
          confirmLabel: current ? 'Guardar la marca' : 'Agregar la marca',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_beneficio_aliado',
    description:
      'Prepara sumar, cambiar o pausar lo que da una marca aliada y a qué niveles llega («10 % para tal nivel»). El socio ve solo el de su nivel. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      aliado: z.string().trim().min(1).max(80).describe('La marca: nombre o id.'),
      beneficio: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es uno nuevo.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('Lo que da: «10 % off».'),
      detalle: z.string().trim().max(200).optional().describe('Vacío: se lo saca.'),
      descuento: z
        .number()
        .min(0)
        .max(100)
        .nullable()
        .optional()
        .describe('El %. null: se lo saca.'),
      niveles: z
        .array(z.string().trim().min(1).max(60))
        .max(50)
        .optional()
        .describe('A qué niveles llega: nombres o ids, o ["todos"]. Reemplaza los que tenía.'),
      activo: z.boolean().optional().describe('false: lo pausa. true: lo activa.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el beneficio del aliado',
    done: () => 'Preparé el beneficio del aliado',
    run: async (input, ctx) => {
      const tenantId = ctx.tenantId
      const [partners, benefits, tiers] = await Promise.all([
        listPartners({ tenantId }),
        listPartnerBenefits({ tenantId }),
        listTiers({ tenantId }),
      ])
      const partner = pickByName(partners, input.aliado, (p) => p.name, 'la marca')
      if (!partner.ok) return fail(partner.message)
      const own = benefits.filter((benefit) => benefit.partner_id === partner.value.id)
      const picked = input.beneficio
        ? pickByName(own, input.beneficio, (b) => b.label, 'en esa marca el beneficio')
        : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null
      if (!current && !input.nombre) return fail('Preguntale qué da la marca.')

      const change: PartnerBenefitChange = {}
      if (input.nombre !== undefined) change.label = input.nombre
      if (input.detalle !== undefined) change.description = input.detalle || null
      if (input.descuento !== undefined) change.discount_pct = input.descuento
      if (input.activo !== undefined) change.active = input.activo
      if (input.niveles) {
        const chosen = tierIdsOf(input.niveles, tiers)
        if (!chosen.ok) return fail(chosen.message)
        change.tier_ids = chosen.ids
      }
      if (current && Object.keys(change).length === 0) return fail(CHANGE_NOTHING)
      const values = partnerBenefitValues(partner.value.id, current, change)
      const valid = (current ? updatePartnerBenefitSchema : createPartnerBenefitSchema).safeParse(
        values,
      )
      if (!valid.success) return fail(valid.error.issues[0]?.message ?? 'Faltan datos.')
      const tierIds = values.tier_ids as string[]
      return prepared(
        'club.beneficio_aliado',
        { id: current?.id ?? null, partner_id: partner.value.id, change },
        {
          kind: 'beneficio_aliado',
          title: current ? 'Editar beneficio de la marca' : 'Nuevo beneficio de la marca',
          subtitle: `${partner.value.name} · ${(values.label as string) || ''}`,
          rows: rowsOf([
            ['Descuento', input.descuento != null ? `${input.descuento} %` : null],
            ['Detalle', change.description],
            [
              'Llega a',
              change.tier_ids ? tierNamesText(change.tier_ids, tiers) || 'Ningún nivel' : null,
            ],
            ['Estado', change.active === undefined ? null : change.active ? 'Activo' : 'Pausado'],
          ]),
          warnings: [
            ...(tierIds.length === 0
              ? [warn('no_tiers', 'Sin niveles no lo ve nadie: queda cargado y escondido.')]
              : []),
            ...(partner.value.active
              ? []
              : [warn('draft', 'La marca está en borrador: no se ve hasta que la actives.')]),
          ],
          confirmLabel: current ? 'Guardar el beneficio' : 'Agregar el beneficio',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_punch_card',
    description:
      'Prepara crear, editar o pausar una punch card (tarjeta de sellos): cuántos sellos pide, qué recompensa da, para qué niveles, tope por día. Las nuevas se sellan a mano desde Acreditar; las que se sellan solas, con horario, foto o ícono se arman en su pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarjeta: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Cuál editar: nombre o id. Sin esto, es una nueva.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('En una nueva, obligatorio.'),
      sellos: z
        .number()
        .int()
        .min(2)
        .max(100)
        .optional()
        .describe(
          'Sellos para completarla: «6 cafés y el 7mo gratis» son 6. En una nueva, obligatorio.',
        ),
      recompensa: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Qué se gana: nombre o id de la recompensa. En una nueva, obligatorio.'),
      premio: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe('Cómo lo lee el socio: «un café gratis».'),
      detalle: z.string().trim().max(400).optional(),
      niveles: z
        .array(z.string().trim().min(1).max(60))
        .max(20)
        .optional()
        .describe('Solo estos niveles: nombres o ids. [] o ["todos"]: para todos.'),
      tope_por_dia: z
        .number()
        .int()
        .min(1)
        .max(20)
        .nullable()
        .optional()
        .describe('null: sin tope.'),
      activa: z.boolean().optional().describe('false: la pausa. true: la activa.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando la punch card',
    done: () => 'Preparé la punch card',
    run: async (input, ctx) => {
      const tenantId = ctx.tenantId
      const [templates, rewards, tiers] = await Promise.all([
        listPunchCardTemplates(tenantId),
        listRewards({ tenantId }),
        listTiers({ tenantId }),
      ])
      const picked = input.tarjeta
        ? pickByName(templates, input.tarjeta, (t) => t.name, 'la tarjeta')
        : null
      if (picked && !picked.ok) return fail(picked.message)
      const current = picked?.ok ? picked.value : null

      const change: PunchCardChange = {}
      if (input.nombre !== undefined) change.name = input.nombre
      if (input.sellos !== undefined) change.threshold = input.sellos
      if (input.premio !== undefined) change.reward_label = input.premio || null
      if (input.detalle !== undefined) change.description = input.detalle || null
      if (input.tope_por_dia !== undefined) change.max_per_day = input.tope_por_dia
      let rewardName: string | null = null
      if (input.recompensa) {
        const reward = pickByName(rewards, input.recompensa, (r) => r.name, 'la recompensa')
        if (!reward.ok) return fail(reward.message)
        change.reward_id = reward.value.id
        rewardName = reward.value.name
      }
      if (input.niveles) {
        if (input.niveles.length === 0 || /^tod[oa]s$/i.test(input.niveles[0] ?? '')) {
          change.tier_ids = []
        } else {
          const chosen = tierIdsOf(input.niveles, tiers)
          if (!chosen.ok) return fail(chosen.message)
          change.tier_ids = chosen.ids
        }
      }

      const nothingElse = Object.keys(change).length === 0
      if (current && input.activa !== undefined && nothingElse) {
        if (current.active === input.activa) {
          return fail(`«${current.name}» ya está ${current.active ? 'activa' : 'pausada'}.`)
        }
        return prepared(
          'club.punch_card',
          { accion: 'estado', id: current.id, active: input.activa },
          {
            kind: 'punch_card',
            title: input.activa ? 'Activar punch card' : 'Pausar punch card',
            subtitle: current.name,
            rows: [],
            warnings: input.activa
              ? []
              : [
                  warn(
                    'paused',
                    'Deja de aceptar sellos. Lo que cada socio ya juntó no se pierde.',
                  ),
                ],
            confirmLabel: input.activa ? 'Activar la tarjeta' : 'Pausar la tarjeta',
          },
        )
      }
      if (current && nothingElse) return fail(CHANGE_NOTHING)
      if (current && input.activa !== undefined) {
        return fail('Para pausarla o activarla, mandá solo eso: los otros cambios en otro tique.')
      }
      if (!current) {
        if (!input.nombre) return fail('Preguntale cómo se llama la tarjeta.')
        if (input.sellos === undefined) return fail('Preguntale cuántos sellos pide.')
        if (!input.recompensa) return fail('Preguntale qué recompensa da al completarla.')
        if (input.activa === false) {
          return fail('Una tarjeta nueva arranca activa: se pausa después de crearla.')
        }
      }
      const values = punchCardValues(current, change)
      const valid = (current ? updatePunchCardSchema : createPunchCardSchema).safeParse(values)
      if (!valid.success) return fail(valid.error.issues[0]?.message ?? 'Faltan datos.')
      return prepared(
        'club.punch_card',
        current ? { accion: 'edicion', id: current.id, change } : { accion: 'alta', change },
        {
          kind: 'punch_card',
          title: current ? 'Editar punch card' : 'Nueva punch card',
          subtitle: current?.name ?? input.nombre ?? null,
          rows: rowsOf([
            ['Nombre', current ? change.name : null],
            ['Sellos', change.threshold !== undefined ? String(change.threshold) : null],
            ['Da', rewardName],
            ['El socio lee', change.reward_label],
            [
              'Niveles',
              change.tier_ids ? tierNamesText(change.tier_ids, tiers) || 'Para todos' : null,
            ],
            [
              'Tope por día',
              change.max_per_day === undefined
                ? null
                : change.max_per_day === null
                  ? 'Sin tope'
                  : String(change.max_per_day),
            ],
            ['Se sella', current ? null : 'A mano, desde Acreditar'],
          ]),
          warnings:
            current && change.threshold !== undefined
              ? [
                  warn(
                    'snapshot',
                    'Las tarjetas ya empezadas siguen con los sellos que tenían pedidos.',
                  ),
                ]
              : [],
          confirmLabel: current ? 'Guardar la tarjeta' : 'Crear la tarjeta',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_pago_con_puntos',
    description:
      'Prepara cambiar «Pagar con puntos»: si los clientes pueden usar su saldo como descuento al cobrar la mesa, cuánto vale un punto en pesos y hasta qué porcentaje pueden cubrir. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      activo: z.boolean().optional().describe('true: lo prende. false: lo apaga.'),
      pesos_por_punto: pesosField('Cuánto vale un punto, en pesos.').optional(),
      tope: z.number().min(0).max(100).optional().describe('El % máximo de su parte de la cuenta.'),
    }),
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando pagar con puntos',
    done: () => 'Preparé pagar con puntos',
    run: async (input, ctx) => {
      const current = await getPointsRedemptionConfig(ctx.tenantId)
      const values = {
        enabled: input.activo ?? current.enabled,
        ratePointsToCents:
          input.pesos_por_punto !== undefined
            ? pesosToCents(input.pesos_por_punto)
            : current.ratePointsToCents,
        maxPct: input.tope ?? current.maxPct,
      }
      const valid = updatePointsRedemptionConfigSchema.safeParse(values)
      if (!valid.success) return fail(valid.error.issues[0]?.message ?? 'Revisá los datos.')
      if (
        values.enabled === current.enabled &&
        values.ratePointsToCents === current.ratePointsToCents &&
        values.maxPct === current.maxPct
      ) {
        return fail(CHANGE_NOTHING)
      }
      return prepared('club.pago_con_puntos', valid.data, {
        kind: 'pago_con_puntos',
        title: 'Pagar con puntos',
        subtitle: values.enabled ? 'Prendido' : 'Apagado',
        rows: rowsOf([
          ['Un punto vale', money(values.ratePointsToCents)],
          ['Hasta', `${values.maxPct} % de su parte de la cuenta`],
        ]),
        warnings: [warn('tables', 'Se usa al cobrar una mesa desde el salón.')],
        confirmLabel: 'Guardar',
      })
    },
  }),
]

// ─── Los ejecutores ──────────────────────────────────────────────────────────

export const clubExecutors: Readonly<Record<string, TexExecutor>> = {
  'club.regla': simpleExecutor(
    rulePayload,
    guarded(async (payload, ctx) => {
      if (payload.accion === 'estado') {
        const state = await toggleRule(ctx.slug, payload.rule_id, payload.active)
        return settled(state, null, payload.active ? 'Regla activada.' : 'Regla pausada.')
      }
      let created: Awaited<ReturnType<typeof createPerItemRule>>
      if (payload.accion === 'por_monto') {
        const form = new FormData()
        form.set('every_cents', String(payload.every_cents))
        form.set('points', String(payload.points))
        form.set('priority', String(payload.priority))
        form.set('active', 'true')
        created = await createPerAmountRule(ctx.slug, { ok: true }, form)
      } else {
        created = await createPerItemRule(ctx.slug, {
          mode: payload.mode,
          targetId: payload.target_id,
          points: payload.points,
          priority: payload.priority,
        })
      }
      if (!created.ok) return settled(created, null, '')
      // Primero la nueva: si pausar la vieja falla quedan dos activas, que se ve y se arregla; al
      // revés, el bar se quedaría sin sumar puntos.
      for (const id of payload.replaces) {
        const paused = await toggleRule(ctx.slug, id, false)
        if (!paused.ok) {
          return failure(
            `Se creó la regla nueva, pero no se pudo pausar la anterior: pausala en Club › Puntos y niveles. ${paused.message}`,
          )
        }
      }
      return { ok: true, data: null, message: 'Regla guardada.' }
    }),
    (_data, _payload, ctx) => place(ctx, 'club.puntos', {}, 'Cómo ganan puntos'),
  ),

  'club.nivel': simpleExecutor(
    tierPayload,
    guarded(async (payload, ctx) => {
      if (!payload.id) {
        const values = tierValues(null, payload.change as TierChange, payload.next_sort)
        return settled(await createTier(ctx.slug, values), null, 'Nivel creado.')
      }
      const tiers = await listTiers({ tenantId: ctx.tenantId })
      const current = tiers.find((tier) => tier.id === payload.id)
      if (!current) return failure('Ese nivel ya no está.')
      const values = tierValues(current, payload.change as TierChange, payload.next_sort)
      return settled(await updateTier(ctx.slug, values), null, 'Nivel guardado.')
    }),
    (_data, payload, ctx) => place(ctx, 'club.niveles', {}, payload.change.name ?? null),
  ),

  'club.beneficio_nivel': simpleExecutor(
    tierBenefitPayload,
    guarded(async (payload, ctx) => {
      const change = payload.change as TierBenefitChange
      if (!payload.id) {
        const values = tierBenefitValues(payload.tier_id, null, change, payload.next_sort)
        return settled(await createTierBenefit(ctx.slug, values), null, 'Beneficio agregado.')
      }
      const benefits = await listTierBenefits({ tenantId: ctx.tenantId })
      const current = benefits.find((benefit) => benefit.id === payload.id)
      if (!current) return failure('Ese beneficio ya no está.')
      const values = tierBenefitValues(payload.tier_id, current, change, payload.next_sort)
      return settled(await updateTierBenefit(ctx.slug, values), null, 'Beneficio guardado.')
    }),
    (_data, _payload, ctx) => place(ctx, 'club.niveles'),
  ),

  'club.recompensa': simpleExecutor(
    rewardPayload,
    guarded(async (payload, ctx) => {
      const change = payload.change as RewardChange
      if (!payload.id) {
        const state = await createReward(ctx.slug, { ok: true }, rewardCreateForm(change))
        return settled(state, null, 'Recompensa creada.')
      }
      const rewards = await listRewards({ tenantId: ctx.tenantId })
      const current = rewards.find((reward) => reward.id === payload.id)
      if (!current) return failure('Esa recompensa ya no está.')
      const state = await updateReward(ctx.slug, rewardUpdateValues(current, change))
      return settled(state, null, 'Recompensa guardada.')
    }),
    (_data, payload, ctx) => place(ctx, 'club.puntos', {}, payload.change.name ?? null),
  ),

  'club.aliado': simpleExecutor(
    partnerPayload,
    guarded(async (payload, ctx) => {
      const change = payload.change as PartnerChange
      if (!payload.id) {
        return settled(
          await createPartner(ctx.slug, partnerValues(null, change)),
          null,
          'Marca agregada.',
        )
      }
      const partners = await listPartners({ tenantId: ctx.tenantId })
      const current = partners.find((partner) => partner.id === payload.id)
      if (!current) return failure('Esa marca ya no está.')
      const state = await updatePartner(ctx.slug, partnerValues(current, change))
      return settled(state, null, 'Marca guardada.')
    }),
    (_data, payload, ctx) => place(ctx, 'club.aliados', {}, payload.change.name ?? null),
  ),

  'club.beneficio_aliado': simpleExecutor(
    partnerBenefitPayload,
    guarded(async (payload, ctx) => {
      const change = payload.change as PartnerBenefitChange
      if (!payload.id) {
        const values = partnerBenefitValues(payload.partner_id, null, change)
        return settled(await createPartnerBenefit(ctx.slug, values), null, 'Beneficio agregado.')
      }
      const benefits = await listPartnerBenefits({ tenantId: ctx.tenantId })
      const current = benefits.find((benefit) => benefit.id === payload.id)
      if (!current) return failure('Ese beneficio ya no está.')
      const values = partnerBenefitValues(payload.partner_id, current, change)
      return settled(await updatePartnerBenefit(ctx.slug, values), null, 'Beneficio guardado.')
    }),
    (_data, _payload, ctx) => place(ctx, 'club.aliados'),
  ),

  'club.punch_card': simpleExecutor(
    punchPayload,
    guarded(async (payload, ctx) => {
      if (payload.accion === 'estado') {
        const state = await togglePunchCard(ctx.slug, payload.id, payload.active)
        return settled(state, null, payload.active ? 'Tarjeta activada.' : 'Tarjeta pausada.')
      }
      const change = payload.change as PunchCardChange
      if (payload.accion === 'alta') {
        const form = punchCardForm(punchCardValues(null, change))
        const state = await createPunchCard(ctx.slug, { ok: true }, form)
        return settled(state, null, 'Tarjeta creada.')
      }
      const templates = await listPunchCardTemplates(ctx.tenantId)
      const current = templates.find((template) => template.id === payload.id)
      if (!current) return failure('Esa tarjeta ya no está.')
      const form = punchCardForm(punchCardValues(current, change))
      const state = await updatePunchCard(ctx.slug, { ok: true }, form)
      return settled(state, null, 'Tarjeta guardada.')
    }),
    (_data, _payload, ctx) => place(ctx, 'club.punch_cards'),
  ),

  'club.pago_con_puntos': simpleExecutor(
    updatePointsRedemptionConfigSchema,
    guarded(async (payload, ctx) => {
      const state = await updatePointsRedemptionConfigAction(ctx.slug, payload)
      return settled(state, null, 'Guardado.')
    }),
    (_data, _payload, ctx) => place(ctx, 'club.puntos', {}, 'Pagar con puntos'),
  ),
}
