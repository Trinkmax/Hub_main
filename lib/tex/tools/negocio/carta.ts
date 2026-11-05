import 'server-only'

import { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import {
  addTagsToItems,
  createItemTag,
  type TagActionState,
  updateItemTag,
} from '@/lib/item-tags/actions'
import { listItemTags } from '@/lib/item-tags/queries'
import {
  bulkItemTagsSchema,
  createItemTagSchema,
  updateItemTagSchema,
} from '@/lib/item-tags/schemas'
import {
  createCategory,
  createMenuItem,
  type MenuActionState,
  moveCategory,
  updateCategory,
  updateMenuItem,
} from '@/lib/menu/actions'
import { listMenu, type MenuCategory } from '@/lib/menu/queries'
import {
  createCategorySchema,
  createMenuItemSchema,
  moveCategorySchema,
  updateCategorySchema,
  updateMenuItemSchema,
} from '@/lib/menu/schemas'
import { categoryPathLabel } from '@/lib/menu/tree'
import { MENU_EDIT_ROLES } from '@/lib/tenant/roles'
import type { TexTicketWarning } from '../../protocol'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  defineTool,
  money,
  noInput,
  pesosField,
  pesosToCents,
  type TexExecution,
  type TexExecutor,
  type TexToolContext,
  type TexToolNeed,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import {
  applyPriceLines,
  type CategoryChange,
  canMoveInside,
  categoryChangeLabel,
  categoryChangeRows,
  categoryChangeWarnings,
  categoryData,
  categoryItems,
  DEFAULT_TAG_COLOR,
  effectiveChange,
  findCategory,
  findItem,
  findTag,
  ITEM_STATES,
  type ItemChange,
  itemChangeLabel,
  itemChangeRows,
  itemChangeSchema,
  itemChangeWarnings,
  itemsByState,
  itemUpdatePayload,
  menuOverview,
  nameSample,
  newCategoryFormData,
  newItemFormData,
  newItemWarnings,
  PRICE_MAX_ITEMS,
  type PriceRule,
  priceOutcome,
  pricePlan,
  priceRows,
  priceRuleText,
  priceWarnings,
  rootNameOf,
  searchItems,
  type TexMenu,
  tagFormData,
  tagRows,
  textKey,
  ticketWarning,
} from './_carta-values'

/**
 * La Carta: lo que usan los dueños y quien edita el contenido, las mismas acciones del formulario.
 * Nada de esto toca fotos ni videos (se suben en la pantalla) ni borra nada.
 */

const NEED: TexToolNeed = { roles: MENU_EDIT_ROLES }

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

const readMenu = (ctx: TexToolContext): Promise<TexMenu> => listMenu({ tenantId: ctx.tenantId })

const nameText = (description: string) => z.string().trim().min(1).describe(description)

/** La carta maneja pesos enteros: así los pide y los muestra el formulario. */
const priceField = (description: string) =>
  pesosField(description).int('La carta usa pesos enteros, sin centavos.')

/** Lo que devuelven las acciones de la carta, como lo lee `simpleExecutor`. */
function asSimple<D>(
  state: MenuActionState | TagActionState,
  data: D,
  okMessage: string,
): AccSimpleState<D> {
  return state.ok
    ? { ok: true, data, message: state.message ?? okMessage }
    : { ok: false, code: 'error', message: state.message }
}

/** Después de cambiar algo se vuelve a la carta; `point` es lo que se ve en su primer nivel. */
function cartaPlace(ctx: TexToolContext, point: string | null) {
  const link = texScreenHref(ctx.slug, 'carta.items')
  return { href: link.ok ? link.href : null, point }
}

function tagsPlace(ctx: TexToolContext, point: string | null) {
  const link = texScreenHref(ctx.slug, 'carta.etiquetas')
  return { href: link.ok ? link.href : null, point }
}

/** Los ids de las etiquetas que nombró, o lo que no se encontró. */
async function resolveTags(
  ctx: TexToolContext,
  names: readonly string[] | undefined,
): Promise<
  { ok: true; ids: string[]; nameOf: (id: string) => string } | { ok: false; message: string }
> {
  const tags = names && names.length > 0 ? await listItemTags(ctx.tenantId) : []
  const ids: string[] = []
  for (const name of names ?? []) {
    const found = findTag(tags, name)
    if (!found.ok) return { ok: false, message: found.message }
    ids.push(found.value.id)
  }
  return { ok: true, ids, nameOf: (id) => tags.find((tag) => tag.id === id)?.name ?? id }
}

/** Lo que se ve de esa categoría en el primer nivel de la Carta, después del cambio. */
function categoryPoint(menu: TexMenu, category: MenuCategory, change: CategoryChange) {
  if (change.parent_id) return rootNameOf(menu, change.parent_id)
  const staysRoot = change.parent_id === null || category.parent_id === null
  return staysRoot ? (change.name ?? category.name) : rootNameOf(menu, category.id)
}

// ─── Lo que recibe cada ejecutor ─────────────────────────────────────────────

const newItemPayload = z.object({ item: createMenuItemSchema, point: z.string().nullable() })

const itemChangePayload = z.object({
  id: z.uuid(),
  change: itemChangeSchema,
  name: z.string(),
  point: z.string().nullable(),
})

const pricePayload = z.object({
  lines: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        before: z.number().int(),
        after: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(PRICE_MAX_ITEMS),
  point: z.string().nullable(),
})

const newCategoryPayload = z.object({
  name: z.string(),
  parent_id: z.uuid().nullable(),
  point: z.string().nullable(),
})

const categoryChangePayload = z.object({
  id: z.uuid(),
  name: z.string().optional(),
  active: z.boolean().optional(),
  parent_id: z.uuid().nullable().optional(),
  point: z.string().nullable(),
})

const tagPayload = z.object({
  id: z.uuid().optional(),
  name: z.string(),
  color: z.string(),
})

const tagItemsPayload = bulkItemTagsSchema.extend({ tag_name: z.string() })

// ─── Las herramientas ────────────────────────────────────────────────────────

export const cartaTools = [
  defineTool({
    name: 'ver_carta',
    description:
      'La carta o menú. Sin categoría: las categorías con cuántos productos tienen y los totales. Con una categoría: sus productos con precio, si están pausados y si tienen foto.',
    input: z.object({
      categoria: nameText('La categoría: nombre o id. Sin esto, la carta por arriba.').optional(),
    }),
    need: NEED,
    doing: () => 'Mirando la carta',
    done: () => 'Miré la carta',
    run: async (input, ctx) => {
      const menu = await readMenu(ctx)
      if (!input.categoria) return { kind: 'data', data: menuOverview(menu) }
      const found = findCategory(menu, input.categoria)
      if (!found.ok) return fail(found.message)
      return { kind: 'data', data: categoryData(menu, found.value) }
    },
  }),

  defineTool({
    name: 'buscar_producto',
    description:
      'Busca un producto de la carta o menú (plato, trago, bebida) por nombre, descripción o categoría, y da su id, precio, si está pausado y si tiene foto.',
    input: z.object({ buscar: nameText('Parte del nombre o de la descripción.').max(80) }),
    need: NEED,
    doing: () => 'Buscando en la carta',
    done: () => 'Busqué en la carta',
    run: async (input, ctx) => ({
      kind: 'data',
      data: searchItems(await readMenu(ctx), input.buscar),
    }),
  }),

  defineTool({
    name: 'ver_productos_por_estado',
    description:
      'Los productos de la carta sin foto, sin descripción, sin precio, pausados (sin stock, sacados de la carta) o destacados. En toda la carta o en una categoría.',
    input: z.object({
      estado: z.enum(ITEM_STATES),
      categoria: nameText('Solo de esta categoría: nombre o id.').optional(),
    }),
    need: NEED,
    doing: () => 'Revisando la carta',
    done: () => 'Revisé la carta',
    run: async (input, ctx) => {
      const menu = await readMenu(ctx)
      if (!input.categoria) return { kind: 'data', data: itemsByState(menu, input.estado, null) }
      const found = findCategory(menu, input.categoria)
      if (!found.ok) return fail(found.message)
      return { kind: 'data', data: itemsByState(menu, input.estado, found.value) }
    },
  }),

  defineTool({
    name: 'ver_etiquetas',
    description:
      'Las etiquetas de la carta (vegano, sin TACC, picante) con su id y a cuántos productos van.',
    input: noInput,
    need: NEED,
    doing: () => 'Mirando las etiquetas',
    done: () => 'Miré las etiquetas',
    run: async (_input, ctx) => ({
      kind: 'data',
      data: tagRows(await listItemTags(ctx.tenantId)),
    }),
  }),

  defineTool({
    name: 'preparar_producto',
    description:
      'Prepara agregar un producto nuevo a la carta o menú: nombre, categoría y precio en pesos; descripción, destacado, puntos extra y etiquetas si los dijo. La foto se sube en la pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      nombre: nameText('Cómo se llama en la carta.').max(80),
      categoria: nameText('En qué categoría va: nombre o id.'),
      precio: priceField('En pesos enteros: 15500.'),
      descripcion: z.string().trim().max(300).optional().describe('Lo que lee el cliente.'),
      destacado: z.boolean().optional().describe('true: sale en Recomendados, arriba de la carta.'),
      puntos_extra: z.number().int().optional().describe('Puntos que suma además de los normales.'),
      etiquetas: z.array(z.string().trim().min(1)).max(10).optional().describe('Nombres o ids.'),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando el producto',
    done: () => 'Preparé el producto',
    run: async (input, ctx) => {
      const menu = await readMenu(ctx)
      const category = findCategory(menu, input.categoria)
      if (!category.ok) return fail(category.message)
      const tags = await resolveTags(ctx, input.etiquetas)
      if (!tags.ok) return fail(tags.message)

      const valid = createMenuItemSchema.safeParse({
        category_id: category.value.id,
        name: input.nombre,
        description: input.descripcion ?? null,
        price_cents: pesosToCents(input.precio),
        points_override: input.puntos_extra ?? null,
        image_url: null,
        video_url: null,
        featured: input.destacado === true,
        tag_ids: tags.ids,
      })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      const item = valid.data

      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.producto',
          payload: { item, point: rootNameOf(menu, item.category_id) },
          ticket: {
            kind: 'producto',
            title: 'Producto nuevo',
            subtitle: item.name,
            rows: [
              { label: 'Categoría', value: categoryPathLabel(menu.categories, item.category_id) },
              ...(item.description ? [{ label: 'Descripción', value: item.description }] : []),
              ...(item.featured ? [{ label: 'Destacado', value: 'Sí' }] : []),
              ...(item.points_override !== null
                ? [{ label: 'Puntos extra', value: String(item.points_override) }]
                : []),
              ...(item.tag_ids.length > 0
                ? [{ label: 'Etiquetas', value: item.tag_ids.map(tags.nameOf).join(', ') }]
                : []),
            ],
            total: { label: 'Precio', value: money(item.price_cents) },
            entry: [],
            warnings: newItemWarnings(item, menu),
            confirmLabel: 'Agregar a la carta',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_cambio_producto',
    description:
      'Prepara cambiarle a un producto de la carta el precio, nombre, descripción, categoría, puntos o etiquetas, destacarlo, o sacarlo del menú y volverlo a poner (pausarlo, sin stock). No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      producto: nameText('El producto: nombre o id.'),
      precio: priceField('El precio nuevo, en pesos enteros.').optional(),
      nombre: z.string().trim().min(1).max(80).optional(),
      descripcion: z.string().trim().max(300).optional().describe('Vacío: le saca la descripción.'),
      categoria: nameText('A qué categoría pasa: nombre o id.').optional(),
      disponible: z
        .boolean()
        .optional()
        .describe('false: sale de la carta (pausado, sin stock). true: vuelve a la carta.'),
      destacado: z.boolean().optional(),
      puntos_extra: z.number().int().nullable().optional().describe('null: le saca los puntos.'),
      suma_etiquetas: z.array(z.string().trim().min(1)).max(10).optional(),
      saca_etiquetas: z.array(z.string().trim().min(1)).max(10).optional(),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando el cambio',
    done: () => 'Preparé el cambio',
    run: async (input, ctx) => {
      const menu = await readMenu(ctx)
      const found = findItem(menu, input.producto)
      if (!found.ok) return fail(found.message)
      const item = found.value

      let categoryId: string | undefined
      if (input.categoria) {
        const category = findCategory(menu, input.categoria)
        if (!category.ok) return fail(category.message)
        categoryId = category.value.id
      }
      const tags = await resolveTags(ctx, [
        ...(input.suma_etiquetas ?? []),
        ...(input.saca_etiquetas ?? []),
      ])
      if (!tags.ok) return fail(tags.message)
      const addCount = input.suma_etiquetas?.length ?? 0

      const change: ItemChange = effectiveChange(item, {
        name: input.nombre,
        description: input.descripcion,
        price_cents: input.precio === undefined ? undefined : pesosToCents(input.precio),
        category_id: categoryId,
        active: input.disponible,
        featured: input.destacado,
        points_override: input.puntos_extra,
        tags_add: tags.ids.slice(0, addCount),
        tags_remove: tags.ids.slice(addCount),
      })
      if (Object.keys(change).length === 0) {
        return fail(`«${item.name}» ya está así: no hay nada para cambiar.`)
      }
      const valid = updateMenuItemSchema.safeParse(itemUpdatePayload(item, change))
      if (!valid.success) return fail(zodIssuesText(valid.error))

      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.cambio_producto',
          payload: {
            id: item.id,
            change,
            name: change.name ?? item.name,
            point: rootNameOf(menu, change.category_id ?? item.category_id),
          },
          ticket: {
            kind: 'cambio_producto',
            title: change.active === false ? 'Sacar de la carta' : 'Cambiar un producto',
            subtitle: `${item.name} · ${categoryPathLabel(menu.categories, item.category_id)}`,
            rows: itemChangeRows(item, change, menu, tags.nameOf),
            total:
              change.price_cents === undefined
                ? null
                : { label: 'Precio nuevo', value: money(change.price_cents) },
            entry: [],
            warnings: itemChangeWarnings(item, change, menu),
            confirmLabel: itemChangeLabel(change),
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_precios',
    description:
      'Prepara subir o bajar los precios de una categoría, de varios productos o de toda la carta o menú, en porcentaje o en pesos: un aumento, una actualización de precios. El tique muestra cuántos cambian y ejemplos. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      categoria: nameText('La categoría: nombre o id. Entran sus subcategorías.').optional(),
      productos: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(PRICE_MAX_ITEMS)
        .optional()
        .describe('En vez de una categoría, estos productos: nombres o ids.'),
      toda_la_carta: z.boolean().optional().describe('true: todos los productos de la carta.'),
      porcentaje: z
        .number()
        .min(-90)
        .max(300)
        .optional()
        .describe('En %: 10 sube un 10 %, -5 baja un 5 %.'),
      monto: z
        .number()
        .int()
        .min(-100_000_000)
        .max(100_000_000)
        .optional()
        .describe('En vez de un %, pesos a sumar a cada uno: 500 sube $ 500, -500 baja.'),
      redondear_a: z
        .enum(['1', '10', '50', '100', '500', '1000'])
        .optional()
        .describe('Múltiplo de pesos al que redondear. Si no lo dijo, a pesos enteros.'),
      sin_pausados: z.boolean().optional().describe('true: deja afuera los pausados.'),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando el cambio de precios',
    done: () => 'Preparé el cambio de precios',
    run: async (input, ctx) => {
      const scopes = [input.categoria, input.productos, input.toda_la_carta || undefined]
      if (scopes.filter((scope) => scope !== undefined).length !== 1) {
        return fail('Preguntale a qué se lo aplica: una categoría, unos productos o toda la carta.')
      }
      if ((input.porcentaje === undefined) === (input.monto === undefined)) {
        return fail('Preguntale cuánto: un porcentaje o un monto en pesos, uno de los dos.')
      }
      if (input.porcentaje === 0 || input.monto === 0) return fail('Con cero no cambia nada.')

      const menu = await readMenu(ctx)
      let pool: TexMenu['items']
      let scopeText: string
      let point: string | null = null
      if (input.categoria) {
        const category = findCategory(menu, input.categoria)
        if (!category.ok) return fail(category.message)
        pool = categoryItems(menu, category.value.id)
        scopeText = categoryPathLabel(menu.categories, category.value.id)
        point = rootNameOf(menu, category.value.id)
      } else if (input.productos) {
        pool = []
        for (const name of input.productos) {
          const found = findItem(menu, name)
          if (!found.ok) return fail(found.message)
          if (!pool.some((item) => item.id === found.value.id)) pool.push(found.value)
        }
        scopeText = nameSample(
          pool.map((item) => item.name),
          3,
        )
      } else {
        pool = menu.items
        scopeText = 'Toda la carta'
      }
      if (input.sin_pausados) pool = pool.filter((item) => item.active)

      const rule: PriceRule =
        input.porcentaje !== undefined
          ? { kind: 'percent', percent: input.porcentaje }
          : { kind: 'amount', cents: pesosToCents(input.monto ?? 0) }
      const step = Number(input.redondear_a ?? '1')
      const plan = pricePlan(pool, rule, step)
      if (plan.lines.length === 0) {
        return fail(
          pool.length === 0
            ? `En «${scopeText}» no hay productos.`
            : `En «${scopeText}» no cambia ningún precio con eso.`,
        )
      }
      if (plan.lines.length > PRICE_MAX_ITEMS) {
        return fail(
          `Son ${plan.lines.length} productos, más de los ${PRICE_MAX_ITEMS} que entran en un solo tique: hacelo por categoría.`,
        )
      }
      for (const line of plan.lines) {
        const item = pool.find((other) => other.id === line.id)
        if (!item) continue
        const valid = updateMenuItemSchema.safeParse(
          itemUpdatePayload(item, { price_cents: line.after }),
        )
        if (!valid.success) {
          return fail(`«${line.name}» no se puede guardar: ${zodIssuesText(valid.error)}`)
        }
      }

      const up = (input.porcentaje ?? input.monto ?? 0) > 0
      const payload = pricePayload.safeParse({ lines: plan.lines, point })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const count = plan.lines.length
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.precios',
          payload: payload.data,
          ticket: {
            kind: 'precios',
            title: up ? 'Aumento de precios' : 'Baja de precios',
            subtitle: `${scopeText} · ${priceRuleText(rule)}`,
            rows: priceRows(plan, step),
            total: { label: 'Productos que cambian', value: String(count) },
            entry: [],
            warnings: priceWarnings(plan, step),
            confirmLabel: `${up ? 'Subir' : 'Bajar'} ${count === 1 ? 'el precio' : `${count} precios`}`,
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_categoria',
    description:
      'Prepara crear una categoría de la carta o subcategoría, o cambiarle el nombre, pausarla, activarla o moverla dentro de otra. Borrar se hace en la pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      categoria: nameText('La que se cambia: nombre o id. Sin esto, es una nueva.').optional(),
      nombre: z.string().trim().min(1).max(60).optional().describe('El nombre, o el nuevo.'),
      dentro_de: nameText('Adentro de qué categoría va: nombre o id.').optional(),
      al_primer_nivel: z.boolean().optional().describe('true: la saca de adentro de otra.'),
      disponible: z
        .boolean()
        .optional()
        .describe('false: la pausa y sus productos no se ven. true: la activa.'),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando la categoría',
    done: () => 'Preparé la categoría',
    run: async (input, ctx) => {
      const menu = await readMenu(ctx)
      let parentId: string | null | undefined
      if (input.dentro_de) {
        const parent = findCategory(menu, input.dentro_de)
        if (!parent.ok) return fail(parent.message)
        parentId = parent.value.id
      } else if (input.al_primer_nivel) {
        parentId = null
      }

      if (!input.categoria) {
        if (!input.nombre) return fail('Preguntale cómo se llama la categoría nueva.')
        const valid = createCategorySchema.safeParse({
          name: input.nombre,
          image_url: null,
          parent_id: parentId ?? null,
        })
        if (!valid.success) return fail(zodIssuesText(valid.error))
        const { name, parent_id } = valid.data
        const twin = menu.categories.some(
          (c) => c.parent_id === parent_id && textKey(c.name) === textKey(name),
        )
        const warnings: TexTicketWarning[] = [
          ticketWarning(
            'sin_productos',
            'No se ve en la carta pública hasta que tenga productos. La foto se sube desde la Carta.',
          ),
          ...(twin ? [ticketWarning('duplicado', `Ya hay una categoría «${name}» ahí.`)] : []),
        ]
        return {
          kind: 'prepared',
          prepared: {
            executor: 'negocio.categoria_nueva',
            payload: {
              name,
              parent_id,
              point: parent_id ? rootNameOf(menu, parent_id) : name,
            },
            ticket: {
              kind: 'categoria',
              title: parent_id ? 'Subcategoría nueva' : 'Categoría nueva',
              subtitle: name,
              rows: parent_id
                ? [
                    {
                      label: 'Adentro de',
                      value: categoryPathLabel(menu.categories, parent_id),
                    },
                  ]
                : [],
              total: null,
              entry: [],
              warnings,
              confirmLabel: 'Crear la categoría',
            },
          },
        }
      }

      const found = findCategory(menu, input.categoria)
      if (!found.ok) return fail(found.message)
      const category = found.value
      if (parentId && !canMoveInside(menu, category.id, parentId)) {
        return fail(`«${category.name}» no se puede mover adentro de sí misma.`)
      }
      const change: CategoryChange = {
        ...(input.nombre !== undefined && input.nombre !== category.name
          ? { name: input.nombre }
          : {}),
        ...(input.disponible !== undefined && input.disponible !== category.active
          ? { active: input.disponible }
          : {}),
        ...(parentId !== undefined && parentId !== category.parent_id
          ? { parent_id: parentId }
          : {}),
      }
      if (Object.keys(change).length === 0) {
        return fail(`«${category.name}» ya está así: no hay nada para cambiar.`)
      }
      const valid = updateCategorySchema.safeParse({
        id: category.id,
        name: change.name ?? category.name,
        active: change.active ?? category.active,
        image_url: category.image_url,
      })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      if (change.parent_id !== undefined) {
        const move = moveCategorySchema.safeParse({ id: category.id, parent_id: change.parent_id })
        if (!move.success) return fail(zodIssuesText(move.error))
      }
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.categoria',
          payload: {
            id: category.id,
            ...change,
            point: categoryPoint(menu, category, change),
          },
          ticket: {
            kind: 'categoria',
            title: change.active === false ? 'Pausar una categoría' : 'Cambiar una categoría',
            subtitle: categoryPathLabel(menu.categories, category.id),
            rows: categoryChangeRows(category, change, menu),
            total: null,
            entry: [],
            warnings: categoryChangeWarnings(category, change, menu),
            confirmLabel: categoryChangeLabel(change),
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_etiqueta',
    description:
      'Prepara crear una etiqueta de la carta (vegano, sin TACC, picante) o cambiarle el nombre o el color. Borrarla se hace en la pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      etiqueta: nameText('La que se cambia: nombre o id. Sin esto, es una nueva.').optional(),
      nombre: z.string().trim().min(1).max(40).optional().describe('El nombre, o el nuevo.'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('Hexadecimal: #94a3b8. Si no lo dijo, el de siempre.'),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando la etiqueta',
    done: () => 'Preparé la etiqueta',
    run: async (input, ctx) => {
      const tags = await listItemTags(ctx.tenantId)
      if (!input.etiqueta) {
        if (!input.nombre) return fail('Preguntale cómo se llama la etiqueta nueva.')
        const name = input.nombre
        if (tags.some((tag) => textKey(tag.name) === textKey(name))) {
          return fail(`Ya hay una etiqueta «${name}».`)
        }
        const valid = createItemTagSchema.safeParse({
          name,
          color: input.color ?? DEFAULT_TAG_COLOR,
        })
        if (!valid.success) return fail(zodIssuesText(valid.error))
        return {
          kind: 'prepared',
          prepared: {
            executor: 'negocio.etiqueta',
            payload: valid.data,
            ticket: {
              kind: 'etiqueta',
              title: 'Etiqueta nueva',
              subtitle: valid.data.name,
              rows:
                valid.data.color === DEFAULT_TAG_COLOR
                  ? []
                  : [{ label: 'Color', value: valid.data.color }],
              total: null,
              entry: [],
              warnings: [],
              confirmLabel: 'Crear la etiqueta',
            },
          },
        }
      }

      const found = findTag(tags, input.etiqueta)
      if (!found.ok) return fail(found.message)
      const tag = found.value
      const name = input.nombre ?? tag.name
      const color = input.color ?? tag.color
      if (name === tag.name && color === tag.color) {
        return fail(`«${tag.name}» ya está así: no hay nada para cambiar.`)
      }
      if (tags.some((other) => other.id !== tag.id && textKey(other.name) === textKey(name))) {
        return fail(`Ya hay otra etiqueta «${name}».`)
      }
      const valid = updateItemTagSchema.safeParse({ id: tag.id, name, color })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      const uses = tag.assignment_count ?? 0
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.etiqueta',
          payload: valid.data,
          ticket: {
            kind: 'etiqueta',
            title: 'Cambiar una etiqueta',
            subtitle: tag.name,
            rows: [
              ...(name !== tag.name ? [{ label: 'Nombre', value: `${tag.name} → ${name}` }] : []),
              ...(color !== tag.color
                ? [{ label: 'Color', value: `${tag.color} → ${color}` }]
                : []),
            ],
            total: null,
            entry: [],
            warnings:
              uses > 0
                ? [
                    ticketWarning(
                      'en_uso',
                      `Cambia en ${uses === 1 ? 'el producto que la tiene' : `los ${uses} productos que la tienen`}, también en la carta pública.`,
                    ),
                  ]
                : [],
            confirmLabel: 'Guardar la etiqueta',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_etiquetar',
    description:
      'Prepara ponerle una etiqueta de la carta a varios productos a la vez, o a todos los de una categoría. Para sacarle una a un producto: preparar_cambio_producto. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      etiqueta: nameText('La etiqueta, que ya tiene que existir: nombre o id.'),
      productos: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(100)
        .optional()
        .describe('Los productos: nombres o ids.'),
      categoria: nameText('O todos los de esta categoría: nombre o id.').optional(),
    }),
    need: NEED,
    mood: 'working',
    doing: () => 'Preparando las etiquetas',
    done: () => 'Preparé las etiquetas',
    run: async (input, ctx) => {
      if ((input.productos === undefined) === (input.categoria === undefined)) {
        return fail('Preguntale a qué le pone la etiqueta: unos productos o una categoría.')
      }
      const [menu, tags] = await Promise.all([readMenu(ctx), listItemTags(ctx.tenantId)])
      const tag = findTag(tags, input.etiqueta)
      if (!tag.ok) return fail(tag.message)

      let pool: TexMenu['items'] = []
      if (input.categoria) {
        const category = findCategory(menu, input.categoria)
        if (!category.ok) return fail(category.message)
        pool = categoryItems(menu, category.value.id)
      }
      for (const name of input.productos ?? []) {
        const found = findItem(menu, name)
        if (!found.ok) return fail(found.message)
        if (!pool.some((item) => item.id === found.value.id)) pool.push(found.value)
      }
      const pending = pool.filter((item) => !item.tags.some((t) => t.id === tag.value.id))
      if (pending.length === 0) {
        return fail(
          pool.length === 0
            ? 'En esa categoría no hay productos.'
            : `Ya tienen todos la etiqueta «${tag.value.name}».`,
        )
      }
      const valid = bulkItemTagsSchema.safeParse({
        item_ids: pending.map((item) => item.id),
        tag_ids: [tag.value.id],
      })
      if (!valid.success) return fail(zodIssuesText(valid.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.etiquetar',
          payload: { ...valid.data, tag_name: tag.value.name },
          ticket: {
            kind: 'etiquetar',
            title: 'Poner una etiqueta',
            subtitle: tag.value.name,
            rows: [{ label: 'A', value: nameSample(pending.map((item) => item.name)) }],
            total: { label: 'Productos', value: String(pending.length) },
            entry: [],
            warnings: [
              ticketWarning('carta_publica', 'Se ve ya en la carta pública apenas confirmes.'),
            ],
            confirmLabel:
              pending.length === 1 ? 'Poner la etiqueta' : `Etiquetar ${pending.length}`,
          },
        },
      }
    },
  }),
]

// ─── Lo que se ejecuta al confirmar ──────────────────────────────────────────

async function runPrices(raw: unknown, ctx: TexToolContext): Promise<TexExecution> {
  const parsed = pricePayload.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, kind: 'failed', message: 'El tique está roto: armalo de nuevo.' }
  }
  const menu = await readMenu(ctx)
  const run = await applyPriceLines(parsed.data.lines, menu.items, async (payload) =>
    updateMenuItem(ctx.slug, payload),
  )
  const outcome = priceOutcome(run)
  if (!outcome.ok) return { ok: false, kind: 'failed', message: outcome.message }
  const place = cartaPlace(ctx, parsed.data.point)
  return {
    ok: true,
    message: outcome.message,
    href: place.href,
    point: place.point,
    undoUntil: null,
    data: { cambiados: run.done.length, sin_tocar: run.stale.map((line) => line.name) },
  }
}

export const cartaExecutors: Readonly<Record<string, TexExecutor>> = {
  'negocio.producto': simpleExecutor(
    newItemPayload,
    async (payload, ctx) =>
      asSimple(
        await createMenuItem(ctx.slug, { ok: true }, newItemFormData(payload.item)),
        { name: payload.item.name },
        `Agregué «${payload.item.name}» a la carta.`,
      ),
    (_data, payload, ctx) => cartaPlace(ctx, payload.point),
  ),

  'negocio.cambio_producto': simpleExecutor(
    itemChangePayload,
    async (payload, ctx): Promise<AccSimpleState<{ id: string }>> => {
      // Se vuelve a leer: `updateMenuItem` escribe la foto y el resto de lo que le mandan.
      const menu = await readMenu(ctx)
      const item = menu.items.find((other) => other.id === payload.id)
      if (!item) {
        return { ok: false, code: 'stale', message: 'Ese producto ya no está en la carta.' }
      }
      return asSimple(
        await updateMenuItem(ctx.slug, itemUpdatePayload(item, payload.change)),
        { id: payload.id },
        payload.change.active === false
          ? `Saqué «${payload.name}» de la carta.`
          : payload.change.active === true
            ? `«${payload.name}» volvió a la carta.`
            : `Cambié «${payload.name}».`,
      )
    },
    (_data, payload, ctx) => cartaPlace(ctx, payload.point),
  ),

  'negocio.precios': { run: runPrices },

  'negocio.categoria_nueva': simpleExecutor(
    newCategoryPayload,
    async (payload, ctx) =>
      asSimple(
        await createCategory(ctx.slug, { ok: true }, newCategoryFormData(payload)),
        { name: payload.name },
        `Creé la categoría «${payload.name}».`,
      ),
    (_data, payload, ctx) => cartaPlace(ctx, payload.point),
  ),

  'negocio.categoria': simpleExecutor(
    categoryChangePayload,
    async (payload, ctx): Promise<AccSimpleState<{ id: string }>> => {
      const menu = await readMenu(ctx)
      const category = menu.categories.find((other) => other.id === payload.id)
      if (!category) {
        return { ok: false, code: 'stale', message: 'Esa categoría ya no está en la carta.' }
      }
      const data = { id: payload.id }
      const edits = payload.name !== undefined || payload.active !== undefined
      if (edits) {
        const saved = await updateCategory(ctx.slug, {
          id: category.id,
          name: payload.name ?? category.name,
          active: payload.active ?? category.active,
          // Se vuelve a leer: la acción escribe la foto que le mandan.
          image_url: category.image_url,
        })
        if (!saved.ok) return asSimple(saved, data, '')
      }
      if (payload.parent_id !== undefined) {
        const moved = await moveCategory(ctx.slug, {
          id: category.id,
          parent_id: payload.parent_id,
        })
        if (!moved.ok) {
          return {
            ok: false,
            code: 'error',
            message: edits
              ? `Guardé el nombre y el estado, pero no se pudo mover: ${moved.message}`
              : moved.message,
          }
        }
      }
      return { ok: true, data, message: `Listo: cambié «${payload.name ?? category.name}».` }
    },
    (_data, payload, ctx) => cartaPlace(ctx, payload.point),
  ),

  'negocio.etiqueta': simpleExecutor(
    tagPayload,
    async (payload, ctx) => {
      const form = tagFormData(payload)
      const state = payload.id
        ? await updateItemTag(ctx.slug, { ok: false, message: '' }, form)
        : await createItemTag(ctx.slug, { ok: false, message: '' }, form)
      return asSimple(
        state,
        { name: payload.name },
        payload.id
          ? `Guardé la etiqueta «${payload.name}».`
          : `Creé la etiqueta «${payload.name}».`,
      )
    },
    (data, _payload, ctx) => tagsPlace(ctx, `#${data.name}`),
  ),

  'negocio.etiquetar': simpleExecutor(
    tagItemsPayload,
    async (payload, ctx) =>
      asSimple(
        await addTagsToItems(ctx.slug, { item_ids: payload.item_ids, tag_ids: payload.tag_ids }),
        { name: payload.tag_name },
        `Puse la etiqueta «${payload.tag_name}».`,
      ),
    (data, _payload, ctx) => tagsPlace(ctx, `#${data.name}`),
  ),
}
