/**
 * Cómo se arma la carta pública para mostrarla — PURO y testeado (`tests/lib/menu-carta.test.ts`).
 *
 * La carta (`app/carta/[tenantSlug]`) tiene dos niveles a la vista, sea como sea que el bar haya
 * anidado sus rubros:
 *
 * - **Rubros** (`CartaRoot`): los de arriba de todo (Comida, Bebidas, Vinos…). Cada uno es una página.
 * - **Secciones** (`CartaSection`): todo lo que cuelga de un rubro y tiene productos, en el orden del
 *   árbol, una debajo de la otra en la misma página. Las pestañas de arriba saltan entre ellas.
 *
 * Un rubro sin nada adentro no existe para el cliente. La dirección de cada lugar va en el `#` de la
 * URL (`#bebidas/tragos-hub`): el botón «atrás» del teléfono vuelve un paso en vez de salir de la
 * carta, y un QR puede abrir la carta directo en una sección.
 */
import type { MenuItem } from './queries'
import type { MenuTreeNode } from './tree'

/** Cómo se dibuja una sección: con fotos grandes, o como lista (una carta de vinos sin fotos). */
export type SectionLayout = 'gallery' | 'list'

export type CartaSection = {
  /** El id del rubro del que salen estos productos. */
  id: string
  /** Único adentro de su rubro. */
  slug: string
  title: string
  items: MenuItem[]
  layout: SectionLayout
}

export type CartaRoot = {
  id: string
  /** Único en la carta. */
  slug: string
  name: string
  imageUrl: string | null
  sections: CartaSection[]
  itemCount: number
}

/** Desde cuánta parte con foto una sección se muestra como galería. */
export const GALLERY_MIN_COVERAGE = 0.6

/** Minúsculas, sin tildes ni signos: para comparar y para armar direcciones. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** «Tragos HUB!» → `tragos-hub`. Vacío si el nombre no tiene letras ni números. */
export function slugify(name: string): string {
  return foldText(name).replace(/ /g, '-').slice(0, 48)
}

/** Un slug que no esté usado: `bebidas`, `bebidas-2`, `bebidas-3`… */
function uniqueSlug(name: string, used: Set<string>, fallback: string): string {
  const base = slugify(name) || fallback
  let slug = base
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
  used.add(slug)
  return slug
}

/** ¿Tiene algo para mostrar en su recuadro? Una foto, o un video (que trae su cuadro de portada). */
export function hasMedia(item: Pick<MenuItem, 'image_url' | 'video_url'>): boolean {
  return Boolean(item.image_url || item.video_url)
}

/**
 * Galería si la mayoría tiene foto; lista si no. Una sección de vinos con dos fotos entre quince se
 * lee mejor como carta de vinos que como una grilla de recuadros vacíos.
 */
export function sectionLayout(
  items: ReadonlyArray<Pick<MenuItem, 'image_url' | 'video_url'>>,
): SectionLayout {
  if (items.length === 0) return 'list'
  const withMedia = items.filter(hasMedia).length
  return withMedia / items.length >= GALLERY_MIN_COVERAGE ? 'gallery' : 'list'
}

/**
 * Los rubros de la carta con sus secciones, listos para dibujar. Recorre el árbol en orden y aplana
 * todo lo que cuelga de cada rubro: un rubro con productos propios y además subrubros muestra primero
 * los suyos (con su nombre) y después cada subrubro. Más abajo del segundo nivel, la sección lleva el
 * nombre de su padre adelante («Tintos · Reserva») para que se entienda sola.
 */
export function buildCartaRoots(tree: ReadonlyArray<MenuTreeNode>): CartaRoot[] {
  const rootSlugs = new Set<string>()
  const roots: CartaRoot[] = []

  for (const root of tree) {
    const sectionSlugs = new Set<string>()
    const sections: CartaSection[] = []

    const visit = (node: MenuTreeNode, trail: string[], depth: number) => {
      if (node.items.length > 0) {
        const title = depth >= 2 ? [...trail.slice(1), node.name].join(' · ') : node.name
        sections.push({
          id: node.id,
          slug: uniqueSlug(node.name, sectionSlugs, 'seccion'),
          title,
          items: node.items,
          layout: sectionLayout(node.items),
        })
      }
      // Un árbol mal armado (muy hondo) no cuelga la carta.
      if (depth >= 8) return
      for (const child of node.children) visit(child, [...trail, node.name], depth + 1)
    }
    visit(root, [], 0)

    if (sections.length === 0) continue
    roots.push({
      id: root.id,
      slug: uniqueSlug(root.name, rootSlugs, 'rubro'),
      name: root.name,
      imageUrl: root.image_url,
      sections,
      itemCount: sections.reduce((total, section) => total + section.items.length, 0),
    })
  }
  return roots
}

/** «7 secciones», «4 opciones»: lo que hay adentro de un rubro, dicho corto. */
export function rootSummary(root: Pick<CartaRoot, 'sections' | 'itemCount'>): string {
  if (root.sections.length > 1) return `${root.sections.length} secciones`
  return `${root.itemCount} ${root.itemCount === 1 ? 'opción' : 'opciones'}`
}

// ─── La dirección (el `#` de la URL) ─────────────────────────────────────────

export type CartaPlace = {
  /** Slug del rubro abierto, o `null` en el inicio. */
  root: string | null
  /** Slug de la sección a la que hay que bajar, si vino en la dirección. */
  section: string | null
}

const HOME: CartaPlace = { root: null, section: null }

/** `#bebidas/tragos-hub` → `{ root: 'bebidas', section: 'tragos-hub' }`. Lo que no entiende es el inicio. */
export function parseCartaHash(hash: string): CartaPlace {
  const raw = hash.replace(/^#\/?/, '').trim()
  if (!raw) return HOME
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Una dirección rota se lee tal cual.
  }
  const [root, section] = decoded.split('/').map((part) => slugify(part))
  if (!root) return HOME
  return { root, section: section || null }
}

/** El `#` de un lugar. El inicio no lleva nada. */
export function cartaHash(place: CartaPlace): string {
  if (!place.root) return ''
  return place.section ? `#${place.root}/${place.section}` : `#${place.root}`
}

/**
 * El lugar que de verdad existe para una dirección: si el rubro ya no está (lo pausaron, terminó su
 * horario) es el inicio, y si la sección no está es el rubro desde arriba. Así nadie queda mirando una
 * pantalla vacía.
 */
export function resolveCartaPlace(
  roots: ReadonlyArray<CartaRoot>,
  place: CartaPlace,
): { root: CartaRoot | null; section: CartaSection | null } {
  if (!place.root) return { root: null, section: null }
  const root = roots.find((candidate) => candidate.slug === place.root) ?? null
  if (!root) return { root: null, section: null }
  const section = place.section
    ? (root.sections.find((candidate) => candidate.slug === place.section) ?? null)
    : null
  return { root, section }
}

// ─── El saludo ───────────────────────────────────────────────────────────────

export type Daypart = 'morning' | 'afternoon' | 'night'

/** La parte del día para los minutos del reloj del bar (`localClock` de `availability.ts`). */
export function daypartOf(minutes: number): Daypart {
  if (minutes >= 6 * 60 && minutes < 12 * 60) return 'morning'
  if (minutes >= 12 * 60 && minutes < 20 * 60) return 'afternoon'
  // De las 20 a las 6: un bar a las 3 de la mañana sigue siendo de noche.
  return 'night'
}

const GREETINGS: Readonly<Record<Daypart, string>> = {
  morning: 'Buen día',
  afternoon: 'Buenas tardes',
  night: 'Buenas noches',
}

/** «Buenas noches» / «Buenas noches, Nacho» si este celular ya es del club. */
export function cartaGreeting(daypart: Daypart, firstName?: string | null): string {
  const name = firstName?.trim().split(/\s+/)[0]
  return name ? `${GREETINGS[daypart]}, ${name}` : GREETINGS[daypart]
}
