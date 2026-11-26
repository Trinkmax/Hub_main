/**
 * Una carta de ejemplo, parecida a la de HUB, para las pruebas de la carta pública
 * (`menu-carta`, `menu-search`, `menu-sponsors`).
 */
import type { ItemTag } from '@/lib/item-tags/queries'
import type { MenuItem } from '@/lib/menu/queries'
import type { MenuTreeNode } from '@/lib/menu/tree'

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

export const TAG_VEGGIE: ItemTag = {
  id: 'tag-veggie',
  tenant_id: 't1',
  name: 'Vegetariano',
  color: '#39844b',
}
export const TAG_NO_ALCOHOL: ItemTag = {
  id: 'tag-sin-alcohol',
  tenant_id: 't1',
  name: 'Sin Alcohol',
  color: '#3a87fe',
}

export function item(
  name: string,
  options: {
    description?: string | null
    photo?: boolean
    video?: boolean
    tags?: ItemTag[]
    featured?: boolean
    price?: number
  } = {},
): MenuItem {
  const id = nextId('item')
  return {
    id,
    category_id: '',
    name,
    description: options.description ?? null,
    price_cents: (options.price ?? 10_000) * 100,
    points_override: null,
    position: seq,
    active: true,
    image_url: options.photo === false ? null : `https://x.supabase.co/img/${id}.webp`,
    video_url: options.video ? `https://x.supabase.co/img/${id}_v.mp4` : null,
    featured: options.featured ?? false,
    tags: options.tags ?? [],
  }
}

export function node(
  name: string,
  options: { items?: MenuItem[]; children?: MenuTreeNode[]; image?: string | null } = {},
): MenuTreeNode {
  const id = nextId('cat')
  const items = (options.items ?? []).map((each) => ({ ...each, category_id: id }))
  const children = (options.children ?? []).map((child) => ({ ...child, parent_id: id }))
  return {
    id,
    name,
    position: seq,
    active: true,
    image_url: options.image ?? null,
    parent_id: null,
    children,
    items,
  }
}

/** Comida, Bebidas, Vinos, Postres y un rubro vacío: lo que alcanza para probar todo. */
export function sampleTree(): MenuTreeNode[] {
  return [
    node('Comida', {
      image: 'https://x.supabase.co/img/comida.webp',
      children: [
        node('Hamburguesas', {
          items: [
            item('Clasica SIMPLE', {
              description:
                'Medallón de carne (90g), tomate, lechuga, cheddar y bacon. Con papas fritas.',
            }),
            item('Bacon burger DOBLE', {
              description:
                'Medallones de 90g, doble cheddar, bacon ahumado y cebolla caramelizada.',
            }),
            item('Portobello y Fontina', {
              description: 'Hongos portobello grillados, queso fontina y rúcula.',
              tags: [TAG_VEGGIE],
            }),
          ],
        }),
        node('Pizza', {
          items: [
            item('Muzzarella', {
              description: 'Pizza con salsa de tomate, mozzarella derretida y olivas negras.',
            }),
            item('Especial', {
              description: 'Salsa de tomate, mozzarella, jamón cocido, morrón y huevo.',
            }),
            item('Pizza explosiva', { description: 'Muzzarella, papas fritas, cheddar y bacon.' }),
          ],
        }),
        node('Tablas y milanesas', {
          items: [
            item('Milanesa napolitana', {
              description: 'Con salsa de tomate, mozzarella, jamón y una pizca de orégano.',
            }),
            item('Tabla crunch', {
              description: 'Papas fritas, nuggets, aros de cebolla y rabas.',
            }),
            item('Sandwich de milanesa', { photo: false }),
          ],
        }),
        node('Pastas Hub', {
          items: [item('Ñoquis de papa', { description: 'Los clásicos, con salsa a elección.' })],
        }),
      ],
    }),
    node('Bebidas', {
      children: [
        node('Tragos HUB!', {
          items: [
            item('Branca y Cola', { description: 'El favorito de todos los cordobeses' }),
            item('Sernova Speed', {
              description: 'Vodka Sernova con Speed. Energía en cada sorbo.',
            }),
            item('Blu Gin Tonic', { description: 'Gin Blu con tónica y piel de limón.' }),
            item('Por*Hub', { description: 'El clásico de la casa, con limón, azúcar y vodka.' }),
            item('Daiquiri sin alcohol', {
              description: 'Versión frozen con limón y fruta a elección.',
              tags: [TAG_NO_ALCOHOL],
            }),
            item('Blue Lagoon', { description: 'Curaçao azul, vodka y limón.' }),
          ],
        }),
        node('Bebidas', {
          items: [
            item('Botella Stella Artois 1 litro', {
              description: 'Una cerveza suave y balanceada para disfrutar.',
            }),
            item('Corona 330ml', { description: 'La sofisticada que todos conocen.' }),
            item('Agua o Soda', { tags: [TAG_NO_ALCOHOL] }),
            item('Coca, Sprite, Coca Zero', {
              description: 'Las clásicas opciones sin alcohol para todos los gustos.',
              tags: [TAG_NO_ALCOHOL],
            }),
          ],
        }),
        node('Bebidas Calientes', {
          items: [
            item('Capuccino', { description: 'Espresso con leche vaporizada, espuma y cacao.' }),
            item('Lágrima', { photo: false }),
            item('Espresso', { photo: false }),
            item('Tés', { description: 'Consultar variedades.', photo: false }),
          ],
        }),
      ],
    }),
    node('Vinos', {
      children: [
        node('Vinos tintos', {
          items: [
            item('Andillian', {
              description: 'Malbec · Mendoza, Valle de Uco\nNotas de ciruela, violeta y cedro.',
              photo: false,
            }),
            item('Lui Espontáneo', {
              description: 'Cabernet Franc · Mendoza, San Carlos\nNatural e intenso.',
              photo: false,
            }),
            item('Lúi Umile - Malbec', { description: 'Clásico argentino, robusto y frutal.' }),
          ],
        }),
      ],
    }),
    node('Postres', {
      items: [
        item('Chocotorta', { description: 'El postre más famoso de Argentina.' }),
        item('Flan con DDL', { description: 'Un clásico que nunca falla.' }),
        item('Cheesecake sin TACC', { photo: false }),
      ],
      // Un subrubro sin nada: no tiene que aparecer.
      children: [node('Eliminar, no me deja')],
    }),
    node('Próximamente'),
  ]
}
