import type { ResolvedSectionTab } from '@/components/shell/section-tabs-config'

/**
 * La barra de Administración, en datos (sin React): qué va como píldora, qué va callado, qué
 * queda en «Más» y cuándo se pega arriba. Puro: lo usan `AdmNav` y los tests.
 *
 * Los permisos NO se deciden acá: entran las pestañas que ya resolvió
 * `resolveSection('administracion', …)` para quien mira (la misma regla del menú), y esto solo
 * las ordena. Una pestaña que no vino, no aparece en ningún lado.
 */

/** Para quién se arma: la contadora tiene Libros y Plan de cuentas a la vista (es su zona). */
export type AdmAudience = 'owner' | 'accountant'

export type AdmNavItem = {
  value: string
  label: string
  /** Etiqueta corta, para cuando la fila no da (el celular, la compu angosta). */
  shortLabel?: string
  href: string
  /** `true`: activa solo en esa ruta exacta (el Resumen). Si no, también en sus sub-rutas. */
  exact?: boolean
  alsoHrefs?: string[]
  /** Una línea en gris para la hoja «Más» del celular. */
  hint?: string
}

export type AdmNavModel = {
  /** Las pantallas de todos los días, como píldoras. */
  primary: AdmNavItem[]
  /** Más calladas, después del separador (compu): Importar. */
  quiet: AdmNavItem[]
  /** El desplegable «Contadora» (compu, dueño): Libros y Plan de cuentas. */
  books: AdmNavItem[]
  guide: AdmNavItem
  settings: AdmNavItem
  /** La hoja «Más» del celular: lo que no entra como píldora, más Guía y Ajustes. */
  more: AdmNavItem[]
  /** Todo junto, para marcar la activa con `activeSectionTab`. */
  all: AdmNavItem[]
}

/** El orden en que se usa el día a día (no el de `SECTION_TABS`, que es el de los libros). */
const PRIMARY_ORDER = ['resumen', 'ventas', 'compras', 'gastos-fijos', 'cajas'] as const
const BOOKS_ORDER = ['libros', 'plan-de-cuentas'] as const

/**
 * Cómo se llama cada pantalla en la barra. «Compras» pasa a «Compras y pagos» (es donde se ve
 * cuánto se le debe a cada uno y se paga); la corta queda para cuando no hay lugar.
 */
const COPY: Readonly<Record<string, { label?: string; shortLabel?: string; hint?: string }>> = {
  compras: { label: 'Compras y pagos', shortLabel: 'Compras' },
  importar: { hint: 'Subí lo de ARCA, Mercado Pago y el banco' },
  libros: { hint: 'El diario, el IVA y los cierres de mes' },
  'plan-de-cuentas': { hint: 'Las categorías donde se anota cada cosa' },
}

function toItem(tab: ResolvedSectionTab): AdmNavItem {
  const copy = COPY[tab.value]
  const shortLabel = copy?.shortLabel ?? tab.shortLabel
  return {
    value: tab.value,
    label: copy?.label ?? tab.label,
    ...(shortLabel ? { shortLabel } : {}),
    href: tab.href,
    ...(tab.exact ? { exact: true } : {}),
    ...(tab.alsoHrefs ? { alsoHrefs: tab.alsoHrefs } : {}),
    ...(copy?.hint ? { hint: copy.hint } : {}),
  }
}

function pick(items: readonly AdmNavItem[], order: readonly string[]): AdmNavItem[] {
  return order.flatMap((value) => items.find((item) => item.value === value) ?? [])
}

/**
 * Arma la barra con las pestañas que ve quien mira.
 *
 * - Dueño: cinco píldoras · Importar y «Contadora ▾» (Libros, Plan de cuentas) más callados.
 * - Contadora: Libros y Plan de cuentas son píldoras directas; no hay desplegable.
 *
 * Guía y Ajustes no son pestañas de `SECTION_TABS` (no tienen puerta propia: las ve cualquiera
 * que entra a la sección, y cada página vuelve a decidir), pero viven acá para que tengan un
 * lugar fijo y la barra las marque cuando estás adentro.
 */
export function buildAdmNav(
  tabs: readonly ResolvedSectionTab[],
  { base, audience }: { base: string; audience: AdmAudience },
): AdmNavModel {
  const items = tabs.map(toItem)
  const booksItems = pick(items, BOOKS_ORDER)
  const primary =
    audience === 'accountant'
      ? [...pick(items, PRIMARY_ORDER), ...booksItems]
      : pick(items, PRIMARY_ORDER)
  const books = audience === 'accountant' ? [] : booksItems
  // Lo que no es ni píldora ni de la contadora (hoy, Importar). Una pestaña nueva en
  // `SECTION_TABS` cae acá sola: nunca se pierde, aunque esta lista no la conozca.
  const placed = new Set([...primary, ...books].map((item) => item.value))
  const quiet = items.filter((item) => !placed.has(item.value))

  const guide: AdmNavItem = {
    value: 'guias',
    label: 'Guía',
    href: `${base}/guias`,
    hint: 'Qué cargar, dónde y cómo',
  }
  const settings: AdmNavItem = {
    value: 'ajustes',
    label: 'Ajustes',
    href: `${base}/ajustes`,
    hint: 'Los datos del bar, los accesos, las cajas y los medios de cobro',
  }

  return {
    primary,
    quiet,
    books,
    guide,
    settings,
    more: [...quiet, ...books, guide, settings],
    all: [...items, guide, settings],
  }
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? pathname
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * ¿La barra se queda pegada arriba al bajar? Solo en las pantallas de la barra (el Resumen, las
 * listas, Guía, Ajustes). En las sub-rutas se va con la página: son pantallas de tarea (el cierre
 * del día, cargar una compra, un importador, una guía paso a paso) que ya tienen su propio
 * resumen o su barra pegados arriba, pensados para quedar justo debajo del topbar; con las dos
 * cosas pegadas, la barra les taparía el borde de arriba.
 */
export function admNavPinned(
  items: readonly Pick<AdmNavItem, 'href'>[],
  pathname: string,
): boolean {
  const current = normalizePath(pathname)
  return items.some((item) => normalizePath(item.href) === current)
}
