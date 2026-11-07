import 'server-only'

import { z } from 'zod'
import { getCatalog, getOrder, getOrders, getPanelData } from '@/lib/purchasing/queries'
import { PURCHASING_MANAGE_ROLES } from '@/lib/tenant/roles'
import { defineTool, type TexToolNeed, type TexToolResult } from '../types'
import {
  eventsData,
  filterStatuses,
  issuesData,
  itemsData,
  ORDER_FILTERS,
  openCountData,
  orderData,
  ordersData,
  pickSupplier,
  suppliersData,
} from './_values'

/**
 * Lo que Tex mira de Compras: los pedidos, los insumos y los proveedores. Lo mismo que el panel de quien
 * compra (`/compras`), que es del dueño: la RLS lo vuelve a decidir al leer.
 */
export const PEDIDOS_NEED: TexToolNeed = { roles: PURCHASING_MANAGE_ROLES, feature: 'purchasing' }

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

export const pedidosReadTools = [
  defineTool({
    name: 'ver_pedidos',
    description:
      'Los pedidos a proveedores: para revisar y mandar, enviados, por llegar, con diferencias o cerrados, con lo que lleva cada uno. Sin filtros suma si la cocina está contando, los eventos que vienen y los datos que faltan.',
    input: z.object({
      estado: z.enum(ORDER_FILTERS).optional().describe('Sin esto, los que están en curso.'),
      proveedor: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Solo los de este proveedor: nombre o id.'),
      pedido: z
        .uuid()
        .optional()
        .describe('Un pedido, renglón por renglón: lo que había, el objetivo y los eventos.'),
    }),
    need: PEDIDOS_NEED,
    doing: () => 'Mirando los pedidos',
    done: () => 'Miré los pedidos',
    run: async (input, ctx) => {
      if (input.pedido) {
        const [order, catalog] = await Promise.all([
          getOrder(ctx.tenantId, input.pedido),
          getCatalog(ctx.tenantId),
        ])
        if (!order) return fail('No encontré ese pedido: mirá los que hay con ver_pedidos.')
        const supplier = catalog.suppliers.find((s) => s.id === order.supplierId) ?? null
        return {
          kind: 'data',
          data: orderData({ order, supplier, today: ctx.today, detail: true }),
        }
      }

      const panel = await getPanelData(ctx.tenantId)
      const { suppliers } = panel.catalog
      let supplierId: string | null = null
      if (input.proveedor) {
        const picked = pickSupplier(suppliers, input.proveedor)
        if (!picked.ok) return fail(picked.message)
        supplierId = picked.value.id
      }
      const statuses = new Set(filterStatuses(input.estado))
      const orders = [
        ...panel.drafts,
        ...panel.sent,
        ...panel.confirmed,
        ...panel.differences,
        ...panel.closed,
      ].filter(
        (o) => statuses.has(o.status) && (supplierId === null || o.supplierId === supplierId),
      )
      const general = !input.estado && !input.proveedor
      return {
        kind: 'data',
        data: {
          ...(orders.length
            ? ordersData({ orders, suppliers, today: ctx.today })
            : { pedidos: 'no hay ninguno así' }),
          ...(general
            ? {
                cocina_contando: openCountData(panel.openCount) ?? 'no hay un conteo abierto',
                proximos_eventos: eventsData(panel.upcoming),
                datos_para_corregir: issuesData(panel.issues) ?? 'nada',
              }
            : {}),
        },
      }
    },
  }),

  defineTool({
    name: 'buscar_insumos',
    description:
      'Busca en la lista de insumos de Compras: cómo se compra cada uno, a qué proveedor, su objetivo y si ya está en un pedido para revisar. Para saber qué producto sumar a un pedido.',
    input: z.object({
      texto: z.string().trim().min(1).max(60).describe('Nombre, marca o código.'),
      proveedor: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Solo los de este proveedor.'),
    }),
    need: PEDIDOS_NEED,
    doing: () => 'Buscando en los insumos',
    done: () => 'Busqué en los insumos',
    run: async (input, ctx) => {
      const [catalog, drafts] = await Promise.all([
        getCatalog(ctx.tenantId),
        getOrders(ctx.tenantId, ['draft']),
      ])
      let supplierId: string | null = null
      if (input.proveedor) {
        const picked = pickSupplier(catalog.suppliers, input.proveedor)
        if (!picked.ok) return fail(picked.message)
        supplierId = picked.value.id
      }
      const names = new Map(catalog.suppliers.map((s) => [s.id, s.name]))
      const inDraft = new Map<string, string>()
      for (const order of drafts) {
        const who = order.supplierId ? (names.get(order.supplierId) ?? '') : 'Sin proveedor'
        for (const line of order.lines) if (line.itemId) inDraft.set(line.itemId, who)
      }
      return {
        kind: 'data',
        data: itemsData({
          items: catalog.items,
          suppliers: catalog.suppliers,
          inDraft,
          text: input.texto,
          supplierId,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_proveedores_compras',
    description:
      'Los proveedores de Compras: contacto, si tiene WhatsApp cargado, qué días entrega, con cuánta anticipación hay que pedirle y cuántos insumos le compramos. Con faltan_datos, solo los que no tienen WhatsApp o días.',
    input: z.object({
      texto: z.string().trim().min(1).max(60).optional().describe('Parte del nombre.'),
      faltan_datos: z.boolean().optional(),
    }),
    need: PEDIDOS_NEED,
    doing: () => 'Mirando los proveedores',
    done: () => 'Miré los proveedores',
    run: async (input, ctx) => {
      const catalog = await getCatalog(ctx.tenantId)
      return {
        kind: 'data',
        data: suppliersData({
          suppliers: catalog.suppliers,
          items: catalog.items,
          text: input.texto ?? null,
          missingOnly: input.faltan_datos ?? false,
        }),
      }
    },
  }),
]
