import 'server-only'

import { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { addDays, formatDayMonth, isoDayInCordoba, todayInCordoba } from '@/lib/dates'
import { canonicalPhone, formatPhoneForDisplay } from '@/lib/phone'
import { saveSupplier } from '@/lib/purchasing/catalog-actions'
import {
  longDayLabel,
  nextDeliveryDate,
  relativeDayLabel,
  weekdaysText,
} from '@/lib/purchasing/dates'
import { draftOutcome } from '@/lib/purchasing/draft'
import {
  approveOrder,
  backToDraft,
  closeDifferences,
  confirmOrder,
  confirmWithChanges,
  createDraft,
  type OrderResult,
  saveDraft,
  skipOrder,
} from '@/lib/purchasing/order-actions'
import { type Catalog, getCatalog, getOrder, getOrders } from '@/lib/purchasing/queries'
import { supplierSchema } from '@/lib/purchasing/schemas'
import { expectedPacks, type PurOrder, type PurSupplier } from '@/lib/purchasing/types'
import { packsText } from '@/lib/purchasing/units'
import { claimMessage, whatsappLink } from '@/lib/purchasing/whatsapp'
import type { TexTicketRow, TexTicketWarning } from '../../protocol'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import type { Found } from '../negocio/_carta-values'
import {
  dayField,
  defineTool,
  type TexExecutor,
  type TexToolContext,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import {
  changeRows,
  deliveryText,
  otherSupplierWarning,
  packsLabel,
  parseWeekdays,
  pickSupplier,
  resolveInOrder,
  resolveProducts,
  sendRows,
} from './_values'
import { PEDIDOS_NEED } from './read'

/**
 * Lo que Tex hace en Compras, siempre con un tique: armar y corregir pedidos, mandarlos por WhatsApp,
 * confirmar lo que contestó el proveedor, reclamar, «Hoy no pido», volver a borrador, cerrar las
 * diferencias y los datos de un proveedor. Al confirmar corre la misma acción del panel
 * (`lib/purchasing/order-actions.ts`): mismos permisos, mismas validaciones, misma auditoría.
 *
 * Mandar es un toque: el botón del tique abre WhatsApp con el mensaje y a la vez lo marca enviado. Por
 * eso el ejecutor verifica, antes de marcarlo, que el mensaje que se abrió sea el que queda guardado.
 */

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

const failed = (message: string): AccSimpleState<never> => ({ ok: false, code: 'error', message })

function senderOf(catalog: Catalog, ctx: TexToolContext): string {
  return catalog.settings.senderName ?? ctx.tenantName
}

/** A dónde lleva «Ver dónde quedó»: el panel de pedidos, señalando al proveedor. */
function toPanel(ctx: TexToolContext, point: string | null) {
  const link = texScreenHref(ctx.slug, 'pedidos.inicio')
  return { href: link.ok ? link.href : null, point }
}

const ORDER_STATE_WORDS: Record<PurOrder['status'], string> = {
  draft: 'para revisar: todavía no se mandó',
  sent: 'enviado, esperando la respuesta del proveedor',
  confirmed: 'confirmado y por llegar',
  with_differences: 'recibido con diferencias',
  completed: 'completado',
  discarded: 'descartado',
}

const WRONG_STATE: Partial<
  Record<PurOrder['status'], Partial<Record<PurOrder['status'], string>>>
> = {
  draft: {
    sent: 'Para corregirlo, primero volvelo a borrador (preparar_estado_pedido con volver_a_borrador).',
    confirmed: 'Ya lo confirmó el proveedor: si hay que cambiar algo, hablalo con él.',
  },
  sent: { draft: 'Se manda con preparar_envio_pedido.' },
}

const orderRef = {
  pedido: z.uuid().optional().describe('El pedido, de ver_pedidos.'),
  proveedor: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('O el proveedor (nombre o id), si tiene uno solo así.'),
}

const productsField = z
  .array(
    z.object({
      producto: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('Como sale en ver_pedidos o buscar_insumos, o su id.'),
      cantidad: z
        .number()
        .min(0)
        .max(100_000)
        .describe(
          'Lo que tiene que quedar pedido, en lo que se compra (cajas, kg). 0 lo saca. «Sumale 2»: lo que había más 2.',
        ),
    }),
  )
  .max(40)

const noteField = z
  .string()
  .trim()
  .max(500)
  .optional()
  .describe('La nota para el proveedor: sale en el WhatsApp. Vacía la borra.')

type Located = { order: PurOrder; supplier: PurSupplier | null }

/** El pedido en el estado que hace falta, por su id o por su proveedor. */
async function locate(
  ctx: TexToolContext,
  catalog: Catalog,
  ref: { pedido?: string; proveedor?: string },
  status: PurOrder['status'],
  what: string,
): Promise<Found<Located>> {
  const supplierOf = (order: PurOrder) =>
    catalog.suppliers.find((s) => s.id === order.supplierId) ?? null
  if (ref.pedido) {
    const order = await getOrder(ctx.tenantId, ref.pedido)
    if (!order)
      return { ok: false, message: 'No encontré ese pedido: mirá los que hay con ver_pedidos.' }
    if (order.status !== status) {
      const hint = WRONG_STATE[status]?.[order.status]
      return {
        ok: false,
        message: `Ese pedido está ${ORDER_STATE_WORDS[order.status]}.${hint ? ` ${hint}` : ''}`,
      }
    }
    return { ok: true, value: { order, supplier: supplierOf(order) } }
  }
  if (!ref.proveedor) {
    return { ok: false, message: 'Decime qué pedido: su id de ver_pedidos o el proveedor.' }
  }
  const picked = pickSupplier(catalog.suppliers, ref.proveedor)
  if (!picked.ok) return picked
  const orders = (await getOrders(ctx.tenantId, [status])).filter(
    (o) => o.supplierId === picked.value.id,
  )
  const [only] = orders
  if (!only) return { ok: false, message: `${picked.value.name} no tiene un pedido ${what}.` }
  if (orders.length > 1) {
    return {
      ok: false,
      message: `${picked.value.name} tiene ${orders.length} pedidos ${what}: pasame el id (ver_pedidos).`,
    }
  }
  return { ok: true, value: { order: only, supplier: picked.value } }
}

/**
 * El borrador sobre el que se trabaja: el que dijo, o el del proveedor. Con proveedor, a un pedido «Sin
 * proveedor» se le elige a quién se le pide.
 */
async function locateDraft(
  ctx: TexToolContext,
  catalog: Catalog,
  ref: { pedido?: string; proveedor?: string },
): Promise<
  Found<{ order: PurOrder | null; supplier: PurSupplier | null; chosen: PurSupplier | null }>
> {
  const active = catalog.suppliers.filter((s) => s.active)
  if (ref.pedido) {
    const found = await locate(ctx, catalog, { pedido: ref.pedido }, 'draft', 'para revisar')
    if (!found.ok) return found
    const { order, supplier } = found.value
    if (!ref.proveedor) return { ok: true, value: { order, supplier, chosen: null } }
    const picked = pickSupplier(active, ref.proveedor)
    if (!picked.ok) return picked
    if (!supplier) return { ok: true, value: { order, supplier: null, chosen: picked.value } }
    if (picked.value.id !== supplier.id) {
      return {
        ok: false,
        message: `Ese pedido es de ${supplier.name}. Lo de ${picked.value.name} va en su propio pedido.`,
      }
    }
    return { ok: true, value: { order, supplier, chosen: null } }
  }
  if (!ref.proveedor) {
    return { ok: false, message: 'Decime a qué proveedor, o el pedido de ver_pedidos.' }
  }
  const picked = pickSupplier(active, ref.proveedor)
  if (!picked.ok) return picked
  const drafts = (await getOrders(ctx.tenantId, ['draft'])).filter(
    (o) => o.supplierId === picked.value.id,
  )
  if (drafts.length > 1) {
    // No debería pasar (el conteo suma al que hay), pero si pasa, se pregunta: nunca se elige a ojo.
    return {
      ok: false,
      message: `${picked.value.name} tiene ${drafts.length} pedidos para revisar: pasame el id (ver_pedidos).`,
    }
  }
  return { ok: true, value: { order: drafts[0] ?? null, supplier: picked.value, chosen: null } }
}

function noteOf(input: string | undefined, current: string | null): string | null {
  if (input === undefined) return current
  return input.trim() || null
}

// ─── Lo que llega a cada ejecutor ────────────────────────────────────────────

const draftPayload = z.object({
  orderId: z.uuid(),
  lines: z.array(z.object({ id: z.uuid(), orderedPacks: z.number().min(0).nullable() })),
  added: z.array(z.object({ itemId: z.uuid(), packs: z.number().positive() })),
  supplierNote: z.string().nullable(),
  supplierId: z.uuid().nullable(),
  rememberSupplier: z.boolean(),
  /** Para «Ver dónde quedó». */
  supplierName: z.string(),
})

const newDraftPayload = z.object({
  supplierId: z.uuid(),
  supplierName: z.string(),
  lines: z.array(z.object({ itemId: z.uuid(), packs: z.number().positive() })),
  supplierNote: z.string().nullable(),
})

const sendPayload = draftPayload.extend({
  /** El WhatsApp tal como lo abrió el botón: tiene que ser el que queda guardado. */
  message: z.string().min(1),
  /** Sin WhatsApp cargado, el botón copió el mensaje. */
  copy: z.boolean(),
})

const confirmPayload = z.object({
  orderId: z.uuid(),
  supplierName: z.string(),
  asIs: z.boolean(),
  lines: z.array(z.object({ id: z.uuid(), confirmedPacks: z.number().min(0) })),
  expectedDate: z.string().nullable(),
  kitchenNote: z.string().nullable(),
})

const claimPayload = z.object({ orderId: z.uuid(), supplierName: z.string(), copy: z.boolean() })

const STATE_ACTIONS = ['no_pedir', 'volver_a_borrador', 'cerrar'] as const

const statePayload = z.object({
  orderId: z.uuid(),
  supplierName: z.string(),
  accion: z.enum(STATE_ACTIONS),
})

const supplierPayload = supplierSchema.omit({ slug: true }).extend({ id: z.uuid() })

function draftLines(packs: ReadonlyMap<string, number>) {
  return [...packs].map(([id, orderedPacks]) => ({ id, orderedPacks }))
}

function rememberWarning(chosen: PurSupplier | null): TexTicketWarning[] {
  return chosen
    ? [
        {
          key: 'recordar',
          title: `Esos productos quedan con ${chosen.name} para los próximos pedidos.`,
          body: null,
        },
      ]
    : []
}

export const pedidosActionTools = [
  defineTool({
    name: 'preparar_pedido',
    description:
      'Prepara armar o corregir un pedido a un proveedor antes de mandarlo: cuánto pedir de cada producto (0 lo saca), sumar productos de la lista de insumos, la nota para el proveedor y, en uno «Sin proveedor», a quién se le pide. Si el proveedor no tiene un pedido para revisar, arma uno nuevo. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      pedido: z.uuid().optional().describe('El pedido para revisar, de ver_pedidos.'),
      proveedor: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe(
          'A quién se le pide: nombre o id. Sin pedido, toma el suyo para revisar o arma uno nuevo.',
        ),
      productos: productsField.default([]),
      nota: noteField,
    }),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Armando el pedido',
    done: () => 'Armé el pedido',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const where = await locateDraft(ctx, catalog, input)
      if (!where.ok) return fail(where.message)
      const { order, supplier, chosen } = where.value
      const plan = resolveProducts({
        wanted: input.productos,
        lines: order?.lines ?? [],
        items: catalog.items,
      })
      if (!plan.ok) return fail(plan.message)
      const { packs, added } = plan.value
      const note = noteOf(input.nota, order?.supplierNote ?? null)
      const otherWarning = otherSupplierWarning({
        added,
        supplierId: (supplier ?? chosen)?.id ?? null,
        suppliers: catalog.suppliers,
      })

      if (!order) {
        // Sin pedido para revisar: uno nuevo, con lo que dijo.
        if (!supplier) return fail('Decime a qué proveedor se le pide.')
        if (!added.length) return fail('Para un pedido nuevo decime qué productos y cuánto.')
        const expected = nextDeliveryDate(ctx.today, supplier.deliveryWeekdays, supplier.leadDays)
        const payload = newDraftPayload.parse({
          supplierId: supplier.id,
          supplierName: supplier.name,
          lines: added.map((a) => ({ itemId: a.item.id, packs: a.packs })),
          supplierNote: note,
        })
        return {
          kind: 'prepared',
          prepared: {
            executor: 'pedidos.nuevo',
            payload,
            ticket: {
              kind: 'pedido_nuevo',
              title: 'Pedido nuevo',
              subtitle: `${supplier.name} · ${deliveryText(expected, ctx.today)}`,
              rows: [
                ...added.map((a) => ({
                  label: a.item.name,
                  value: packsLabel({ ...a.item, packs: a.packs }),
                })),
                ...(note ? [{ label: 'Nota', value: note }] : []),
              ],
              total: { label: 'Productos', value: String(added.length) },
              entry: [],
              warnings: [
                ...(otherWarning ? [otherWarning] : []),
                {
                  key: 'revisar',
                  title: 'Queda para revisar: todavía no se le manda.',
                  body: null,
                },
              ],
              confirmLabel: 'Armar el pedido',
            },
          },
        }
      }

      const rows: TexTicketRow[] = [
        ...(chosen ? [{ label: 'Proveedor', value: `Sin proveedor → ${chosen.name}` }] : []),
        ...changeRows({ lines: order.lines, plan: plan.value }),
        ...(note !== order.supplierNote ? [{ label: 'Nota', value: note ?? 'sin nota' }] : []),
      ]
      if (!rows.length) return fail('Ya está así: no hay nada para cambiar.')
      const target = supplier ?? chosen
      const outcome = draftOutcome({
        order,
        supplier: target,
        edit: { packs, added, note },
        senderName: senderOf(catalog, ctx),
        today: ctx.today,
      })
      const payload = draftPayload.parse({
        orderId: order.id,
        lines: draftLines(packs),
        added: added.map((a) => ({ itemId: a.item.id, packs: a.packs })),
        supplierNote: note,
        supplierId: chosen?.id ?? null,
        rememberSupplier: Boolean(chosen),
        supplierName: target?.name ?? 'Sin proveedor',
      })
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.borrador',
          payload,
          ticket: {
            kind: 'pedido',
            title: 'Pedido',
            subtitle: `${target?.name ?? 'Sin proveedor'} · ${deliveryText(outcome.expectedDate, ctx.today)}`,
            rows,
            total: { label: 'Productos', value: String(outcome.toOrder.length) },
            entry: [],
            warnings: [
              ...(outcome.undefinedNames.length
                ? [
                    {
                      key: 'a_definir',
                      title: `Falta cuánto pedir de: ${outcome.undefinedNames.join(', ')}.`,
                      body: 'Sin eso no se puede mandar.',
                    },
                  ]
                : []),
              ...(otherWarning ? [otherWarning] : []),
              ...rememberWarning(chosen),
            ],
            confirmLabel: 'Guardar el pedido',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_envio_pedido',
    description:
      'Prepara mandar por WhatsApp un pedido para revisar. El botón del tique lo marca enviado y abre el chat del proveedor con el mensaje armado; sin WhatsApp cargado, copia el mensaje. Un tique por pedido. Puede corregir cantidades en el mismo paso. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      ...orderRef,
      productos: productsField.default([]).describe('Lo que se corrige antes de mandarlo.'),
      nota: noteField,
    }),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Armando el WhatsApp',
    done: () => 'Armé el WhatsApp',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const where = await locateDraft(ctx, catalog, input)
      if (!where.ok) return fail(where.message)
      const { order, supplier, chosen } = where.value
      const to = supplier ?? chosen
      if (!order) {
        return fail(
          `${to?.name ?? 'Ese proveedor'} no tiene un pedido para revisar. Para armarle uno, preparar_pedido.`,
        )
      }
      if (!to) {
        return fail(
          'Ese pedido no tiene proveedor: preguntale a quién se le pide y pasalo en proveedor.',
        )
      }
      const plan = resolveProducts({
        wanted: input.productos,
        lines: order.lines,
        items: catalog.items,
      })
      if (!plan.ok) return fail(plan.message)
      const { packs, added } = plan.value
      const note = noteOf(input.nota, order.supplierNote)
      const outcome = draftOutcome({
        order,
        supplier: to,
        edit: { packs, added, note },
        senderName: senderOf(catalog, ctx),
        today: ctx.today,
      })
      if (outcome.undefinedNames.length) {
        return fail(
          `Falta cuánto pedir de: ${outcome.undefinedNames.join(', ')}. Preguntale, o sacalos con cantidad 0.`,
        )
      }
      if (!outcome.toOrder.length) {
        return fail(
          'No queda nada para pedir. Si hoy no se le pide, es preparar_estado_pedido con no_pedir.',
        )
      }
      const href = whatsappLink(to.whatsapp, outcome.message)
      const before = new Map(order.lines.map((l) => [l.id, l]))
      const rows = sendRows(outcome.toOrder).map((row, index) => {
        const line = outcome.toOrder[index]
        const old = line?.lineId ? before.get(line.lineId) : undefined
        if (!line?.lineId) return { ...row, value: `${row.value} (nuevo)` }
        if (old && old.orderedPacks !== line.packs) {
          return {
            ...row,
            value: `${row.value} (era ${packsLabel({ ...old, packs: old.orderedPacks })})`,
          }
        }
        return row
      })
      const otherWarning = otherSupplierWarning({
        added,
        supplierId: to.id,
        suppliers: catalog.suppliers,
      })
      const payload = sendPayload.parse({
        orderId: order.id,
        lines: draftLines(packs),
        added: added.map((a) => ({ itemId: a.item.id, packs: a.packs })),
        supplierNote: note,
        supplierId: chosen?.id ?? null,
        rememberSupplier: Boolean(chosen),
        supplierName: to.name,
        message: outcome.message,
        copy: href === null,
      })
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.enviar',
          payload,
          ticket: {
            kind: 'pedido_envio',
            title: 'Pedido por WhatsApp',
            subtitle: `${to.name} · ${outcome.expectedDate ? `para el ${longDayLabel(outcome.expectedDate)}` : 'sin día de entrega'}`,
            rows: [...rows, ...(note ? [{ label: 'Nota', value: note }] : [])],
            total: { label: 'Productos', value: String(outcome.toOrder.length) },
            entry: [],
            warnings: [
              ...(href
                ? []
                : [
                    {
                      key: 'sin_whatsapp',
                      title: `${to.name} no tiene WhatsApp cargado: el botón copia el mensaje para que lo pegues en su chat.`,
                      body: null,
                    },
                  ]),
              ...(outcome.expectedDate
                ? []
                : [
                    {
                      key: 'sin_dias',
                      title: 'Sin días de entrega cargados: el mensaje le pregunta cuándo puede.',
                      body: null,
                    },
                  ]),
              ...(otherWarning ? [otherWarning] : []),
              ...rememberWarning(chosen),
            ],
            confirmLabel: href ? 'Mandar por WhatsApp' : 'Copiar y marcar enviado',
            send: { href, text: outcome.message },
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_confirmacion_pedido',
    description:
      'Prepara confirmar un pedido enviado con lo que contestó el proveedor: tal cual, o con cambios (lo que no tiene, otra cantidad, otro día de entrega, un aviso para la cocina). Recién confirmado, la cocina lo recibe sin aviso. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      ...orderRef,
      cambios: z
        .array(
          z.object({
            producto: z.string().trim().min(1).max(80).describe('Como sale en el pedido, o su id.'),
            cantidad: z
              .number()
              .min(0)
              .max(100_000)
              .describe('Lo que va a mandar, en lo que se compra. 0 = no lo tiene.'),
          }),
        )
        .max(40)
        .default([]),
      entrega: dayField('El día que llega, si no es el previsto. yyyy-MM-dd.').optional(),
      nota_cocina: z
        .string()
        .trim()
        .max(500)
        .optional()
        .describe('Un aviso para la cocina al recibir. Vacío lo borra.'),
    }),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Preparando la confirmación',
    done: () => 'Preparé la confirmación',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const where = await locate(ctx, catalog, input, 'sent', 'enviado')
      if (!where.ok) return fail(where.message)
      const { order, supplier } = where.value
      const lines = order.lines.filter((l) => (l.orderedPacks ?? 0) > 0)
      const changes = resolveInOrder(input.cambios, lines)
      if (!changes.ok) return fail(changes.message)
      if (input.entrega && input.entrega < addDays(ctx.today, -1)) {
        return fail('La fecha de entrega no puede ser de antes de ayer.')
      }
      const expectedDate = input.entrega ?? order.expectedDate
      const kitchenNote = noteOf(input.nota_cocina, order.kitchenNote)
      const changedLines = lines.filter(
        (l) => changes.value.has(l.id) && changes.value.get(l.id) !== l.orderedPacks,
      )
      const dateChanged = expectedDate !== order.expectedDate
      const noteChanged = kitchenNote !== order.kitchenNote
      const asIs = !changedLines.length && !dateChanged && !noteChanged
      const name = supplier?.name ?? 'Sin proveedor'
      const when = (day: string | null) => (day ? relativeDayLabel(day, ctx.today) : 'sin fecha')
      const rows: TexTicketRow[] = asIs
        ? [
            { label: 'Respuesta', value: 'va todo como se pidió' },
            { label: 'Llega', value: when(order.expectedDate) },
          ]
        : [
            ...changedLines.map((l) => {
              const viene = changes.value.get(l.id) ?? 0
              return {
                label: l.name,
                value: `${packsText({ ...l, packs: l.orderedPacks })} → ${viene > 0 ? packsText({ ...l, packs: viene }) : 'no lo tiene'}`,
              }
            }),
            ...(dateChanged
              ? [{ label: 'Llega', value: `${when(order.expectedDate)} → ${when(expectedDate)}` }]
              : [{ label: 'Llega', value: when(expectedDate) }]),
            ...(noteChanged
              ? [{ label: 'Para la cocina', value: kitchenNote ?? 'sin aviso' }]
              : []),
          ]
      const less = changedLines.some((l) => (changes.value.get(l.id) ?? 0) < (l.orderedPacks ?? 0))
      const payload = confirmPayload.parse({
        orderId: order.id,
        supplierName: name,
        asIs,
        lines: lines.map((l) => ({
          id: l.id,
          confirmedPacks: changes.value.get(l.id) ?? l.orderedPacks ?? 0,
        })),
        expectedDate,
        kitchenNote,
      })
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.confirmar',
          payload,
          ticket: {
            kind: 'pedido_confirmado',
            title: asIs ? 'Pedido confirmado' : 'Confirmado con cambios',
            subtitle: name,
            rows,
            total: null,
            entry: [],
            warnings: less
              ? [
                  {
                    key: 'falta',
                    title:
                      'Lo que no viene no cuenta como en camino: vuelve a salir en el próximo conteo.',
                    body: null,
                  },
                ]
              : [],
            confirmLabel: asIs ? 'Confirmar el pedido' : 'Confirmar con los cambios',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_reclamo_pedido',
    description:
      'Prepara reclamarle al proveedor por WhatsApp lo que llegó distinto en un pedido «con diferencias»: el botón del tique abre el chat con el reclamo armado. No cierra el pedido. No guarda nada: muestra un tique para confirmar.',
    input: z.object(orderRef),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Armando el reclamo',
    done: () => 'Armé el reclamo',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const where = await locate(ctx, catalog, input, 'with_differences', 'con diferencias')
      if (!where.ok) return fail(where.message)
      const { order, supplier } = where.value
      const diffs = order.lines.filter(
        (l) => l.receivedState === 'partial' || l.receivedState === 'missing',
      )
      if (!diffs.length) return fail('Ese pedido no tiene diferencias para reclamar.')
      const receivedDay = order.receivedAt ? isoDayInCordoba(order.receivedAt) : null
      const message = claimMessage({
        senderName: senderOf(catalog, ctx),
        contactName: supplier?.contactName ?? null,
        receivedDate: receivedDay,
        lines: diffs.map((l) => ({
          name: l.name,
          packs: expectedPacks(l),
          packLabel: l.packLabel,
          packSize: l.packSize,
          unit: l.unit,
          receivedPacks: l.receivedPacks ?? 0,
        })),
      })
      const href = supplier ? whatsappLink(supplier.whatsapp, message) : null
      const name = supplier?.name ?? 'Sin proveedor'
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.reclamo',
          payload: claimPayload.parse({ orderId: order.id, supplierName: name, copy: !href }),
          ticket: {
            kind: 'pedido_reclamo',
            title: 'Reclamo por WhatsApp',
            subtitle: `${name}${receivedDay ? ` · llegó el ${formatDayMonth(receivedDay)}` : ''}`,
            rows: diffs.map((l) => {
              const got = l.receivedPacks ?? 0
              return {
                label: l.name,
                value: `se pidió ${packsText({ ...l, packs: expectedPacks(l) })}, ${got > 0 ? `llegó ${packsText({ ...l, packs: got })}` : 'no llegó'}`,
              }
            }),
            total: null,
            entry: [],
            warnings: [
              ...(href
                ? []
                : [
                    {
                      key: 'sin_whatsapp',
                      title: `${name} no tiene WhatsApp cargado: el botón copia el reclamo.`,
                      body: null,
                    },
                  ]),
              {
                key: 'cerrar',
                title: 'Reclamar no cierra el pedido: cuando se resuelva, se cierra.',
                body: null,
              },
            ],
            confirmLabel: href ? 'Reclamar por WhatsApp' : 'Copiar el reclamo',
            send: { href, text: message },
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_estado_pedido',
    description:
      'Prepara «Hoy no pido» (descarta un pedido para revisar), volver a borrador un pedido enviado para corregirlo, o cerrar las diferencias de uno que llegó distinto (lo que faltó vuelve solo en el próximo pedido). No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      ...orderRef,
      accion: z
        .enum(STATE_ACTIONS)
        .describe(
          'no_pedir: «Hoy no pido». volver_a_borrador: un enviado. cerrar: las diferencias.',
        ),
    }),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Preparando el cambio del pedido',
    done: () => 'Preparé el cambio del pedido',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const from =
        input.accion === 'no_pedir'
          ? ({ status: 'draft', what: 'para revisar' } as const)
          : input.accion === 'volver_a_borrador'
            ? ({ status: 'sent', what: 'enviado' } as const)
            : ({ status: 'with_differences', what: 'con diferencias' } as const)
      const where = await locate(ctx, catalog, input, from.status, from.what)
      if (!where.ok) return fail(where.message)
      const { order, supplier } = where.value
      const name = supplier?.name ?? 'Sin proveedor'
      const count = order.lines.filter((l) => (l.orderedPacks ?? 0) > 0).length
      const payload = statePayload.parse({
        orderId: order.id,
        supplierName: name,
        accion: input.accion,
      })
      const ticket =
        input.accion === 'no_pedir'
          ? {
              title: 'Hoy no se pide',
              rows: [
                { label: 'Pedido', value: `${count} ${count === 1 ? 'producto' : 'productos'}` },
              ],
              warnings: [
                {
                  key: 'vuelve',
                  title: 'Se descarta. Lo que hacía falta vuelve a salir en el próximo conteo.',
                  body: null,
                },
              ],
              confirmLabel: 'Hoy no pido',
            }
          : input.accion === 'volver_a_borrador'
            ? {
                title: 'Volver a borrador',
                rows: [
                  {
                    label: 'Enviado',
                    value: order.sentAt
                      ? formatDayMonth(isoDayInCordoba(order.sentAt) ?? '')
                      : 'sin fecha',
                  },
                ],
                warnings: [
                  {
                    key: 'avisar',
                    title: 'Si el proveedor ya lo recibió, avisale que se lo vas a corregir.',
                    body: null,
                  },
                ],
                confirmLabel: 'Volver a borrador',
              }
            : {
                title: 'Cerrar las diferencias',
                rows: order.lines
                  .filter((l) => l.receivedState === 'partial' || l.receivedState === 'missing')
                  .map((l) => ({
                    label: l.name,
                    value:
                      (l.receivedPacks ?? 0) > 0
                        ? `llegó ${packsText({ ...l, packs: l.receivedPacks })}`
                        : 'no llegó',
                  })),
                warnings: [
                  {
                    key: 'vuelve',
                    title: 'Lo que faltó vuelve solo en el próximo pedido sugerido.',
                    body: null,
                  },
                ],
                confirmLabel: 'Cerrar',
              }
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.estado',
          payload,
          ticket: {
            kind: 'pedido_estado',
            subtitle: name,
            total: null,
            entry: [],
            ...ticket,
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_proveedor_compras',
    description:
      'Prepara cargar o cambiar los datos de un proveedor de Compras: su WhatsApp (sin él, el pedido se copia a mano), con quién se habla, qué días entrega y con cuántos días de anticipación hay que pedirle. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      proveedor: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('Nombre o id, de ver_proveedores_compras.'),
      whatsapp: z
        .string()
        .trim()
        .max(30)
        .optional()
        .describe('El celular como lo dicen: «351 555-1234». Vacío lo borra.'),
      contacto: z
        .string()
        .trim()
        .max(60)
        .optional()
        .describe('Con quién se habla: va en el saludo. Vacío lo borra.'),
      dias_entrega: z
        .array(z.string().trim().min(2).max(12))
        .max(7)
        .optional()
        .describe('Los días que entrega: «lunes», «jueves». Vacío los borra.'),
      anticipacion: z
        .number()
        .int()
        .min(0)
        .max(14)
        .optional()
        .describe('Con cuántos días hay que pedirle: 1 = lo de hoy llega mañana.'),
    }),
    need: PEDIDOS_NEED,
    mood: 'working',
    doing: () => 'Preparando el proveedor',
    done: () => 'Preparé el proveedor',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      const picked = pickSupplier(catalog.suppliers, input.proveedor)
      if (!picked.ok) return fail(picked.message)
      const s = picked.value
      const current = s.whatsapp ? `+${s.whatsapp}` : null
      let whatsapp = current
      if (input.whatsapp !== undefined) {
        if (!input.whatsapp) whatsapp = null
        else {
          const e164 = canonicalPhone(input.whatsapp)
          if (!e164) {
            return fail(
              'Ese WhatsApp no parece un número: pedile el celular con la característica (351…).',
            )
          }
          whatsapp = e164
        }
      }
      let days = s.deliveryWeekdays
      if (input.dias_entrega !== undefined) {
        const parsed = parseWeekdays(input.dias_entrega)
        if (!parsed.ok) return fail(parsed.message)
        days = parsed.value
      }
      const contactName = noteOf(input.contacto, s.contactName)
      const leadDays = input.anticipacion ?? s.leadDays
      const phone = (value: string | null) =>
        value ? formatPhoneForDisplay(value) : 'sin WhatsApp'
      const dayList = (value: readonly number[]) => weekdaysText(value) || 'sin días'
      const rows: TexTicketRow[] = [
        ...(whatsapp !== current
          ? [{ label: 'WhatsApp', value: `${phone(current)} → ${phone(whatsapp)}` }]
          : []),
        ...(contactName !== s.contactName
          ? [
              {
                label: 'Contacto',
                value: `${s.contactName ?? 'sin contacto'} → ${contactName ?? 'sin contacto'}`,
              },
            ]
          : []),
        ...(dayList(days) !== dayList(s.deliveryWeekdays)
          ? [{ label: 'Entrega', value: `${dayList(s.deliveryWeekdays)} → ${dayList(days)}` }]
          : []),
        ...(leadDays !== s.leadDays
          ? [{ label: 'Anticipación', value: `${s.leadDays} → ${leadDays} días` }]
          : []),
      ]
      if (!rows.length) return fail('Ya está así: no hay nada para cambiar.')
      const payload = supplierPayload.safeParse({
        id: s.id,
        name: s.name,
        contactName,
        whatsapp,
        deliveryWeekdays: days,
        leadDays,
        notes: s.notes,
        active: s.active,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'pedidos.proveedor',
          payload: payload.data,
          ticket: {
            kind: 'proveedor_compras',
            title: 'Proveedor de Compras',
            subtitle: s.name,
            rows,
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: 'Guardar el proveedor',
          },
        },
      }
    },
  }),
]

// ─── Lo que corre al tocar el botón ──────────────────────────────────────────

function orderState<D>(res: OrderResult, message: string, data: D): AccSimpleState<D> {
  return res.ok ? { ok: true, data, message } : failed(res.message)
}

const CHANGED_MEANWHILE =
  'No lo marqué como enviado: el pedido cambió desde que armé el tique (lo tocó otra persona o cambió el día de entrega). Si todavía no mandaste el WhatsApp, no lo mandes: pedime que lo arme de nuevo. Si ya lo mandaste, revisalo en Compras.'

/** Antes de marcarlo enviado: lo que se abrió en WhatsApp tiene que ser lo mismo que va a quedar guardado. */
async function sameMessage(
  payload: z.output<typeof sendPayload>,
  ctx: TexToolContext,
): Promise<string | null> {
  const [catalog, order] = await Promise.all([
    getCatalog(ctx.tenantId),
    getOrder(ctx.tenantId, payload.orderId),
  ])
  if (!order || order.status !== 'draft') {
    return 'No lo marqué como enviado: ese pedido ya no está para revisar (lo movió otra persona). Revisalo en Compras.'
  }
  const supplier =
    catalog.suppliers.find((s) => s.id === (payload.supplierId ?? order.supplierId)) ?? null
  const items = new Map(catalog.items.map((i) => [i.id, i]))
  const added = []
  for (const a of payload.added) {
    const item = items.get(a.itemId)
    if (!item) return CHANGED_MEANWHILE
    added.push({ item, packs: a.packs })
  }
  const outcome = draftOutcome({
    order,
    supplier,
    edit: {
      packs: new Map(payload.lines.map((l) => [l.id, l.orderedPacks])),
      added,
      note: payload.supplierNote,
    },
    senderName: senderOf(catalog, ctx),
    // La misma cuenta que va a hacer `approveOrder`, con el día de ahora.
    today: todayInCordoba(),
  })
  return outcome.message === payload.message ? null : CHANGED_MEANWHILE
}

export const pedidosExecutors: Readonly<Record<string, TexExecutor>> = {
  'pedidos.borrador': simpleExecutor(
    draftPayload,
    async ({ supplierName, ...payload }, ctx) =>
      orderState(await saveDraft({ slug: ctx.slug, ...payload }), 'Guardé el pedido.', {
        pedido_id: payload.orderId,
        proveedor: supplierName,
      }),
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.nuevo': simpleExecutor(
    newDraftPayload,
    async ({ supplierName, ...payload }, ctx): Promise<AccSimpleState<{ pedido_id: string }>> => {
      const res = await createDraft({ slug: ctx.slug, ...payload })
      return res.ok
        ? {
            ok: true,
            data: { pedido_id: res.orderId },
            message: `Armé el pedido a ${supplierName}: queda para revisar y mandar.`,
          }
        : failed(res.message)
    },
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.enviar': simpleExecutor(
    sendPayload,
    async (payload, ctx): Promise<AccSimpleState<{ pedido_id: string; proveedor: string }>> => {
      const problem = await sameMessage(payload, ctx)
      if (problem) return failed(problem)
      const { message, copy, supplierName, ...draft } = payload
      const res = await approveOrder({ slug: ctx.slug, ...draft })
      if (!res.ok) return failed(`No lo marqué como enviado: ${res.message}`)
      const done = copy
        ? `Copié el mensaje: pegalo en el chat de ${supplierName}. Quedó como enviado.`
        : `Quedó como enviado a ${supplierName}. Cuando conteste, confirmalo.`
      return {
        ok: true,
        data: { pedido_id: payload.orderId, proveedor: supplierName },
        message:
          res.message === message
            ? done
            : `${done} Ojo: el mensaje guardado no es igual al que se abrió; miralo en Compras.`,
      }
    },
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.confirmar': simpleExecutor(
    confirmPayload,
    async (payload, ctx) => {
      const res = payload.asIs
        ? await confirmOrder({ slug: ctx.slug, orderId: payload.orderId })
        : await confirmWithChanges({
            slug: ctx.slug,
            orderId: payload.orderId,
            lines: payload.lines,
            expectedDate: payload.expectedDate,
            kitchenNote: payload.kitchenNote,
          })
      return orderState(
        res,
        payload.asIs
          ? 'Quedó confirmado: la cocina ya lo ve para recibir.'
          : 'Quedó confirmado con los cambios: la cocina ya lo ve para recibir.',
        { pedido_id: payload.orderId, proveedor: payload.supplierName },
      )
    },
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.reclamo': simpleExecutor(
    claimPayload,
    async (payload, ctx): Promise<AccSimpleState<{ pedido_id: string }>> => {
      // Reclamar no cambia el pedido: queda con diferencias hasta que se cierra.
      const order = await getOrder(ctx.tenantId, payload.orderId)
      if (!order || order.status !== 'with_differences') {
        return failed('Ese pedido ya no está con diferencias: lo cerró otra persona.')
      }
      return {
        ok: true,
        data: { pedido_id: payload.orderId },
        message: payload.copy
          ? `Copié el reclamo: pegalo en el chat de ${payload.supplierName}. Cuando se resuelva, cerralo.`
          : `Abrí el reclamo a ${payload.supplierName}. Cuando se resuelva, cerralo.`,
      }
    },
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.estado': simpleExecutor(
    statePayload,
    async (payload, ctx) => {
      const input = { slug: ctx.slug, orderId: payload.orderId }
      const data = { pedido_id: payload.orderId, proveedor: payload.supplierName }
      switch (payload.accion) {
        case 'no_pedir':
          return orderState(
            await skipOrder(input),
            'Listo: hoy no se le pide. Lo que faltaba vuelve en el próximo conteo.',
            data,
          )
        case 'volver_a_borrador':
          return orderState(
            await backToDraft(input),
            'Volvió a borrador: corregilo y mandalo de nuevo.',
            data,
          )
        case 'cerrar':
          return orderState(
            await closeDifferences(input),
            'Cerrado. Lo que faltó vuelve solo en el próximo pedido sugerido.',
            data,
          )
      }
    },
    (_data, payload, ctx) => toPanel(ctx, payload.supplierName),
  ),

  'pedidos.proveedor': simpleExecutor(
    supplierPayload,
    async (payload, ctx): Promise<AccSimpleState<{ proveedor: string }>> => {
      const res = await saveSupplier({ slug: ctx.slug, ...payload })
      return res.ok
        ? { ok: true, data: { proveedor: payload.name }, message: `Guardé a ${payload.name}.` }
        : failed(res.message)
    },
    (_data, payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'pedidos.proveedores')
      return { href: link.ok ? link.href : null, point: payload.name }
    },
  ),
}
