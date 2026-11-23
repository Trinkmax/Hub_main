/**
 * Qué pantallas del panel se miran por sucursal y cuáles son de todo el bar.
 *
 * En una pantalla de todo el bar (Mensajería, Club, la configuración general) el selector de arriba no filtra nada:
 * se atenúa y dice «Todo el bar», y lo elegido se guarda para cuando se vuelve a una pantalla por sucursal. La lista
 * crece a medida que cada sección aprende a mirar por sucursal (docs/features/sucursales.md › Qué se separa).
 *
 * Módulo puro: lo usan el selector (en el navegador) y las pruebas.
 */

/** Partes de la ruta, después de `/<bar>/`, que se miran por sucursal. Coinciden por segmentos enteros. */
const PER_BRANCH: ReadonlyArray<string> = [
  'reservas',
  'operativo',
  'eventos',
  'ventas-online',
  'entradas',
  'mis-numeros',
  'estadisticas/comisiones',
  'estadisticas/como-nos-fue',
  'estadisticas/senas',
  'configuracion/salon',
  'local/hoy',
  'local/mesas',
  'menu/precios',
  'salon',
  // Administración, entrega 1: lo de cada local (un solo libro). El resto de Administración (el Resumen,
  // Ventas, Sueldos, Contabilidad, Ajustes, la guía, Configurar e Importar) sigue siendo de todo el bar.
  'administracion/compras',
  'administracion/gastos-fijos',
  'administracion/cajas',
  'administracion/comprobantes',
]

export type BranchSectionScope = 'branch' | 'bar'

/** Adentro de una sección por sucursal, lo que igual es de todo el bar. */
const BAR_INSIDE: ReadonlyArray<string> = ['eventos/templates']

function startsWithSegments(rest: ReadonlyArray<string>, prefix: string): boolean {
  const parts = prefix.split('/')
  return parts.every((part, index) => rest[index] === part)
}

/** ¿La pantalla de esta ruta se mira por sucursal? `pathname` es la ruta entera (`/hub/reservas/nuevo`). */
export function branchScopeForPath(pathname: string, slug: string): BranchSectionScope {
  const segments = pathname.split('?')[0]?.split('/').filter(Boolean) ?? []
  if (segments[0] !== slug) return 'bar'
  const rest = segments.slice(1)
  // El Resumen: lo de la noche es de la sucursal (los clientes y el club dicen «de todo el bar»).
  if (rest.length === 0) return 'branch'
  if (BAR_INSIDE.some((prefix) => startsWithSegments(rest, prefix))) return 'bar'
  return PER_BRANCH.some((prefix) => startsWithSegments(rest, prefix)) ? 'branch' : 'bar'
}

/** El nombre de la sección de todo el bar, para explicar por qué el selector no filtra («Mensajería es…»). */
const BAR_SECTION_NAMES: ReadonlyArray<[string, string]> = [
  ['mensajeria', 'Mensajería'],
  ['club', 'El club'],
  ['clientes', 'Clientes'],
  ['menu', 'La carta'],
  ['tareas', 'Marketing'],
  ['enlaces', 'Marketing'],
  ['paginas', 'Marketing'],
  ['configuracion', 'La configuración'],
  ['local/sucursales', 'Sucursales'],
  // Lo de Administración que todavía es de todo el bar (entrega 1), con el nombre de su sección.
  ['administracion/ventas', 'Ventas'],
  ['administracion/sueldos', 'Sueldos'],
  ['administracion/libros', 'La contabilidad'],
  ['administracion/asientos', 'La contabilidad'],
  ['administracion/plan-de-cuentas', 'La contabilidad'],
  ['administracion/ajustes', 'Los ajustes de Administración'],
  ['administracion', 'Administración'],
  ['compras', 'Compras'],
  ['estadisticas', 'Estadísticas'],
  ['docs', 'La guía'],
]

/** Las pantallas que se nombran solas (la ruta entera, no un prefijo). */
const BAR_SCREEN_NAMES: ReadonlyArray<[string, string]> = [
  ['administracion', 'El resumen de Administración'],
]

export function barSectionName(pathname: string, slug: string): string {
  const segments = pathname.split('?')[0]?.split('/').filter(Boolean) ?? []
  if (segments[0] !== slug) return 'Esta pantalla'
  const rest = segments.slice(1)
  if (rest.length === 0) return 'El resumen'
  const exact = BAR_SCREEN_NAMES.find(([path]) => rest.join('/') === path)
  if (exact) return exact[1]
  const match = BAR_SECTION_NAMES.find(([prefix]) => startsWithSegments(rest, prefix))
  return match ? match[1] : 'Esta pantalla'
}
