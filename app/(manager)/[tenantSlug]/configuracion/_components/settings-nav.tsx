import { Armchair, Cake, HandCoins, type LucideIcon, Palette, Star, UsersRound } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/ui/section-nav'

/*
 * Las secciones de Configuración, en un solo lugar: de acá salen la
 * subnavegación del layout (`SectionNav`) y las tarjetas de la portada. Antes
 * eran dos listas a mano y se desfasaron: la portada no mostraba Comisiones ni
 * Reseñas, y como el menú lateral de la sección era `lg:block`, en el celular
 * esas dos pantallas solo se alcanzaban por link profundo.
 *
 * Server-safe (sin hooks): los íconos son componentes y los dibuja el server
 * (`SectionNav` los manda ya dibujados a su parte cliente).
 */

export const SETTINGS_GROUPS = ['Equipo', 'Salón', 'Marca'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export type SettingsSection = {
  /** Segmento debajo de `/configuracion`. */
  path: string
  group: SettingsGroup
  /**
   * Lo que se lee en la subnavegación. En el celular la fila no muestra los
   * grupos, así que cada etiqueta tiene que entenderse sola.
   */
  navLabel: string
  /** Título de la tarjeta de la portada (el mismo `h1` de la pantalla). */
  title: string
  description: string
  /** Qué se toca ahí, en una línea de apoyo de la tarjeta. */
  topics: ReadonlyArray<string>
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  {
    path: 'equipo',
    group: 'Equipo',
    navLabel: 'Miembros',
    title: 'Equipo',
    description: 'Quién entra al panel y con qué rol: dueños, cajeros, mozos, cocina y más.',
    topics: ['Miembros', 'Roles', 'Contraseñas'],
    icon: UsersRound,
  },
  {
    path: 'comisiones',
    group: 'Equipo',
    navLabel: 'Comisiones',
    title: 'Comisiones',
    description:
      'Cuánto cobra cada gestor por persona reservada y el extra cuando un evento se llena.',
    topics: ['Tarifas', 'Evento lleno', 'Gestores'],
    icon: HandCoins,
  },
  {
    path: 'salon',
    group: 'Salón',
    navLabel: 'Capacidad',
    title: 'Capacidad del salón',
    description: 'Cuántas personas entran en cada servicio y los cupos especiales de un día.',
    topics: ['Cupos por servicio', 'Cupos por fecha', 'Capacidad total'],
    icon: Armchair,
  },
  {
    path: 'tortas',
    group: 'Salón',
    navLabel: 'Tortas de cumpleaños',
    title: 'Tortas de cumpleaños',
    description: 'El menú de tortas que hace el bar. Es lo que se elige al cargar una reserva.',
    topics: ['Bizcochuelos', 'Rellenos'],
    icon: Cake,
  },
  {
    path: 'apariencia',
    group: 'Marca',
    navLabel: 'Apariencia',
    title: 'Apariencia',
    description:
      'El logo y el color del bar: se ven en el panel, la carta, la wallet y los emails.',
    topics: ['Logo', 'Color del bar'],
    icon: Palette,
  },
  {
    path: 'resenas',
    group: 'Marca',
    navLabel: 'Reseñas',
    title: 'Reseñas',
    description:
      'A dónde mandamos a quien opina (tu ficha de Google o tu WhatsApp) y cuántos puntos le das.',
    topics: ['Google Maps', 'WhatsApp', 'Puntos por opinar'],
    icon: Star,
  },
]

export function settingsHref(tenantSlug: string, path?: string): string {
  return path ? `/${tenantSlug}/configuracion/${path}` : `/${tenantSlug}/configuracion`
}

export function settingsNavItems(tenantSlug: string): SectionNavItem[] {
  return SETTINGS_SECTIONS.map((section) => ({
    href: settingsHref(tenantSlug, section.path),
    label: section.navLabel,
    icon: section.icon,
    group: section.group,
  }))
}

/**
 * La subnavegación de la sección: columna de 224 px desde `lg` y fila
 * subrayada con scroll debajo (así Comisiones y Reseñas también se alcanzan
 * desde el celular).
 */
export function SettingsNav({ tenantSlug, className }: { tenantSlug: string; className?: string }) {
  return (
    <SectionNav
      aria-label="Secciones de Configuración"
      items={settingsNavItems(tenantSlug)}
      className={className}
    />
  )
}
