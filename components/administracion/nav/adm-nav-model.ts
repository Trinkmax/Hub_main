import type { ResolvedSectionTab } from '@/components/shell/section-tabs-config'

/**
 * La navegación de Administración, en datos (sin React). Puro: lo usan `AdmNav` y los tests.
 *
 * Seis palabras arriba (reunión del 29/10/2026 y prototipo aprobado el 04/11): Resumen, Compras y
 * pagos, Gastos y sueldos, Ventas, Caja y Contabilidad. Cada una abre una planilla; lo que antes
 * eran píldoras sueltas son solapas de su sección. Importar ya no está en el menú (se arrastra el
 * archivo a cualquier pantalla) y la Guía y los Ajustes viven detrás del engranaje.
 *
 * Los permisos NO se deciden acá: entran las pestañas que ya resolvió
 * `resolveSection('administracion', …)` para quien mira, y una sección cuya pestaña no vino no
 * aparece. Las rutas viejas siguen valiendo: acá solo cambia cómo se llega.
 */

export type AdmAudience = 'owner' | 'accountant'

export type AdmSubItem = {
  value: string
  label: string
  /** Después de `/administracion`, con la barra inicial; puede llevar `?tab=`. */
  path: string
  /** Rutas que también marcan esta solapa. */
  also?: readonly string[]
}

export type AdmSectionDef = {
  value: 'resumen' | 'compras' | 'gastos' | 'ventas' | 'caja' | 'contabilidad'
  /** La pestaña de `SECTION_TABS.administracion` que la habilita. */
  tab: string
  label: string
  /** Para el celular, donde la fila se desliza. */
  shortLabel?: string
  path: string
  /** Rutas que también marcan esta sección. */
  also?: readonly string[]
  sub?: readonly AdmSubItem[]
  /** La acción fija de la sección, a la derecha de las solapas. */
  action?: { label: string; path: string }
}

export const ADM_SECTIONS: readonly AdmSectionDef[] = [
  { value: 'resumen', tab: 'resumen', label: 'Resumen', path: '' },
  {
    value: 'compras',
    tab: 'compras',
    label: 'Compras y pagos',
    shortLabel: 'Compras',
    path: '/compras',
    also: ['/comprobantes'],
    sub: [
      { value: 'proveedores', label: 'Proveedores', path: '/compras' },
      { value: 'semana', label: 'Plan de la semana', path: '/compras/semana' },
      { value: 'comprobantes', label: 'Comprobantes', path: '/compras?tab=comprobantes' },
    ],
  },
  {
    value: 'gastos',
    tab: 'gastos-fijos',
    label: 'Gastos y sueldos',
    shortLabel: 'Gastos',
    path: '/gastos-fijos',
    also: ['/compras/gastos-fijos', '/sueldos'],
    sub: [
      {
        value: 'fijos',
        label: 'Gastos fijos',
        path: '/gastos-fijos',
        also: ['/compras/gastos-fijos'],
      },
      { value: 'sueldos', label: 'Sueldos', path: '/sueldos' },
    ],
  },
  {
    value: 'ventas',
    tab: 'ventas',
    label: 'Ventas',
    path: '/ventas',
    sub: [
      { value: 'planilla', label: 'Proyección', path: '/ventas' },
      { value: 'cobrar', label: 'Por cobrar', path: '/ventas?tab=clientes' },
      { value: 'llego', label: 'Lo que llegó', path: '/ventas?tab=neto-por-medio' },
    ],
  },
  { value: 'caja', tab: 'cajas', label: 'Caja', path: '/cajas' },
  {
    value: 'contabilidad',
    tab: 'libros',
    label: 'Contabilidad',
    path: '/libros/sumas-y-saldos',
    also: ['/libros', '/asientos', '/plan-de-cuentas'],
    sub: [
      { value: 'sumas', label: 'Sumas y saldos', path: '/libros/sumas-y-saldos' },
      { value: 'mayor', label: 'Mayor', path: '/libros/mayor' },
      { value: 'diario', label: 'Libro diario', path: '/libros/diario' },
      {
        value: 'iva',
        label: 'IVA',
        path: '/libros/posicion-iva',
        also: ['/libros/iva-compras', '/libros/iva-ventas'],
      },
      { value: 'plan', label: 'Plan de cuentas', path: '/plan-de-cuentas' },
      { value: 'cierre', label: 'Cierre de mes', path: '/libros/cierres' },
    ],
    action: { label: 'Asiento manual', path: '/libros/asiento-manual' },
  },
]

export const ADM_SETTINGS = {
  value: 'ajustes',
  label: 'Ajustes',
  path: '/ajustes',
  also: ['/importar', '/guias', '/configurar'],
  sub: [
    { value: 'ajustes', label: 'Ajustes', path: '/ajustes' },
    { value: 'puesta', label: 'Puesta en marcha', path: '/guias/como-arrancar' },
    { value: 'guia', label: 'Guía', path: '/guias' },
    { value: 'importar', label: 'Importar', path: '/importar' },
  ],
} as const

export type AdmNavSection = {
  value: string
  label: string
  shortLabel?: string
  href: string
  also: readonly string[]
  exact: boolean
  sub: ReadonlyArray<{ value: string; label: string; href: string; also: readonly string[] }>
  action: { label: string; href: string } | null
}

export type AdmNavModel = {
  sections: AdmNavSection[]
  settings: AdmNavSection
}

function toSection(def: Omit<AdmSectionDef, 'value' | 'tab'> & { value: string }, base: string) {
  return {
    value: def.value,
    label: def.label,
    ...(def.shortLabel ? { shortLabel: def.shortLabel } : {}),
    href: `${base}${def.path}`,
    also: (def.also ?? []).map((p) => `${base}${p}`),
    exact: def.path === '',
    sub: (def.sub ?? []).map((s) => ({
      value: s.value,
      label: s.label,
      href: `${base}${s.path}`,
      also: (s.also ?? []).map((p) => `${base}${p}`),
    })),
    action: def.action ? { label: def.action.label, href: `${base}${def.action.path}` } : null,
  } satisfies AdmNavSection
}

/** La contadora llega a un comprobante desde el Mayor: para ella es parte de Contabilidad. */
function forAccountant(section: AdmSectionDef): AdmSectionDef {
  if (section.value === 'compras') {
    return { ...section, also: (section.also ?? []).filter((path) => path !== '/comprobantes') }
  }
  if (section.value === 'contabilidad') {
    return { ...section, also: [...(section.also ?? []), '/comprobantes'] }
  }
  return section
}

/**
 * Arma la barra con las pestañas que ve quien mira. La contadora no tiene Resumen (entra directo a
 * Sumas y saldos): su barra arranca por Contabilidad, que es donde trabaja.
 */
export function buildAdmNav(
  tabs: readonly Pick<ResolvedSectionTab, 'value'>[],
  { base, audience = 'owner' }: { base: string; audience?: AdmAudience },
): AdmNavModel {
  const allowed = new Set(tabs.map((t) => t.value))
  const visible = ADM_SECTIONS.filter((s) => allowed.has(s.tab))
  const ordered =
    audience === 'accountant'
      ? [
          ...visible.filter((s) => s.value === 'contabilidad'),
          ...visible.filter((s) => s.value !== 'contabilidad' && s.value !== 'resumen'),
        ].map(forAccountant)
      : visible
  return {
    sections: ordered.map((s) => toSection(s, base)),
    settings: toSection(ADM_SETTINGS, base),
  }
}

function pathOf(href: string): string {
  const path = href.split(/[?#]/)[0] ?? href
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function matches(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** ¿Qué sección marca esta ruta? La del prefijo más largo; `null` si ninguna. */
export function activeAdmSection(model: AdmNavModel, pathname: string): AdmNavSection | null {
  const current = pathOf(pathname)
  let best: AdmNavSection | null = null
  let bestLength = -1
  for (const section of [...model.sections, model.settings]) {
    const own = pathOf(section.href)
    const candidates = section.exact ? [] : [own, ...section.also.map(pathOf)]
    if (section.exact && current === own && own.length > bestLength) {
      best = section
      bestLength = own.length
    }
    for (const prefix of candidates) {
      if (matches(prefix, current) && prefix.length > bestLength) {
        best = section
        bestLength = prefix.length
      }
    }
  }
  return best
}

/**
 * ¿Qué solapa marca esta ruta? Gana la que coincide en ruta y en `?tab=`; si varias comparten ruta
 * (Proveedores y Comprobantes en `/compras`), la de la solapa sin `?tab=` es la de por defecto.
 */
export function activeAdmSub(
  section: AdmNavSection | null,
  pathname: string,
  search: string,
): string | null {
  if (!section || section.sub.length === 0) return null
  const current = pathOf(pathname)
  const tab = new URLSearchParams(search).get('tab')
  let best: string | null = null
  let bestLength = -1
  for (const sub of section.sub) {
    const own = pathOf(sub.href)
    const subTab = new URLSearchParams(sub.href.split('?')[1] ?? '').get('tab')
    if (subTab !== null) {
      if (current === own && tab === subTab) return sub.value
      continue
    }
    for (const prefix of [own, ...sub.also.map(pathOf)]) {
      if (matches(prefix, current) && prefix.length > bestLength) {
        best = sub.value
        bestLength = prefix.length
      }
    }
  }
  return best
}

/**
 * Las pantallas donde el flotante «＋ Cargar» del celular lo pone el marco de la sección: las de
 * primer nivel. Las sub-rutas son pantallas de tarea con su propio pie fijo.
 */
const FAB_FRAME_SCREENS = [
  '',
  '/ventas',
  '/compras',
  '/compras/semana',
  '/gastos-fijos',
  '/sueldos',
  '/cajas',
  '/libros/sumas-y-saldos',
  '/plan-de-cuentas',
] as const

/** ¿En esta pantalla el flotante lo dibuja el marco? `base` es `/<bar>/administracion`. */
export function admFabFromFrame(base: string, pathname: string): boolean {
  const root = pathOf(base)
  const current = pathOf(pathname)
  return FAB_FRAME_SCREENS.some((screen) => current === `${root}${screen}`)
}
