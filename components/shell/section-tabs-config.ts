import { type FeatureKey, getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { gateAllows, type NavViewer } from './nav-config'
import type { SectionTabItem } from './section-tabs'

/**
 * Las pestañas de sección del panel: las partes de cada sección, arriba de la página.
 *
 * El sidebar tiene UNA entrada por sección, sin desplegables ni sub-ítems (pedido del dueño,
 * 07/10/2026: «se presta mucho a confusión los desplegables… la idea siempre es que haya la
 * menor cantidad posible»). Lo que antes colgaba de cada entrada vive acá, como pestañas arriba
 * de la página. Club, Mensajería y Configuración ya tenían su navegación propia y no están.
 *
 * Datos puros (sin I/O): los layouts resuelven las pestañas con quién mira (`SectionViewer`) y
 * `SectionTabsBar` marca la activa con la URL. Las reglas de permiso son las mismas que tenían
 * las entradas del sidebar; la página y la base vuelven a decidir todo, esto solo muestra.
 */

export type SectionKey = 'clientes' | 'marketing' | 'estadisticas' | 'administracion'

export type SectionTabDef = {
  value: string
  label: string
  /** Etiqueta corta para el celular. */
  shortLabel?: string
  /** Ruta después del slug, sin barra inicial (`clientes`, `administracion/compras`). */
  path: string
  /**
   * `true`: activa solo en esa ruta exacta. Si no, también en sus sub-rutas (la ficha de un
   * cliente queda en «Personas»).
   */
  exact?: boolean
  /** Si está, solo la ven estos roles. */
  roles?: readonly TenantRole[]
  /** Si está, solo con la feature prendida (o si mira un superadmin, salvo `accounting`). */
  feature?: FeatureKey
  /**
   * Administración: el acceso por persona. `read` = quien puede ver los libros (contadora o
   * dueño habilitado); `read_or_setup` = también el dueño que puede hacer la puesta en marcha.
   */
  accounting?: 'read' | 'read_or_setup'
}

export type SectionDef = {
  /** Nombre accesible de la barra: «Secciones de Clientes». */
  label: string
  tabs: readonly SectionTabDef[]
  /**
   * Mostrar la barra aunque la página no sea de ninguna pestaña (sin ninguna marcada). Si no, en
   * esas páginas la barra no aparece.
   */
  showWhenNoneActive?: boolean
}

const ACCOUNTING_ROLES: readonly TenantRole[] = ['owner', 'accountant']

export const SECTION_TABS: Readonly<Record<SectionKey, SectionDef>> = {
  // Toda la sección es del dueño (el proxy, el layout del panel y cada página lo exigen).
  clientes: {
    label: 'Secciones de Clientes',
    tabs: [
      // Por prefijo: la ficha (/clientes/[id]), el alta y el canje quedan en Personas.
      { value: 'personas', label: 'Personas', path: 'clientes' },
      { value: 'acreditar', label: 'Acreditar', path: 'acreditar' },
      { value: 'qr', label: 'QR del club', path: 'local/captura' },
    ],
  },
  // Owner-only: es la mesa de los socios.
  marketing: {
    label: 'Secciones de Marketing',
    tabs: [
      { value: 'tareas', label: 'Tareas', path: 'tareas' },
      { value: 'enlaces', label: 'Link de Instagram', path: 'enlaces' },
      // Exacta a propósito: el editor de una página (/paginas/[id]) se queda sin la barra. Ocupa
      // la pantalla con sus propias alturas y su «Volver» pregunta antes de perder cambios sin
      // guardar; tres links más arriba se los saltearían.
      { value: 'paginas', label: 'Páginas', path: 'paginas', exact: true },
    ],
  },
  // Owner-only, como antes en el sidebar.
  estadisticas: {
    label: 'Secciones de Estadísticas',
    tabs: [
      { value: 'resumen', label: 'Resumen', path: 'estadisticas', exact: true },
      { value: 'como-nos-fue', label: 'Cómo nos fue', path: 'estadisticas/como-nos-fue' },
      { value: 'senas', label: 'Señas', path: 'estadisticas/senas' },
      // Por prefijo: la liquidación de cada gestor (/comisiones/[id]) queda en Comisiones.
      { value: 'comisiones', label: 'Comisiones', path: 'estadisticas/comisiones' },
      // La misma puerta que tenía «Reseñas» en el sidebar: dueño + feature (o superadmin).
      { value: 'resenas', label: 'Reseñas', path: 'reviews', roles: ['owner'], feature: 'reviews' },
    ],
  },
  // Las mismas puertas que tenían los seis ítems del sidebar. Las fichas (comprobantes/[id],
  // asientos/[id]), Ajustes y Configurar no son de ninguna pestaña: la barra queda sin marca.
  administracion: {
    label: 'Secciones de Administración',
    showWhenNoneActive: true,
    tabs: [
      {
        value: 'resumen',
        label: 'Resumen',
        path: 'administracion',
        exact: true,
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read_or_setup',
      },
      {
        value: 'compras',
        label: 'Compras',
        path: 'administracion/compras',
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read',
      },
      {
        value: 'ventas',
        label: 'Ventas',
        path: 'administracion/ventas',
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read',
      },
      {
        value: 'cajas',
        label: 'Cajas',
        path: 'administracion/cajas',
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read',
      },
      {
        value: 'libros',
        label: 'Libros',
        path: 'administracion/libros',
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read',
      },
      {
        value: 'plan-de-cuentas',
        label: 'Plan de cuentas',
        path: 'administracion/plan-de-cuentas',
        roles: ACCOUNTING_ROLES,
        feature: 'accounting',
        accounting: 'read',
      },
    ],
  },
}

/** Quién mira: lo mismo que usa el sidebar, salido de `requireTenantAccess`. */
export type SectionViewer = NavViewer

export function sectionViewer(access: {
  tenant: Pick<Tenant, 'feature_flags'>
  role: TenantRole
  isPlatformAdmin: boolean
  accounting: AccountingAccess
}): SectionViewer {
  return {
    role: access.role,
    features: getTenantFeatures(access.tenant),
    isPlatformAdmin: access.isPlatformAdmin,
    accounting: access.accounting,
  }
}

function isGated(tab: SectionTabDef): boolean {
  return Boolean(tab.roles || tab.feature || tab.accounting)
}

/** ¿Hace falta saber quién mira? Solo si alguna pestaña de la sección tiene permiso. */
export function sectionNeedsViewer(section: SectionKey): boolean {
  return SECTION_TABS[section].tabs.some(isGated)
}

/**
 * ¿Ve esta pestaña? La MISMA regla que las entradas del sidebar (`gateAllows`, nav-config.ts):
 * rol, feature (el superadmin la saltea, salvo `accounting`, que decide la base) y acceso a
 * Administración. Sin `viewer`, las pestañas con alguna puerta no se muestran (falla cerrado).
 */
export function tabVisible(tab: SectionTabDef, viewer?: SectionViewer | null): boolean {
  if (!isGated(tab)) return true
  if (!viewer) return false
  return gateAllows(tab, viewer)
}

/** Una pestaña lista para la barra: href resuelto y cómo se marca activa. Serializable. */
export type ResolvedSectionTab = SectionTabItem & { exact?: boolean }

export type ResolvedSection = {
  label: string
  tabs: ResolvedSectionTab[]
  showWhenNoneActive: boolean
}

/** Las pestañas que ve `viewer` en la sección, con el href del bar (`slug`). */
export function resolveSection(
  section: SectionKey,
  slug: string,
  viewer?: SectionViewer | null,
): ResolvedSection {
  const def = SECTION_TABS[section]
  return {
    label: def.label,
    showWhenNoneActive: def.showWhenNoneActive ?? false,
    tabs: def.tabs
      .filter((tab) => tabVisible(tab, viewer))
      .map((tab) => ({
        value: tab.value,
        label: tab.label,
        ...(tab.shortLabel ? { shortLabel: tab.shortLabel } : {}),
        href: `/${slug}/${tab.path}`,
        ...(tab.exact ? { exact: true } : {}),
      })),
  }
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? pathname
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * La pestaña de la página abierta: la que matchea la URL, por igualdad o por prefijo con borde
 * de segmento (`/x/clientes` no matchea `/x/clientes-viejos`); las `exact`, solo por igualdad.
 * Si matchean varias, gana la más larga (la más específica). `null` si no es de ninguna.
 */
export function activeSectionTab(
  tabs: readonly Pick<ResolvedSectionTab, 'value' | 'href' | 'exact'>[],
  pathname: string,
): string | null {
  const current = normalizePath(pathname)
  let best: { value: string; length: number } | null = null
  for (const tab of tabs) {
    const path = normalizePath(tab.href)
    const hit = tab.exact ? current === path : current === path || current.startsWith(`${path}/`)
    if (hit && (!best || path.length > best.length)) {
      best = { value: tab.value, length: path.length }
    }
  }
  return best?.value ?? null
}

/** ¿Va la barra en esta página? Con menos de dos pestañas no tiene sentido. */
export function sectionBarVisible(
  section: Pick<ResolvedSection, 'tabs' | 'showWhenNoneActive'>,
  active: string | null,
): boolean {
  if (section.tabs.length < 2) return false
  return active !== null || section.showWhenNoneActive
}

// ─── Clientes › Personas: el origen, como filtro de la lista ──────────────────

/**
 * Lo que eran los hijos de «Personas» en el sidebar (Todos / Reservas / Walk-in). Va como el
 * filtro «Origen» de la lista, al lado de Etiqueta y Última visita: una fila de pestañas más
 * encima de «Todos · Con puntos · Solo contacto» era un tercer nivel de navegación.
 */
export const CLIENTES_ORIGENES = [
  { value: 'todos', label: 'Todos los orígenes', segment: null },
  { value: 'reserva', label: 'Reservas', segment: 'reserva' },
  { value: 'walkin', label: 'Walk-in', segment: 'walkin' },
] as const
