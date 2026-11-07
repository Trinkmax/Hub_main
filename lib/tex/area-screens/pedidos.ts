import { PURCHASING_MANAGE_ROLES } from '@/lib/tenant/roles'
import type { TexScreenDef } from '../screen-types'

/**
 * Compras (`/compras`): los pedidos a proveedores. Es del dueño y depende de que el bar la tenga prendida.
 * No es «Compras y pagos» de Administración. `tex-pedidos.test.ts` verifica que cada ruta exista.
 */
export const pedidosScreens: readonly TexScreenDef[] = [
  {
    id: 'pedidos.inicio',
    label: 'Compras › Pedidos',
    what: 'Los pedidos a proveedores: para revisar y mandar por WhatsApp, enviados, por llegar y con diferencias; los eventos de los próximos días y los datos para corregir.',
    path: '/compras',
    root: true,
    roles: PURCHASING_MANAGE_ROLES,
    feature: 'purchasing',
  },
  {
    id: 'pedidos.insumos',
    label: 'Compras › Insumos',
    what: 'La lista de lo que se cuenta y se pide: zona, unidad, objetivo, presentación y proveedor de cada uno, y las zonas del recorrido.',
    path: '/compras/insumos',
    root: true,
    roles: PURCHASING_MANAGE_ROLES,
    feature: 'purchasing',
  },
  {
    id: 'pedidos.recetas',
    label: 'Compras › Recetas',
    what: 'Las recetas de cada formato de evento, con sus variantes y para cuántas personas están.',
    path: '/compras/recetas',
    root: true,
    roles: PURCHASING_MANAGE_ROLES,
    feature: 'purchasing',
  },
  {
    id: 'pedidos.receta',
    label: 'Editar una receta',
    what: 'Los insumos de una receta y cuánto lleva de cada uno.',
    path: '/compras/recetas/:id',
    root: true,
    params: ['id'],
    roles: PURCHASING_MANAGE_ROLES,
    feature: 'purchasing',
  },
  {
    id: 'pedidos.proveedores',
    label: 'Compras › Proveedores',
    what: 'Los proveedores de Compras: WhatsApp, contacto, días de entrega y anticipación.',
    path: '/compras/proveedores',
    root: true,
    roles: PURCHASING_MANAGE_ROLES,
    feature: 'purchasing',
  },
]
