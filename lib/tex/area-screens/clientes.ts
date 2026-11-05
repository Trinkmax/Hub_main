import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import type { TexScreenDef } from '../screen-types'

/** Lo que exige la página: `requireRole(access.role, ['owner'])`. */
const OWNER: readonly TenantRole[] = ['owner']
/** `requireRole(access.role, ['owner', 'cashier'])`: el canje y cerrar mesa. */
const OWNER_OR_CASHIER: readonly TenantRole[] = ['owner', 'cashier']

/** Las solapas de `/club` (`CLUB_TABS` de su página). */
export const TEX_CLUB_TABS = ['programa', 'aliados', 'bienvenida', 'punch'] as const

/**
 * Clientes y Club. Las solapas del Club abren `/club?tab=` directo: las viejas rutas `/club/aliados`,
 * `/club/puntos`… hoy solo redirigen ahí.
 */
export const clientesScreens: readonly TexScreenDef[] = [
  {
    id: 'clientes.lista',
    label: 'Clientes › Personas',
    what: 'La lista de clientes, con su buscador y los filtros por etiqueta, origen y última visita. Con q busca; con etiqueta (su id), solo los que la tienen.',
    path: '/clientes',
    root: true,
    params: ['q', 'etiqueta'],
    roles: OWNER,
  },
  {
    id: 'clientes.con_puntos',
    label: 'Clientes › Personas › Con puntos',
    what: 'Los clientes que ya consumieron.',
    path: '/clientes',
    root: true,
    query: 'programa=with_points',
    roles: OWNER,
  },
  {
    id: 'clientes.solo_contacto',
    label: 'Clientes › Personas › Solo contacto',
    what: 'Los clientes que todavía no tienen visitas.',
    path: '/clientes',
    root: true,
    query: 'programa=contact_only',
    roles: OWNER,
  },
  {
    id: 'clientes.reservas',
    label: 'Clientes › Personas › Reservas',
    what: 'Los clientes que entraron por una reserva.',
    path: '/clientes',
    root: true,
    query: 'segment=reserva',
    roles: OWNER,
  },
  {
    id: 'clientes.walkin',
    label: 'Clientes › Personas › Walk-in',
    what: 'Los clientes que entraron en el local: QR del club, caja o a mano.',
    path: '/clientes',
    root: true,
    query: 'segment=walkin',
    roles: OWNER,
  },
  {
    id: 'clientes.ficha',
    label: 'Ficha del cliente',
    what: 'Todo de un cliente: datos, teléfono, notas, avisos, puntos, visitas, canjes, su QR y cómo borrarlo.',
    path: '/clientes/:id',
    root: true,
    params: ['id'],
    roles: OWNER,
  },
  {
    id: 'clientes.canjear',
    label: 'Canjear puntos',
    what: 'Canjear los puntos de un cliente por una recompensa.',
    path: '/clientes/:id/canjear',
    root: true,
    params: ['id'],
    roles: OWNER_OR_CASHIER,
  },
  {
    id: 'clientes.nuevo',
    label: 'Nuevo cliente',
    what: 'El formulario para dar de alta un cliente a mano.',
    path: '/clientes/nuevo',
    root: true,
    roles: OWNER,
  },
  {
    id: 'clientes.acreditar',
    label: 'Clientes › Acreditar',
    what: 'El escáner de la caja: QR del socio para acreditar y sellar, QR de canje para entregarlo.',
    path: '/acreditar',
    root: true,
    roles: REDEMPTION_STAFF_ROLES,
  },
  {
    id: 'clientes.qr',
    label: 'Clientes › QR del club',
    what: 'Los dos QR para imprimir o mostrar: el de la carta y el del club.',
    path: '/local/captura',
    root: true,
    roles: OWNER,
  },
  {
    id: 'clientes.cerrar_mesa',
    label: 'Cerrar mesa',
    what: 'Registrar la visita de un cliente con lo que consumió de la carta y otorgar los puntos.',
    path: '/visitas/nueva',
    root: true,
    roles: OWNER_OR_CASHIER,
  },
  {
    id: 'club.inicio',
    label: 'Club',
    what: `El club de beneficios. Solapas: ${TEX_CLUB_TABS.join(', ')}.`,
    path: '/club',
    root: true,
    params: ['tab'],
    tabs: TEX_CLUB_TABS,
    roles: OWNER,
  },
  {
    id: 'club.puntos',
    label: 'Club › Puntos y niveles',
    what: 'Cómo se ganan los puntos (reglas), pagar con puntos y el catálogo de recompensas.',
    path: '/club',
    root: true,
    query: 'tab=programa',
    roles: OWNER,
  },
  {
    id: 'club.niveles',
    label: 'Club › Puntos y niveles › Niveles',
    what: 'Los niveles del club y los beneficios de cada uno.',
    path: '/club',
    root: true,
    query: 'tab=programa',
    roles: OWNER,
  },
  {
    id: 'club.aliados',
    label: 'Club › Aliados',
    what: 'Las marcas aliadas, sus logos y sus beneficios por nivel.',
    path: '/club',
    root: true,
    query: 'tab=aliados',
    roles: OWNER,
  },
  {
    id: 'club.bienvenida',
    label: 'Club › Bienvenida',
    what: 'El regalo de bienvenida y el aviso que invita a dejar los datos en la carta.',
    path: '/club',
    root: true,
    query: 'tab=bienvenida',
    roles: OWNER,
  },
  {
    id: 'club.punch_cards',
    label: 'Club › Punch cards',
    what: 'Las tarjetas de sellos: «6 cafés y el 7mo gratis».',
    path: '/club',
    root: true,
    query: 'tab=punch',
    roles: OWNER,
  },
  {
    id: 'club.simular',
    label: 'Club › Simular wallet',
    what: 'Probar la tarjeta del socio en todos sus estados, sin tocar datos reales.',
    path: '/club/simular',
    root: true,
    roles: OWNER,
  },
]
