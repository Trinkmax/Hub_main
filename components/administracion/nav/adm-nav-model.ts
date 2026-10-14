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
  /** Etiqueta corta, para cuando la fila no da (el celular, la compu angosta). Hoy, solo Compras. */
  shortLabel?: string
  href: string
  /** `true`: activa solo en esa ruta exacta (el Resumen). Si no, también en sus sub-rutas. */
  exact?: boolean
  alsoHrefs?: string[]
  /** Una línea en gris para la hoja «Más» del celular. */
  hint?: string
  /**
   * Vive ADENTRO de otra pantalla de la barra (Fin de mes, bajo Libros). Se marca cuando estás
   * ahí (gana por ser la ruta más larga), pero sigue siendo una pantalla de tarea: la barra no
   * se pega (`admNavPinned` la saltea).
   */
  nested?: boolean
}

export type AdmNavModel = {
  /** Las pantallas de todos los días, como píldoras. */
  primary: AdmNavItem[]
  /** Más calladas, después del separador (compu): Importar. */
  quiet: AdmNavItem[]
  /** El desplegable «Contadora» (compu, dueño): Fin de mes, Libros y Plan de cuentas. */
  books: AdmNavItem[]
  /** «Fin de mes» (`/libros/cierres`). `null` si quien mira no tiene Libros. */
  monthEnd: AdmNavItem | null
  guide: AdmNavItem
  settings: AdmNavItem
  /** La hoja «Más» del celular: Fin de mes primero, lo que no entra como píldora, Guía y Ajustes. */
  more: AdmNavItem[]
  /** Todo junto, para marcar la activa con `activeSectionTab`. */
  all: AdmNavItem[]
}

/** El orden en que se usa el día a día (no el de `SECTION_TABS`, que es el de los libros). */
const PRIMARY_ORDER = ['resumen', 'ventas', 'compras', 'gastos-fijos', 'cajas'] as const
const BOOKS_ORDER = ['libros', 'plan-de-cuentas'] as const
/** La pestaña de la que cuelga «Fin de mes»: sin ella, el ítem no existe. */
const MONTH_END_PARENT = 'libros'
/** El valor del ítem «Fin de mes» (no es una pestaña de `SECTION_TABS`: lo arma `buildAdmNav`). */
export const MONTH_END_VALUE = 'fin-de-mes'

/**
 * Cómo se llama cada pantalla en la barra. «Compras» pasa a «Compras y pagos» (es donde se ve
 * cuánto se le debe a cada uno y se paga); la corta queda para cuando no hay lugar.
 */
const COPY: Readonly<Record<string, { label?: string; shortLabel?: string; hint?: string }>> = {
  compras: { label: 'Compras y pagos', shortLabel: 'Compras' },
  importar: { hint: 'Subí lo de ARCA, Mercado Pago y el banco' },
  libros: { hint: 'El diario, el IVA y el fin de mes' },
  'plan-de-cuentas': { hint: 'Las categorías donde se anota cada cosa' },
}

function toItem(tab: ResolvedSectionTab): AdmNavItem {
  const copy = COPY[tab.value]
  // Solo las cortas de acá. La de las pestañas del panel («Fijos») no se usa: sola no dice qué
  // es, y la fila se desliza igual, así que «Gastos fijos» va siempre entero.
  const shortLabel = copy?.shortLabel
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
 * - Dueño: cinco píldoras · Importar y «Contadora ▾» (Fin de mes, Libros, Plan de cuentas) más
 *   callados.
 * - Contadora: Libros, Fin de mes y Plan de cuentas son píldoras directas; no hay desplegable.
 *
 * Guía y Ajustes no son pestañas de `SECTION_TABS` (no tienen puerta propia: las ve cualquiera
 * que entra a la sección, y cada página vuelve a decidir), pero viven acá para que tengan un
 * lugar fijo y la barra las marque cuando estás adentro.
 *
 * «Fin de mes» tampoco es una pestaña: es una pantalla de Libros (`/libros/cierres`) que se usa
 * una vez por mes y nadie encontraba. Tiene su renglón propio (el primero de «Contadora ▾» y de
 * «Más») y existe solo si la pestaña Libros vino resuelta: el permiso es el de Libros. Estando
 * ahí se marca «Fin de mes» y no «Libros»: `activeSectionTab` se queda con la ruta más larga.
 */
export function buildAdmNav(
  tabs: readonly ResolvedSectionTab[],
  { base, audience }: { base: string; audience: AdmAudience },
): AdmNavModel {
  const items = tabs.map(toItem)
  const booksItems = pick(items, BOOKS_ORDER)
  const parent = items.find((item) => item.value === MONTH_END_PARENT)
  const monthEnd: AdmNavItem | null = parent
    ? {
        value: MONTH_END_VALUE,
        label: 'Fin de mes',
        href: `${parent.href}/cierres`,
        hint: 'Revisar el mes, cerrarlo y mandarle los libros a tu contadora',
        nested: true,
      }
    : null
  const monthEndItems = monthEnd ? [monthEnd] : []
  const primary =
    audience === 'accountant'
      ? [
          ...pick(items, PRIMARY_ORDER),
          // Al lado de «Libros», que es de donde cuelga.
          ...booksItems.flatMap((item) =>
            item.value === MONTH_END_PARENT ? [item, ...monthEndItems] : [item],
          ),
        ]
      : pick(items, PRIMARY_ORDER)
  const books = audience === 'accountant' ? [] : [...monthEndItems, ...booksItems]
  // Lo que no es ni píldora ni de la contadora (hoy, Importar). Una pestaña nueva en
  // `SECTION_TABS` cae acá sola: nunca se pierde, aunque esta lista no la conozca.
  const placed = new Set([...primary, ...books].map((item) => item.value))
  const quiet = items.filter((item) => !placed.has(item.value))
  // En «Más», «Fin de mes» va primero; para la contadora ya es una píldora y no se repite.
  const moreBooks = audience === 'accountant' ? [] : booksItems
  const moreFirst = audience === 'accountant' ? [] : monthEndItems

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
    monthEnd,
    guide,
    settings,
    more: [...moreFirst, ...quiet, ...moreBooks, guide, settings],
    all: [...items, ...monthEndItems, guide, settings],
  }
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? pathname
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * Las pantallas donde el flotante «＋ Cargar» del celular lo pone el marco de la sección (el
 * layout), y no cada página: las de primer nivel donde se carga o se mira lo cargado, para que
 * esté siempre en el mismo lugar. Dos quedan afuera a propósito:
 * - Ajustes: su formulario termina en «Guardar cambios» abajo a la derecha, justo donde iría;
 * - Guía: cada parada y cada receta ya trae el botón que abre su pantalla, y el flotante tapaba
 *   justo el de la parada que te toca.
 *
 * Las sub-rutas no entran: son pantallas de tarea (el cierre, cargar una compra, un asiento) con
 * su propio pie fijo. La que igual quiera el flotante pone `<QuickActionsBar />`.
 */
const FAB_FRAME_SCREENS = [
  '',
  '/ventas',
  '/compras',
  '/gastos-fijos',
  '/cajas',
  '/importar',
  '/libros',
  '/plan-de-cuentas',
] as const

/** ¿En esta pantalla el flotante lo dibuja el marco? `base` es `/<bar>/administracion`. */
export function admFabFromFrame(base: string, pathname: string): boolean {
  const root = normalizePath(base)
  const current = normalizePath(pathname)
  return FAB_FRAME_SCREENS.some((screen) => current === `${root}${screen}`)
}

/** Una píldora de la fila, en coordenadas del contenido que se desliza (px desde el inicio). */
export type NavPillBox = { start: number; end: number }

/**
 * Lo mínimo que tiene que asomar de una píldora cortada a la derecha para que se lea como «la
 * fila sigue»: el ícono y el principio de la palabra. Menos que eso es un borde suelto.
 */
export const NAV_MIN_PEEK = 56

/**
 * Dónde descansa la fila deslizable para que la píldora activa se vea ENTERA. Pura: la usa
 * `AdmNav` con las medidas del DOM, y los tests con números.
 *
 * - Si la activa ya se ve entera, la fila no se mueve (no se corre «para centrar»: eso le comía
 *   el ícono a la primera píldora sin necesidad).
 * - Si está cortada, la fila va a una de las paradas donde arranca una píldora (las mismas del
 *   `scroll-snap`), la más cercana que la muestre entera. Entre esas, primero las que no dejan
 *   asomando solo el borde de la siguiente contra «Más».
 */
export function navRestScroll({
  pills,
  active,
  width,
  cover = 0,
  inset = 0,
  current,
  max,
}: {
  pills: readonly NavPillBox[]
  /** Índice de la activa en `pills`; −1 si ninguna está en la fila. */
  active: number
  /** Ancho visible de la fila (`clientWidth`). */
  width: number
  /** Cuánto del borde derecho queda tapado por «Más» (0 si no está). */
  cover?: number
  /** El aire a la izquierda donde descansa una píldora (el `scroll-padding`). */
  inset?: number
  /** `scrollLeft` de ahora. */
  current: number
  /** `scrollWidth - clientWidth`. */
  max: number
}): number {
  if (max <= 0) return 0
  const clamp = (value: number) => Math.min(Math.max(0, Math.round(value)), Math.round(max))
  const here = clamp(current)
  const pill = pills[active]
  if (!pill) return here

  // 1 px de tolerancia: los anchos del DOM vienen con decimales.
  const edge = (scroll: number) => scroll + width - cover
  const whole = (scroll: number) => pill.start >= scroll + inset - 1 && pill.end <= edge(scroll) + 1
  if (whole(here)) return here

  const stops = [...new Set([0, ...pills.map((box) => clamp(box.start - inset)), clamp(max)])]
  const candidates = stops.filter(whole)
  // Más ancha que la ventana: por lo menos que se vea desde el principio.
  if (candidates.length === 0) return clamp(pill.start - inset)

  const loose = (scroll: number) => {
    const cut = pills.find((box) => box.start < edge(scroll) && box.end > edge(scroll) + 1)
    return cut ? edge(scroll) - cut.start < NAV_MIN_PEEK : false
  }
  const [best] = candidates.sort(
    (a, b) => Number(loose(a)) - Number(loose(b)) || Math.abs(a - here) - Math.abs(b - here),
  )
  return best ?? here
}

/**
 * ¿La barra se queda pegada arriba al bajar? Solo en las pantallas de la barra (el Resumen, las
 * listas, Guía, Ajustes). En las sub-rutas se va con la página: son pantallas de tarea (el cierre
 * del día, cargar una compra, un importador, una guía paso a paso) que ya tienen su propio
 * resumen o su barra pegados arriba, pensados para quedar justo debajo del topbar; con las dos
 * cosas pegadas, la barra les taparía el borde de arriba.
 *
 * «Fin de mes» tiene su renglón en la barra pero es una de esas pantallas de tarea (su carátula
 * va pegada bajo el topbar): los ítems `nested` no cuentan.
 */
export function admNavPinned(
  items: readonly Pick<AdmNavItem, 'href' | 'nested'>[],
  pathname: string,
): boolean {
  const current = normalizePath(pathname)
  return items.some((item) => !item.nested && normalizePath(item.href) === current)
}
