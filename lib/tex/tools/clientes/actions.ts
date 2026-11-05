import 'server-only'

import { z } from 'zod'
import {
  assignTag,
  createAndAssignTag,
  createCustomer,
  removeTag,
  updateCustomer,
} from '@/lib/customers/actions'
import { listTags } from '@/lib/customers/queries'
import {
  createAndAssignTagSchema,
  createCustomerSchema,
  tagAssignmentSchema,
  updateCustomerSchema,
} from '@/lib/customers/schemas'
import { listActiveMenu, type MenuItem } from '@/lib/menu/queries'
import { tryNormalizePhone } from '@/lib/phone'
import { awardPointsByAmount } from '@/lib/points/actions'
import { calculatePoints, validateRedeem } from '@/lib/points/engine'
import { listCustomerLedger, listRewards, listRules, listTiers } from '@/lib/points/queries'
import { canRedeemReward } from '@/lib/points/tiers'
import { addStampAction, removeStampAction } from '@/lib/punch-cards/actions'
import { listCustomerPunchCards, listPunchCardTemplates } from '@/lib/punch-cards/queries'
import { stampSchema } from '@/lib/punch-cards/schemas'
import { formatRequiredTiers } from '@/lib/punch-cards/tier-gate'
import { SERVICE_ALERT_META, SERVICE_ALERTS, type ServiceAlert } from '@/lib/salon/alerts'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { closeTable, redeemReward } from '@/lib/visits/actions'
import { simpleExecutor } from '../../simple-action'
import {
  dayText,
  defineTool,
  money,
  pesosField,
  pesosToCents,
  type TexExecutor,
  type TexToolContext,
  zodIssuesText,
} from '../types'
import { activeAmountRule, awardPoints, isRecentAward, ruleWords } from './_club-values'
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
import {
  ALERT_WORD_KEYS,
  ALERT_WORDS,
  type CustomerChange,
  customerCreateForm,
  customerEditForm,
  customerEditValues,
  customerName,
  isRealBirthdate,
  isUuid,
  maskEmail,
  nameKey,
  OWNER_OR_CASHIER,
  phoneTail,
  pickByName,
  pointsWord,
} from './_values'
import { customerByContact, customerById, resolveCustomer } from './queries'
import { clienteField } from './read'

/**
 * Lo que Tex puede preparar de un cliente: su ficha, etiquetas, puntos, canjes, visitas y sellos. Nada de
 * esto escribe: arma un tique, y al confirmarlo corre la misma server action del formulario, que vuelve a
 * decidir permisos y datos.
 *
 * Lo que se edita viaja como lo que cambia, no como la fila entera: las acciones pisan todos los campos
 * y entre el tique y el toque pueden pasar horas, así que lo demás se lee recién al confirmar.
 */

const ISSUE_LABELS: Readonly<Record<string, string>> = {
  phone: 'Teléfono',
  first_name: 'Nombre',
  last_name: 'Apellido',
  email: 'Mail',
  birthdate: 'Nacimiento',
  notes: 'Notas',
}

/** Lo que no pasó el esquema de la ficha. Solo el motivo: nunca el dato. */
function customerIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${ISSUE_LABELS[String(issue.path[0])] ?? 'Dato'}: ${issue.message}`)
    .join('; ')
}

const NOTES_MAX = 500

/**
 * El teléfono como lo manda el formulario: en E.164. El esquema deja pasar tal cual lo que arranca con
 * `+` (el campo del formulario ya lo manda limpio), y lo que dicta una persona trae espacios y guiones:
 * se guardaría así y no matchearía con nadie. Lo que no se pueda normalizar lo rechaza el esquema.
 */
function phoneForForm(raw: string): string {
  return tryNormalizePhone(raw) ?? raw
}

const alertWords = (words: readonly (keyof typeof ALERT_WORDS)[] | undefined): ServiceAlert[] =>
  (words ?? []).map((word) => ALERT_WORDS[word])

const CONSENT_WARNING = warn(
  'consent',
  'Marcalo solo si el cliente te lo confirmó. Queda registrado con fecha, hora e IP.',
)

// ─── Lo que recibe cada ejecutor ─────────────────────────────────────────────

const alertListSchema = z.array(z.enum(SERVICE_ALERTS))

const customerExtrasSchema = z.object({
  is_blocked: z.boolean().optional(),
  add_note: z.string().optional(),
  add_alerts: alertListSchema.optional(),
})

const customerCreatePayload = z.object({
  phone: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().nullable(),
  birthdate: z.string().nullable(),
  opt_in_marketing: z.boolean(),
  /** Lo que el formulario de alta no tiene: se guarda después, como en la ficha. */
  extras: customerExtrasSchema.nullable(),
})

const customerChangeSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().nullable().optional(),
  birthdate: z.string().nullable().optional(),
  opt_in_marketing: z.boolean().optional(),
  is_blocked: z.boolean().optional(),
  add_note: z.string().optional(),
  add_alerts: alertListSchema.optional(),
  remove_alerts: alertListSchema.optional(),
})

const customerEditPayload = z.object({ id: z.uuid(), change: customerChangeSchema })

const tagPayload = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('poner'),
    customer_id: z.uuid(),
    tag_id: z.uuid(),
    name: z.string(),
  }),
  z.object({
    accion: z.literal('sacar'),
    customer_id: z.uuid(),
    tag_id: z.uuid(),
    name: z.string(),
  }),
  z.object({ accion: z.literal('crear'), customer_id: z.uuid(), name: z.string() }),
])

/** `awardSchema` de `lib/points/actions.ts`: un archivo `'use server'` no puede exportarlo. */
const awardPayload = z.object({
  customer_id: z.uuid(),
  amount_cents: z.number().int().min(1).max(1_000_000_000_000),
})

/** `redeemSchema` de `lib/visits/actions.ts`. */
const redeemPayload = z.object({ customer_id: z.uuid(), reward_id: z.uuid() })

/** `closeTableSchema` de `lib/visits/actions.ts`. */
const visitPayload = z.object({
  customer_id: z.uuid(),
  items: z.array(z.object({ item_id: z.uuid(), quantity: z.number().int().min(1).max(99) })).min(1),
  notes: z.string().max(300).nullable(),
})

const stampPayload = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('sumar'), customer_id: z.uuid(), template_id: z.uuid() }),
  z.object({ accion: z.literal('sacar'), customer_id: z.uuid(), card_id: z.uuid() }),
])

// ─── Las herramientas ────────────────────────────────────────────────────────

export const clientesActionTools = [
  defineTool({
    name: 'preparar_cliente',
    description:
      'Prepara el alta o la edición de un cliente: nombre, teléfono, mail, nacimiento, si acepta promos, si no hay que contactarlo, una nota o sus avisos (celíaco, alergia…). No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField
        .optional()
        .describe(
          'A quién editar: nombre, últimos números del teléfono o id. Sin esto, es un alta.',
        ),
      nombre: z.string().trim().min(1).max(60).optional().describe('En un alta, obligatorio.'),
      apellido: z.string().trim().min(1).max(60).optional().describe('En un alta, obligatorio.'),
      telefono: z
        .string()
        .trim()
        .min(6)
        .max(30)
        .optional()
        .describe('Con característica. En un alta, obligatorio.'),
      mail: z.string().trim().max(120).optional().describe('Texto vacío: se lo saca.'),
      nacimiento: z
        .string()
        .trim()
        .max(10)
        .optional()
        .describe('yyyy-MM-dd. Si no sabés el año, preguntale. Texto vacío: se lo saca.'),
      acepta_promos: z
        .boolean()
        .optional()
        .describe('true solo si te dijeron que el cliente aceptó. Nunca lo asumas.'),
      no_contactar: z.boolean().optional().describe('true: no le llega ningún mensaje.'),
      nota: z.string().trim().min(1).max(NOTES_MAX).optional().describe('Se suma a sus notas.'),
      sumar_avisos: z.array(z.enum(ALERT_WORD_KEYS)).max(5).optional(),
      sacar_avisos: z.array(z.enum(ALERT_WORD_KEYS)).max(5).optional(),
    }),
    need: { roles: OWNER_OR_CASHIER },
    mood: 'working',
    doing: () => 'Preparando el cliente',
    done: () => 'Preparé el cliente',
    run: async (input, ctx) => {
      const birthdate = input.nacimiento === undefined ? undefined : input.nacimiento || null
      if (birthdate && !isRealBirthdate(birthdate, ctx.today)) {
        return fail('Esa fecha de nacimiento no existe o todavía no pasó. Preguntale de nuevo.')
      }
      const email = input.mail === undefined ? undefined : input.mail || null
      const addAlerts = alertWords(input.sumar_avisos)
      const removeAlerts = alertWords(input.sacar_avisos)
      const alertLabel = (alert: ServiceAlert) => SERVICE_ALERT_META[alert].label

      if (!input.cliente) {
        if (!input.nombre || !input.apellido) return fail('Preguntale el nombre y el apellido.')
        if (!input.telefono) return fail('Preguntale el teléfono: sin eso no se puede dar de alta.')
        const parsed = createCustomerSchema.safeParse({
          phone: phoneForForm(input.telefono),
          first_name: input.nombre,
          last_name: input.apellido,
          email: email ?? null,
          birthdate: birthdate ?? null,
          opt_in_marketing: input.acepta_promos === true,
        })
        if (!parsed.success) return fail(customerIssues(parsed.error))
        const values = parsed.data
        const existing = await customerByContact(ctx.tenantId, {
          phone: values.phone,
          email: values.email,
        })
        if (existing) {
          return fail(
            `Ya hay un cliente con ese ${existing.matchedBy}: ${customerName(existing)} ${phoneTail(existing.phone) ?? ''} (id ${existing.id}). Preguntale si es esa persona: para cambiarle algo, mandá cliente.`,
          )
        }
        const extras =
          input.nota || addAlerts.length > 0 || input.no_contactar
            ? {
                is_blocked: input.no_contactar,
                add_note: input.nota,
                add_alerts: addAlerts.length > 0 ? addAlerts : undefined,
              }
            : null
        return prepared(
          'clientes.alta',
          { ...values, email: values.email ?? null, birthdate: values.birthdate ?? null, extras },
          {
            kind: 'cliente',
            title: 'Nuevo cliente',
            subtitle: `${values.first_name} ${values.last_name}`,
            rows: rowsOf([
              ['Teléfono', phoneTail(values.phone)],
              ['Mail', maskEmail(values.email)],
              ['Nacimiento', dayText(values.birthdate)],
              ['Acepta promos', values.opt_in_marketing ? 'Sí' : 'No'],
              ['No contactar', input.no_contactar ? 'Sí' : null],
              ['Avisos', addAlerts.map(alertLabel).join(', ')],
              ['Nota', input.nota],
            ]),
            warnings: values.opt_in_marketing ? [CONSENT_WARNING] : [],
            confirmLabel: 'Crear el cliente',
          },
        )
      }

      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const current = await customerById(ctx, found.value.id)
      if (!current) return fail('Ese cliente ya no está.')

      const currentAlerts: readonly unknown[] = Array.isArray(current.service_alerts)
        ? current.service_alerts
        : []
      const change: CustomerChange = {}
      if (input.nombre && input.nombre !== current.first_name) change.first_name = input.nombre
      if (input.apellido && input.apellido !== current.last_name) change.last_name = input.apellido
      if (email !== undefined && email !== current.email) change.email = email
      if (birthdate !== undefined && birthdate !== current.birthdate) change.birthdate = birthdate
      if (input.acepta_promos !== undefined && input.acepta_promos !== current.opt_in_marketing) {
        change.opt_in_marketing = input.acepta_promos
      }
      if (input.no_contactar !== undefined && input.no_contactar !== current.is_blocked) {
        change.is_blocked = input.no_contactar
      }
      if (input.nota) change.add_note = input.nota
      const toAdd = addAlerts.filter((alert) => !currentAlerts.includes(alert))
      const toRemove = removeAlerts.filter((alert) => currentAlerts.includes(alert))
      if (toAdd.length > 0) change.add_alerts = toAdd
      if (toRemove.length > 0) change.remove_alerts = toRemove

      const parsed = updateCustomerSchema.safeParse(
        customerEditValues(current, {
          ...change,
          ...(input.telefono ? { phone: phoneForForm(input.telefono) } : {}),
        }),
      )
      if (!parsed.success) {
        if (parsed.error.issues.some((issue) => issue.path[0] === 'notes')) {
          return fail(`Las notas no pueden pasar de ${NOTES_MAX} letras: se recortan en su ficha.`)
        }
        return fail(customerIssues(parsed.error))
      }
      if (input.telefono && parsed.data.phone !== current.phone) {
        change.phone = parsed.data.phone
      }
      if (change.email) change.email = parsed.data.email ?? null

      const other = await customerByContact(ctx.tenantId, {
        phone: change.phone,
        email: change.email,
      })
      if (other && other.id !== current.id) {
        return fail(
          `Ya hay otro cliente con ese ${other.matchedBy}: ${customerName(other)} ${phoneTail(other.phone) ?? ''} (id ${other.id}).`,
        )
      }

      const rows = rowsOf([
        ['Nombre', change.first_name],
        ['Apellido', change.last_name],
        [
          'Teléfono',
          change.phone ? `${phoneTail(change.phone)} (antes ${phoneTail(current.phone)})` : null,
        ],
        ['Mail', change.email === undefined ? null : (maskEmail(change.email) ?? 'Sin mail')],
        [
          'Nacimiento',
          change.birthdate === undefined ? null : (dayText(change.birthdate) ?? 'Sin fecha'),
        ],
        ['Acepta promos', yesNo(change.opt_in_marketing)],
        ['No contactar', yesNo(change.is_blocked)],
        ['Suma el aviso', toAdd.map(alertLabel).join(', ')],
        ['Saca el aviso', toRemove.map(alertLabel).join(', ')],
        ['Nota nueva', change.add_note],
      ])
      if (rows.length === 0) return fail(CHANGE_NOTHING)

      return prepared(
        'clientes.edicion',
        { id: current.id, change },
        {
          kind: 'cliente',
          title: 'Editar cliente',
          subtitle: customerName(current),
          rows,
          warnings: [
            ...(change.opt_in_marketing ? [CONSENT_WARNING] : []),
            ...(change.is_blocked
              ? [
                  warn(
                    'blocked',
                    'No le va a llegar ningún mensaje: ni difusiones, ni automáticos.',
                  ),
                ]
              : []),
          ],
          confirmLabel: 'Guardar los cambios',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_etiqueta_cliente',
    description:
      'Prepara ponerle o sacarle una etiqueta a un cliente («VIP», «cumpleañero»). Si la etiqueta no existe, la crea. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField,
      etiqueta: z.string().trim().min(1).max(40).describe('La etiqueta: su nombre o su id.'),
      accion: z.enum(['poner', 'sacar']).describe('Por defecto, poner.').optional(),
      crear: z
        .boolean()
        .optional()
        .describe('true: crearla aunque se parezca a otra que ya existe.'),
    }),
    need: { roles: OWNER_OR_CASHIER },
    mood: 'working',
    doing: () => 'Preparando la etiqueta',
    done: () => 'Preparé la etiqueta',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const customer = await customerById(ctx, found.value.id)
      if (!customer) return fail('Ese cliente ya no está.')
      const name = customerName(customer)
      const has = customer.tags

      if (input.accion === 'sacar') {
        const tag = pickByName(has, input.etiqueta, (t) => t.name, 'esa etiqueta entre las suyas:')
        if (!tag.ok) {
          return fail(
            has.length > 0 ? tag.message : `${name} no tiene ninguna etiqueta para sacarle.`,
          )
        }
        const valid = tagAssignmentSchema.safeParse({
          customer_id: customer.id,
          tag_id: tag.value.id,
        })
        if (!valid.success) return fail(zodIssuesText(valid.error))
        return prepared(
          'clientes.etiqueta',
          { accion: 'sacar', ...valid.data, name: tag.value.name },
          {
            kind: 'etiqueta_cliente',
            title: 'Sacar etiqueta',
            subtitle: name,
            rows: rowsOf([['Etiqueta', tag.value.name]]),
            confirmLabel: `Sacar «${tag.value.name}»`,
          },
        )
      }

      const tags = await listTags({ tenantId: ctx.tenantId })
      const wanted = input.etiqueta.trim()
      const key = nameKey(wanted)
      const same = tags.filter((tag) => tag.id === wanted || nameKey(tag.name) === key)
      const [exact] = same
      if (exact && same.length === 1) {
        if (has.some((tag) => tag.id === exact.id)) {
          return fail(`${name} ya tiene la etiqueta «${exact.name}».`)
        }
        const valid = tagAssignmentSchema.safeParse({ customer_id: customer.id, tag_id: exact.id })
        if (!valid.success) return fail(zodIssuesText(valid.error))
        return prepared(
          'clientes.etiqueta',
          { accion: 'poner', ...valid.data, name: exact.name },
          {
            kind: 'etiqueta_cliente',
            title: 'Poner etiqueta',
            subtitle: name,
            rows: rowsOf([['Etiqueta', exact.name]]),
            confirmLabel: `Poner «${exact.name}»`,
          },
        )
      }
      if (same.length > 1) {
        return fail(`Preguntale cuál: ${same.map((tag) => `«${tag.name}»`).join(', ')}.`)
      }
      if (isUuid(wanted)) return fail('Esa etiqueta ya no existe.')
      if (!input.crear) {
        const near = tags.filter((tag) => {
          const other = nameKey(tag.name)
          return other.includes(key) || key.includes(other)
        })
        if (near.length > 0) {
          const names = near.slice(0, 8).map((tag) => `«${tag.name}»`)
          return fail(
            `Hay etiquetas parecidas: ${names.join(', ')}. Preguntale si es alguna de esas, o mandá crear: true para hacer «${wanted}» aparte.`,
          )
        }
      }
      const valid = createAndAssignTagSchema.safeParse({ customer_id: customer.id, name: wanted })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      return prepared(
        'clientes.etiqueta',
        { accion: 'crear', customer_id: customer.id, name: valid.data.name },
        {
          kind: 'etiqueta_cliente',
          title: 'Poner etiqueta nueva',
          subtitle: name,
          rows: rowsOf([['Etiqueta', valid.data.name]]),
          warnings: [warn('new_tag', 'Es nueva: queda disponible para todos los clientes.')],
          confirmLabel: `Crear y poner «${valid.data.name}»`,
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_puntos',
    description:
      'Prepara acreditarle puntos a un cliente por lo que consumió, en pesos, igual que Acreditar en la caja: calcula los puntos con la regla por monto y suma una visita. Es lo único que suma puntos a mano: no se cargan ni se restan puntos sueltos. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField,
      monto: pesosField('Lo que consumió, en pesos.'),
    }),
    need: { roles: REDEMPTION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando los puntos',
    done: () => 'Preparé los puntos',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const customer = found.value
      const cents = pesosToCents(input.monto)
      const payload = awardPayload.safeParse({ customer_id: customer.id, amount_cents: cents })
      if (!payload.success) return fail('Ese monto no entra: revisalo.')
      const [rules, ledger] = await Promise.all([
        listRules({ tenantId: ctx.tenantId }),
        listCustomerLedger({ tenantId: ctx.tenantId, customerId: customer.id, limit: 20 }),
      ])
      if (isRecentAward(ledger, cents, Date.now())) {
        return fail(
          `A ${customerName(customer)} ya se le acreditó ${money(cents)} recién. Si es otra consumición, esperá 3 minutos.`,
        )
      }
      const rule = activeAmountRule(rules)
      const points = awardPoints(rule, cents)
      const amountRules = rules.filter((r) => r.active && r.type === 'per_amount').length
      return prepared('clientes.puntos', payload.data, {
        kind: 'puntos',
        title: 'Acreditar puntos',
        subtitle: customerName(customer),
        rows: rowsOf([
          ['Consumo', money(cents)],
          ['Regla', rule ? ruleWords(rule, null) : 'No hay una regla por monto activa'],
          ['Tiene', pointsWord(customer.points_balance)],
          ['Queda en', pointsWord(customer.points_balance + points)],
        ]),
        total: { label: 'Suma', value: pointsWord(points) },
        warnings: [
          warn('visit', `También le suma una visita de ${money(cents)} a su ficha.`),
          ...(rule
            ? []
            : [
                warn(
                  'no_rule',
                  'Sin una regla por monto activa, queda la visita y no suma puntos.',
                ),
              ]),
          ...(rule && points === 0
            ? [warn('below_step', 'Con ese monto no llega a sumar: queda solo la visita.')]
            : []),
          ...(amountRules > 1
            ? [
                warn(
                  'many_rules',
                  'Hay más de una regla por monto activa: cuenta la de más prioridad.',
                ),
              ]
            : []),
        ],
        confirmLabel: points > 0 ? `Acreditar ${pointsWord(points)}` : 'Cargar la visita',
      })
    },
  }),

  defineTool({
    name: 'preparar_canje',
    description:
      'Prepara canjear los puntos de un cliente por una recompensa del catálogo: descuenta los puntos en el momento y queda entregada. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField,
      recompensa: z.string().trim().min(1).max(80).describe('La recompensa: su nombre o su id.'),
    }),
    need: { roles: OWNER_OR_CASHIER },
    mood: 'working',
    doing: () => 'Preparando el canje',
    done: () => 'Preparé el canje',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const customer = found.value
      const [rewards, tiers] = await Promise.all([
        listRewards({ tenantId: ctx.tenantId }),
        listTiers({ tenantId: ctx.tenantId }),
      ])
      const picked = pickByName(rewards, input.recompensa, (r) => r.name, 'la recompensa')
      if (!picked.ok) return fail(picked.message)
      const reward = picked.value
      const name = customerName(customer)
      const check = validateRedeem({ balance: customer.points_balance, reward })
      if (!check.ok) {
        if (check.error === 'reward_inactive') return fail(`«${reward.name}» está pausada.`)
        if (check.error === 'out_of_stock') return fail(`«${reward.name}» se quedó sin stock.`)
        return fail(
          `A ${name} no le alcanza: tiene ${pointsWord(customer.points_balance)} y «${reward.name}» cuesta ${pointsWord(reward.cost_points)}.`,
        )
      }
      if (!canRedeemReward(customer.category_points, reward, tiers)) {
        const tier = tiers.find((t) => t.id === reward.min_tier_id)
        return fail(
          `«${reward.name}» es desde el nivel ${tier?.name ?? 'otro'}, y ${name} no llega.`,
        )
      }
      const payload = redeemPayload.safeParse({ customer_id: customer.id, reward_id: reward.id })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return prepared('clientes.canje', payload.data, {
        kind: 'canje',
        title: 'Canje',
        subtitle: `${name} · ${reward.name}`,
        rows: rowsOf([
          ['Tiene', pointsWord(customer.points_balance)],
          ['Queda en', pointsWord(customer.points_balance - reward.cost_points)],
          ['Stock', reward.stock === null ? null : `Quedan ${reward.stock}`],
        ]),
        total: { label: 'Descuenta', value: pointsWord(reward.cost_points) },
        warnings: [warn('now', 'Se descuenta ya y queda como entregado: dáselo en el momento.')],
        confirmLabel: `Canjear ${pointsWord(reward.cost_points)}`,
      })
    },
  }),

  defineTool({
    name: 'preparar_visita',
    description:
      'Prepara registrar una visita de un cliente con lo que consumió de la carta, ítem por ítem, como Cerrar mesa: suma los puntos de todas las reglas activas. Si solo sabés el monto, usá preparar_puntos. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField,
      consumo: z
        .array(
          z.object({
            item: z.string().trim().min(1).max(120).describe('El ítem de la carta: nombre o id.'),
            cantidad: z.number().int().min(1).max(99),
          }),
        )
        .min(1)
        .max(40),
      nota: z.string().trim().max(300).optional(),
    }),
    need: { roles: OWNER_OR_CASHIER },
    mood: 'working',
    doing: () => 'Preparando la visita',
    done: () => 'Preparé la visita',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const customer = found.value
      const [menu, rules] = await Promise.all([
        listActiveMenu({ tenantId: ctx.tenantId }),
        listRules({ tenantId: ctx.tenantId }),
      ])
      const lines = new Map<string, { item: MenuItem; quantity: number }>()
      for (const line of input.consumo) {
        const picked = pickByName(menu.items, line.item, (i) => i.name, 'en la carta el ítem')
        if (!picked.ok) return fail(picked.message)
        const same = lines.get(picked.value.id)
        lines.set(picked.value.id, {
          item: picked.value,
          quantity: (same?.quantity ?? 0) + line.cantidad,
        })
      }
      const chosen = [...lines.values()]
      const payload = visitPayload.safeParse({
        customer_id: customer.id,
        items: chosen.map((line) => ({ item_id: line.item.id, quantity: line.quantity })),
        notes: input.nota || null,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const total = chosen.reduce((sum, line) => sum + line.item.price_cents * line.quantity, 0)
      const { delta } = calculatePoints(
        {
          total_amount_cents: total,
          items: chosen.map((line) => ({
            menu_item_id: line.item.id,
            category_id: line.item.category_id,
            quantity: line.quantity,
            unit_price_cents: line.item.price_cents,
            line_total_cents: line.item.price_cents * line.quantity,
            points_override: line.item.points_override,
          })),
        },
        rules,
      )
      return prepared('clientes.visita', payload.data, {
        kind: 'visita',
        title: 'Registrar visita',
        subtitle: customerName(customer),
        rows: [
          ...chosen.map((line) => ({
            label: `${line.quantity} × ${line.item.name}`,
            value: money(line.item.price_cents * line.quantity),
          })),
          ...rowsOf([
            ['Suma', delta > 0 ? pointsWord(delta) : 'No suma puntos'],
            ['Nota', input.nota],
          ]),
        ],
        total: { label: 'Total', value: money(total) },
        confirmLabel: 'Registrar la visita',
      })
    },
  }),

  defineTool({
    name: 'preparar_sello',
    description:
      'Prepara ponerle o sacarle un sello a la punch card de un cliente: un sello por vez, como el «+1» de Acreditar. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      cliente: clienteField,
      tarjeta: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('La tarjeta: nombre o id. Si hay una sola, no hace falta.'),
      sacar: z.boolean().optional().describe('true: saca un sello mal puesto.'),
    }),
    need: { roles: REDEMPTION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando el sello',
    done: () => 'Preparé el sello',
    run: async (input, ctx) => {
      const found = await resolveCustomer(ctx, input.cliente)
      if (!found.ok) return fail(found.message)
      const customer = found.value
      const name = customerName(customer)
      const cards = await listCustomerPunchCards(ctx.slug, customer.id)
      if (cards.length === 0) return fail('El bar no tiene punch cards activas.')
      const withId = cards.map((card) => ({ ...card, id: card.templateId }))
      const [onlyCard] = withId
      const picked = input.tarjeta
        ? pickByName(withId, input.tarjeta, (c) => c.templateName, 'la tarjeta')
        : onlyCard && withId.length === 1
          ? ({ ok: true, value: onlyCard } as const)
          : ({
              ok: false,
              message: `Preguntale cuál tarjeta: ${withId.map((c) => c.templateName).join(', ')}.`,
            } as const)
      if (!picked.ok) return fail(picked.message)
      const card = picked.value

      if (input.sacar) {
        if (!card.cardId || card.current <= 0) {
          return fail(`${name} no tiene sellos para sacar en «${card.templateName}».`)
        }
        const payload = stampPayload.safeParse({
          accion: 'sacar',
          customer_id: customer.id,
          card_id: card.cardId,
        })
        if (!payload.success) return fail(zodIssuesText(payload.error))
        return prepared('clientes.sello', payload.data, {
          kind: 'sello',
          title: 'Sacar un sello',
          subtitle: `${name} · ${card.templateName}`,
          rows: rowsOf([
            ['Tiene', `${card.current} de ${card.threshold}`],
            ['Queda en', `${card.current - 1} de ${card.threshold}`],
          ]),
          confirmLabel: 'Sacar el sello',
        })
      }

      if (card.lockedByTier) {
        return fail(
          `«${card.templateName}» es solo para ${formatRequiredTiers(card.requiredTierNames) || 'otro nivel'}, y ${name} no está en ese nivel.`,
        )
      }
      const payload = stampSchema.safeParse({
        customer_id: customer.id,
        template_id: card.templateId,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const completes = card.remaining === 1
      let prize: string | null = null
      if (completes) {
        const templates = await listPunchCardTemplates(ctx.tenantId)
        const template = templates.find((t) => t.id === card.templateId)
        prize = template?.reward_label ?? template?.reward_name ?? null
      }
      return prepared(
        'clientes.sello',
        { accion: 'sumar', ...payload.data },
        {
          kind: 'sello',
          title: 'Poner un sello',
          subtitle: `${name} · ${card.templateName}`,
          rows: rowsOf([
            ['Tiene', `${card.current} de ${card.threshold}`],
            ['Queda en', `${card.current + 1} de ${card.threshold}`],
          ]),
          warnings: completes
            ? [
                warn(
                  'completes',
                  `Con este completa la tarjeta${prize ? ` y gana ${prize}` : ''}: le queda para retirar.`,
                ),
              ]
            : [],
          confirmLabel: 'Poner el sello',
        },
      )
    },
  }),
]

// ─── Los ejecutores ──────────────────────────────────────────────────────────

const toCustomer = (
  data: { cliente_id: string },
  ctx: TexToolContext,
  point: string | null = null,
) => place(ctx, 'clientes.ficha', { id: data.cliente_id }, point)

export const clientesExecutors: Readonly<Record<string, TexExecutor>> = {
  'clientes.alta': simpleExecutor(
    customerCreatePayload,
    guarded(async (payload, ctx) => {
      const { extras, ...values } = payload
      const created = await createCustomer(ctx.slug, { ok: true }, customerCreateForm(values))
      if (!created.ok || !created.customerId) {
        return created.ok
          ? failure('No pudimos crear el cliente.')
          : settled(created, null as never, '')
      }
      const data = { cliente_id: created.customerId }
      const message = created.message ?? 'Cliente creado.'
      if (!extras) return { ok: true, data, message }
      // El formulario de alta no tiene notas ni avisos: se guardan como en la ficha.
      const current = await customerById(ctx, created.customerId)
      if (!current) return { ok: true, data, message }
      const saved = await updateCustomer(
        ctx.slug,
        { ok: true },
        customerEditForm(customerEditValues(current, extras)),
      )
      return saved.ok
        ? { ok: true, data, message }
        : failure(`Se creó el cliente, pero no sus notas ni avisos. ${saved.message}`)
    }),
    (data, _payload, ctx) => toCustomer(data, ctx),
  ),

  'clientes.edicion': simpleExecutor(
    customerEditPayload,
    guarded(async (payload, ctx) => {
      const current = await customerById(ctx, payload.id)
      if (!current) return failure('Ese cliente ya no está.')
      const form = customerEditForm(customerEditValues(current, payload.change))
      const state = await updateCustomer(ctx.slug, { ok: true }, form)
      return settled(state, { cliente_id: payload.id }, 'Guardado.')
    }),
    (data, _payload, ctx) => toCustomer(data, ctx),
  ),

  'clientes.etiqueta': simpleExecutor(
    tagPayload,
    guarded(async (payload, ctx) => {
      const data = { cliente_id: payload.customer_id }
      if (payload.accion === 'crear') {
        const state = await createAndAssignTag(ctx.slug, {
          customer_id: payload.customer_id,
          name: payload.name,
        })
        return settled(state, data, `Le puse «${payload.name}».`)
      }
      const ids = { customer_id: payload.customer_id, tag_id: payload.tag_id }
      return payload.accion === 'poner'
        ? settled(await assignTag(ctx.slug, ids), data, `Le puse «${payload.name}».`)
        : settled(await removeTag(ctx.slug, ids), data, `Le saqué «${payload.name}».`)
    }),
    (data, payload, ctx) => toCustomer(data, ctx, payload.accion === 'sacar' ? null : payload.name),
  ),

  'clientes.puntos': simpleExecutor(
    awardPayload,
    guarded(async (payload, ctx) => {
      const state = await awardPointsByAmount(ctx.slug, payload)
      if (!state.ok) return settled(state, null as never, '')
      return {
        ok: true,
        data: {
          cliente_id: state.customer_id,
          puntos_sumados: state.points_awarded,
          saldo: state.new_balance,
        },
        message: `Se acreditaron ${pointsWord(state.points_awarded)}. Le quedan ${pointsWord(state.new_balance)}.`,
      }
    }),
    (data, _payload, ctx) => toCustomer(data, ctx, 'Puntos disponibles'),
  ),

  'clientes.canje': simpleExecutor(
    redeemPayload,
    guarded(async (payload, ctx) => {
      const state = await redeemReward(ctx.slug, payload)
      if (!state.ok) return settled(state, null as never, '')
      return {
        ok: true,
        data: { cliente_id: payload.customer_id, saldo: state.balance_after },
        message: `Canje hecho. Le quedan ${pointsWord(state.balance_after)}.`,
      }
    }),
    (data, _payload, ctx) => toCustomer(data, ctx, 'Puntos disponibles'),
  ),

  'clientes.visita': simpleExecutor(
    visitPayload,
    guarded(async (payload, ctx) => {
      const state = await closeTable(ctx.slug, payload)
      if (!state.ok) return settled(state, null as never, '')
      return {
        ok: true,
        data: { cliente_id: payload.customer_id, puntos_sumados: state.points_awarded },
        message: `Visita registrada. Sumó ${pointsWord(state.points_awarded)}.`,
      }
    }),
    (data, _payload, ctx) => toCustomer(data, ctx, 'Visitas'),
  ),

  'clientes.sello': simpleExecutor(
    stampPayload,
    guarded(async (payload, ctx) => {
      const data = { cliente_id: payload.customer_id }
      if (payload.accion === 'sacar') {
        const state = await removeStampAction(ctx.slug, payload.card_id)
        return state.ok
          ? { ok: true, data, message: `Listo: quedó con ${state.current} sellos.` }
          : settled(state, data, '')
      }
      const state = await addStampAction(ctx.slug, payload.customer_id, payload.template_id)
      if (!state.ok) return settled(state, data, '')
      return {
        ok: true,
        data,
        message: state.completed
          ? `Completó «${state.templateName}»: le queda el premio para retirar.`
          : `Sello puesto. Le faltan ${state.remaining} en «${state.templateName}».`,
      }
    }),
    (data, _payload, ctx) => toCustomer(data, ctx),
  ),
}
