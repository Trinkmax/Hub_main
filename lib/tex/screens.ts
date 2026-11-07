import { isRealIsoDay, isRealYearMonth } from '@/lib/dates/civil'
import { canAccessManagerPath } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { agendaScreens } from './area-screens/agenda'
import { clientesScreens } from './area-screens/clientes'
import { mensajeriaScreens } from './area-screens/mensajeria'
import { negocioScreens } from './area-screens/negocio'
import { pedidosScreens } from './area-screens/pedidos'
import type { TexScreenDef, TexScreenParam } from './screen-types'

/**
 * Todas las pantallas del panel a las que Tex puede llevar. Es una lista cerrada a propósito:
 * Tex nunca arma una URL suelta, elige una pantalla de acá y el servidor arma el link. Lo que venga de
 * un dato (el nombre de un proveedor, una nota) no puede mandar a nadie a otro lado.
 *
 * `params` dice lo que esa pantalla lee de verdad de la URL: todas se llaman igual (`?mes=yyyy-MM`,
 * `?desde=&hasta=`, `?cuenta=`, `?semana=`, `?tab=`).
 *
 * Puro. `tex-screens.test.ts` verifica que cada ruta exista de verdad en `app/` y que cada parámetro lo
 * lea su pantalla.
 */

export type { TexScreenDef, TexScreenParam } from './screen-types'

/**
 * Lo que acepta `?tab=` en Ajustes (`ajustes/_lib/rooms.ts`): cualquier otra cosa abre la portada.
 * `participes` es la misma habitación que `medios`, con la lista de CUIT abierta.
 */
export const TEX_AJUSTES_TABS = [
  'sas',
  'cajas',
  'medios',
  'participes',
  'impuestos',
  'accesos',
  'arca',
  'puntos-de-venta',
  'ejercicio',
  'integridad',
] as const

export const TEX_ADMIN_SCREENS: readonly TexScreenDef[] = [
  {
    id: 'resumen',
    label: 'Resumen',
    what: 'La plata de hoy, lo que vence, cómo vienen las ventas y qué toca hacer.',
    path: '',
  },
  {
    id: 'compras.proveedores',
    label: 'Compras y pagos › Proveedores',
    what: 'Qué se le debe a cada proveedor y qué venció.',
    path: '/compras',
  },
  {
    id: 'compras.semana',
    label: 'Compras y pagos › Plan de la semana',
    what: 'Cuánto se le va a pagar a cada proveedor esta semana.',
    path: '/compras/semana',
    params: ['semana'],
  },
  {
    id: 'compras.comprobantes',
    label: 'Compras y pagos › Comprobantes',
    what: 'Todos los comprobantes, con y sin factura, con sus filtros.',
    path: '/compras',
    query: 'tab=comprobantes',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'compras.nueva',
    label: 'Cargar una compra',
    what: 'El formulario de la compra, con forma de factura.',
    path: '/compras/nueva',
  },
  {
    id: 'compras.nueva_y_pago',
    label: 'Cargar una compra y pago',
    what: 'La compra que se pagó en el momento.',
    path: '/compras/nueva',
    query: 'modo=pago',
  },
  {
    id: 'proveedor',
    label: 'Ficha de un proveedor',
    what: 'Sus datos, su cuenta corriente y sus comprobantes.',
    path: '/compras/proveedores/:id',
    params: ['id'],
  },
  {
    id: 'comprobante',
    label: 'Un comprobante',
    what: 'El comprobante con su asiento, sus adjuntos y cómo anularlo.',
    path: '/comprobantes/:id',
    params: ['id'],
  },
  {
    id: 'gastos.fijos',
    label: 'Gastos y sueldos › Gastos fijos',
    what: 'Lo que se paga todos los meses y cuál falta tildar. Abre este mes o el que viene.',
    path: '/gastos-fijos',
    params: ['mes'],
  },
  {
    id: 'gastos.completar',
    label: 'Completar los gastos fijos',
    what: 'Ponerles monto a los gastos fijos que no lo tienen.',
    path: '/gastos-fijos/completar',
  },
  {
    id: 'gasto_fijo',
    label: 'Un gasto fijo',
    what: 'Sus datos, sus cuotas y sus pagos.',
    path: '/compras/gastos-fijos/:id',
    params: ['id'],
  },
  {
    id: 'sueldos',
    label: 'Gastos y sueldos › Sueldos',
    what: 'Cada empleado: sueldo, adelantos, pagos y saldo.',
    path: '/sueldos',
    params: ['mes'],
  },
  {
    id: 'ventas.proyeccion',
    label: 'Ventas › Proyección',
    what: 'Objetivo y venta de cada día del mes, con Flojo, Normal y Fuerte; desde acá se carga el cierre.',
    path: '/ventas',
    params: ['mes'],
  },
  {
    id: 'ventas.cobrar',
    label: 'Ventas › Por cobrar',
    what: 'Lo que te deben tarjetas, plataformas y clientes.',
    path: '/ventas',
    query: 'tab=clientes',
  },
  {
    id: 'ventas.llego',
    label: 'Ventas › Lo que llegó',
    what: 'Cuánto llegó de cada medio de cobro y cuánto se descontó.',
    path: '/ventas',
    query: 'tab=neto-por-medio',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'ventas.facturas',
    label: 'Ventas › Facturas',
    what: 'Las facturas de venta sueltas.',
    path: '/ventas',
    query: 'tab=facturas',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'ventas.cobros',
    label: 'Ventas › Cobros',
    what: 'Los cobros ya cargados.',
    path: '/ventas',
    query: 'tab=cobros',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'ventas.cierre',
    label: 'Cierre del día',
    what: 'Cargar lo vendido del día y cómo te pagaron.',
    path: '/ventas/cierre',
    params: ['fecha'],
  },
  {
    id: 'ventas.nueva_factura',
    label: 'Nueva factura de venta',
    what: 'Una factura suelta, fuera del cierre.',
    path: '/ventas/nueva-factura',
  },
  {
    id: 'cliente',
    label: 'Ficha de un cliente',
    what: 'Lo que debe y lo que pagó.',
    path: '/ventas/clientes/:id',
    params: ['id'],
  },
  {
    id: 'caja',
    label: 'Caja',
    what: 'Cuánto hay en cada cuenta.',
    path: '/cajas',
  },
  {
    id: 'caja.detalle',
    label: 'Caja › Entró y salió',
    what: 'El flujo por mes, en qué se fue la plata y si alcanza para las próximas 4 semanas.',
    path: '/cajas',
    query: 'tab=flujo',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'caja.cuenta',
    label: 'Una cuenta de Caja',
    what: 'Los movimientos de una caja, banco o billetera.',
    path: '/cajas/:id',
    params: ['id', 'mes', 'desde', 'hasta'],
  },
  {
    id: 'caja.gasto_bancario',
    label: 'Gasto del banco',
    what: 'Cargar comisiones e impuestos que debitó el banco.',
    path: '/cajas/gasto-bancario',
  },
  {
    id: 'libros.sumas',
    label: 'Contabilidad › Sumas y saldos',
    what: 'El balance de sumas y saldos.',
    path: '/libros/sumas-y-saldos',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'libros.mayor',
    label: 'Contabilidad › Mayor',
    what: 'Los movimientos de una cuenta; de acá se reimputa.',
    path: '/libros/mayor',
    params: ['cuenta', 'mes', 'desde', 'hasta'],
  },
  {
    id: 'libros.diario',
    label: 'Contabilidad › Libro diario',
    what: 'Los asientos en orden.',
    path: '/libros/diario',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'libros.iva',
    label: 'Contabilidad › IVA',
    what: 'La posición de IVA del mes.',
    path: '/libros/posicion-iva',
    params: ['mes'],
  },
  {
    id: 'libros.iva_compras',
    label: 'Libro IVA compras',
    what: 'El libro IVA compras del mes.',
    path: '/libros/iva-compras',
    params: ['mes'],
  },
  {
    id: 'libros.iva_ventas',
    label: 'Libro IVA ventas',
    what: 'El libro IVA ventas del mes.',
    path: '/libros/iva-ventas',
    params: ['mes'],
  },
  {
    id: 'libros.subdiarios',
    label: 'Subdiarios',
    what: 'Los subdiarios de compras, ventas, caja y bancos.',
    path: '/libros/subdiarios',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'libros.cierres',
    label: 'Contabilidad › Cierre de mes',
    what: 'Cerrar y reabrir meses, y lo que falta para cerrar.',
    path: '/libros/cierres',
    params: ['mes'],
  },
  {
    id: 'libros.historia',
    label: 'Historia',
    what: 'Quién hizo qué y cuándo.',
    path: '/libros/historia',
    params: ['mes', 'desde', 'hasta'],
  },
  {
    id: 'libros.asiento_manual',
    label: 'Asiento manual',
    what: 'El formulario del asiento, con Debe y Haber.',
    path: '/libros/asiento-manual',
  },
  {
    id: 'asiento',
    label: 'Un asiento',
    what: 'Un asiento del libro con su comprobante.',
    path: '/asientos/:id',
    params: ['id'],
  },
  {
    id: 'plan_de_cuentas',
    label: 'Contabilidad › Plan de cuentas',
    what: 'Las cuentas del bar.',
    path: '/plan-de-cuentas',
    params: ['cuenta'],
  },
  {
    id: 'ajustes',
    label: 'Ajustes',
    what: `Datos del bar, impuestos, cajas, medios de cobro y accesos. Solapas: ${TEX_AJUSTES_TABS.join(', ')}.`,
    path: '/ajustes',
    params: ['tab'],
    tabs: TEX_AJUSTES_TABS,
  },
  {
    id: 'ajustes.arca',
    label: 'Ajustes › ARCA',
    what: 'Conectar ARCA para bajar comprobantes y facturar.',
    path: '/ajustes/arca',
  },
  {
    id: 'configurar',
    label: 'Configurar',
    what: 'La puesta a punto: cargar lo que había en cada caja y lo que se debía al arrancar.',
    path: '/configurar',
  },
  {
    id: 'importar',
    label: 'Importar',
    what: 'Traer comprobantes de ARCA, Mercado Pago o el banco.',
    path: '/importar',
  },
  {
    id: 'guia',
    label: 'Guía',
    what: 'Cómo se usa Administración.',
    path: '/guias',
  },
  {
    id: 'guia.dia_a_dia',
    label: 'Guía › El día a día',
    what: 'Una receta por situación, paso a paso.',
    path: '/guias/dia-a-dia',
  },
  {
    id: 'guia.factura',
    label: 'Guía › Con y sin factura',
    what: 'Qué cambia con cada papel.',
    path: '/guias/con-y-sin-factura',
  },
  {
    id: 'puesta_en_marcha',
    label: 'Puesta en marcha',
    what: 'Lo que falta para arrancar y la rutina de cada día, semana y mes.',
    path: '/guias/como-arrancar',
  },
]

export const TEX_SCREENS: readonly TexScreenDef[] = [
  ...TEX_ADMIN_SCREENS,
  ...clientesScreens,
  ...mensajeriaScreens,
  ...agendaScreens,
  ...negocioScreens,
  ...pedidosScreens,
]

export function texScreen(id: string): TexScreenDef | null {
  return TEX_SCREENS.find((s) => s.id === id) ?? null
}

/** Lo que hace falta saber de quien mira para decidir qué pantallas ve. */
export type TexScreenViewer = {
  role: TenantRole
  features: Readonly<Record<string, boolean>>
  /** Puede ver Administración. */
  accounting: boolean
}

/** ¿Esta persona puede ver esta pantalla? Las mismas reglas que el menú y el proxy. */
export function texScreenAllowed(screen: TexScreenDef, viewer: TexScreenViewer): boolean {
  if (screen.feature && !viewer.features[screen.feature]) return false
  if (screen.roles && !screen.roles.includes(viewer.role)) return false
  if (!screen.root) return viewer.accounting
  const head = screen.path.split('/').filter(Boolean)
  return canAccessManagerPath(viewer.role, head) && !(head.length === 0 && viewer.role !== 'owner')
}

export function texScreensFor(viewer: TexScreenViewer): TexScreenDef[] {
  return TEX_SCREENS.filter((screen) => texScreenAllowed(screen, viewer))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Solo se aceptan valores que la pantalla entiende: lo que no, no llega a la URL. Un mes o una fecha
 * que no existen abrirían la pantalla en «Ese mes no existe» en vez de abrirla.
 */
function validParam(name: TexScreenParam, value: string, screen: TexScreenDef): boolean {
  switch (name) {
    case 'id':
    case 'cuenta':
    case 'chat':
    case 'evento':
    case 'etiqueta':
      return UUID_RE.test(value)
    case 'estrellas':
      return /^[1-5]$/.test(value)
    case 'mes':
      return isRealYearMonth(value)
    case 'desde':
    case 'hasta':
    case 'semana':
    case 'fecha':
      return isRealIsoDay(value)
    case 'tab':
      return screen.tabs?.includes(value) ?? false
    case 'q':
      return value.length > 0 && value.length <= 60
  }
}

type RangeValues = Partial<Record<TexScreenParam, string | null | undefined>>

/** `?desde=&hasta=` va entero o no va: con una sola punta, o al revés, la pantalla abre en un error. */
function validRange(params: RangeValues): boolean {
  const { desde, hasta } = params
  return Boolean(desde && hasta && isRealIsoDay(desde) && isRealIsoDay(hasta) && desde <= hasta)
}

/** Cómo se llama cada parámetro en la URL de la pantalla. */
const URL_PARAM: Readonly<Record<Exclude<TexScreenParam, 'id'>, string>> = {
  mes: 'mes',
  cuenta: 'cuenta',
  desde: 'desde',
  hasta: 'hasta',
  semana: 'semana',
  fecha: 'fecha',
  tab: 'tab',
  q: 'q',
  chat: 'c',
  evento: 'evento',
  etiqueta: 'tag',
  estrellas: 'rating',
}

/** El nombre de un parámetro en la URL de esta pantalla. */
export function texScreenUrlName(
  screen: TexScreenDef,
  param: Exclude<TexScreenParam, 'id'>,
): string {
  return screen.urlNames?.[param] ?? URL_PARAM[param]
}

export type TexScreenLink = { ok: true; href: string; label: string } | { ok: false; error: string }

/**
 * El link de una pantalla. Un parámetro con mala forma se ignora (la pantalla abre igual), salvo el
 * `id`, sin el que la pantalla no existe.
 */
export function texScreenHref(
  slug: string,
  screenId: string,
  params: Partial<Record<TexScreenParam, string | null | undefined>> = {},
): TexScreenLink {
  const screen = texScreen(screenId)
  if (!screen) return { ok: false, error: `No existe la pantalla «${screenId}».` }
  let path = screen.path
  if (path.includes(':id')) {
    const id = params.id ?? ''
    if (!validParam('id', id, screen)) {
      return { ok: false, error: `Para abrir «${screen.label}» hace falta el id.` }
    }
    path = path.replace(':id', id)
  }
  const search = new URLSearchParams(screen.query ?? '')
  for (const name of screen.params ?? []) {
    if (name === 'id') continue
    if ((name === 'desde' || name === 'hasta') && !validRange(params)) continue
    const value = params[name]
    if (value && validParam(name, value, screen)) search.set(texScreenUrlName(screen, name), value)
  }
  const query = search.toString()
  return {
    ok: true,
    href: `/${slug}${screen.root ? '' : '/administracion'}${path}${query ? `?${query}` : ''}`,
    label: screen.label,
  }
}
