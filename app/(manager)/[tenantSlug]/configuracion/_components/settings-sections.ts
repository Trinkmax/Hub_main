import { Armchair, type LucideIcon, Palette, Star, Store, UsersRound } from 'lucide-react'
import type { FeatureKey } from '@/lib/platform/features'

/**
 * Lo que hay en Configuración, en UN solo lugar.
 *
 * Lo leen el menú lateral de la sección (compu) y su portada (que en el celular es la única forma de
 * llegar a cada pantalla, porque el menú lateral no se dibuja). Antes eran dos listas escritas a mano
 * y se habían separado: Comisiones y Reseñas estaban en el menú pero no en la portada, así que desde
 * el celular no se llegaba.
 */
export type SettingsItem = {
  label: string
  /** Una línea: qué se toca ahí. */
  description: string
  href: (slug: string) => string
  /** Solo con esta función prendida en el bar (un superadmin la ve igual, para prepararla). */
  feature?: FeatureKey
}

export type SettingsGroup = {
  label: string
  icon: LucideIcon
  items: SettingsItem[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    label: 'Equipo',
    icon: UsersRound,
    items: [
      {
        label: 'Miembros',
        description: 'Quién entra al sistema y con qué rol.',
        href: (s) => `/${s}/configuracion/equipo`,
      },
      {
        label: 'Comisiones',
        description: 'Tarifas, bonus y quiénes gestionan reservas.',
        href: (s) => `/${s}/configuracion/comisiones`,
      },
    ],
  },
  {
    // Lo que define cómo se toma una reserva.
    label: 'Reservas',
    icon: Armchair,
    items: [
      {
        label: 'Capacidad',
        description: 'Cuánta gente entra por servicio y los cupos de un día puntual.',
        href: (s) => `/${s}/configuracion/salon`,
      },
      {
        label: 'Tortas de cumpleaños',
        description: 'El menú de tortas que se elige al cargar una reserva.',
        href: (s) => `/${s}/configuracion/tortas`,
      },
    ],
  },
  {
    // El punto de venta: lo que se prepara una vez. El día a día está en «Salón en vivo».
    label: 'Salón',
    icon: Store,
    items: [
      {
        label: 'Sucursales',
        description: 'Los locales del bar: el nombre, el color y la dirección de cada uno.',
        href: (s) => `/${s}/local/sucursales`,
      },
      {
        label: 'Plano del salón',
        description: 'Sectores y mesas de cada sucursal, y cómo está el salón ahora.',
        href: (s) => `/${s}/local/mesas`,
        feature: 'pos',
      },
    ],
  },
  {
    label: 'Reseñas',
    icon: Star,
    items: [
      {
        label: 'Google y WhatsApp',
        description: 'A dónde van las reseñas y cuántos puntos das por opinar.',
        href: (s) => `/${s}/configuracion/resenas`,
      },
    ],
  },
  {
    label: 'Apariencia',
    icon: Palette,
    items: [
      {
        label: 'Logo y marca',
        description: 'El logo del bar y el color de la marca.',
        href: (s) => `/${s}/configuracion/apariencia`,
      },
    ],
  },
]

/** Los grupos que ve quien mira: sin lo que depende de una función apagada. Un grupo vacío se va. */
export function visibleSettingsGroups(
  can: (feature: FeatureKey) => boolean,
): readonly SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.feature || can(item.feature)),
  })).filter((group) => group.items.length > 0)
}
