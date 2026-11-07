import 'server-only'

import { pedidosActionTools, pedidosExecutors } from '../tools/pedidos/actions'
import { pedidosManual } from '../tools/pedidos/manual'
import { pedidosReadTools } from '../tools/pedidos/read'
import type { TexArea } from './types'

/** Compras: los pedidos a los proveedores (`/compras`). Es del dueño y solo si el bar la tiene prendida. */
export const pedidosArea: TexArea = {
  id: 'pedidos',
  label: 'Compras: pedidos a proveedores',
  summary:
    'Los pedidos a los proveedores: lo que contó la cocina, armar y corregir pedidos, mandarlos por WhatsApp, confirmar lo que contestan y reclamar lo que llegó distinto. No son las facturas de Administración.',
  manual: pedidosManual,
  tools: [...pedidosReadTools, ...pedidosActionTools],
  executors: pedidosExecutors,
  visible: (ctx) => ctx.role === 'owner' && Boolean(ctx.features.purchasing),
}
