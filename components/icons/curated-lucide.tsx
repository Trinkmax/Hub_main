import {
  BadgePercent,
  Beer,
  Bike,
  Cake,
  CalendarDays,
  Coffee,
  Crown,
  Gem,
  Gift,
  GlassWater,
  Handshake,
  IceCream2,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Percent,
  Pizza,
  Scissors,
  Shirt,
  Sparkles,
  Stamp,
  Star,
  Ticket,
  Trophy,
  UtensilsCrossed,
  Wine,
} from 'lucide-react'

/**
 * Catálogo ÚNICO de íconos elegibles (se guardan por nombre en
 * `loyalty_tiers.badge_icon`, `tier_benefits.icon` y
 * `punch_card_templates.stamp_icon`).
 *
 * Es curado a propósito: bundlear todo lucide dinámicamente costaría cientos de
 * KB en la billetera del socio, que es mobile y se abre en el bar.
 *
 * Vive acá y no en la carpeta de la billetera porque lo consumen LOS DOS lados:
 * el que renderiza (app/c) y el que elige (los editores del manager). Cuando el
 * catálogo y el selector viven separados, el dueño puede tipear un nombre que el
 * renderer no conoce y el ícono desaparece sin decir nada — que es exactamente
 * lo que pasaba con el input de texto libre que había antes.
 */
export const CURATED_ICONS: Record<string, LucideIcon> = {
  BadgePercent,
  Beer,
  Bike,
  Cake,
  CalendarDays,
  Coffee,
  Crown,
  Gem,
  Gift,
  GlassWater,
  Handshake,
  IceCream2,
  MapPin,
  MessageCircle,
  Percent,
  Pizza,
  Scissors,
  Shirt,
  Sparkles,
  Stamp,
  Star,
  Ticket,
  Trophy,
  UtensilsCrossed,
  Wine,
}

/** Nombre en castellano para que el dueño no tenga que saber inglés ni Lucide. */
export const ICON_LABELS: Record<string, string> = {
  BadgePercent: 'Descuento',
  Beer: 'Birra',
  Bike: 'Delivery',
  Cake: 'Torta',
  CalendarDays: 'Fecha',
  Coffee: 'Café',
  Crown: 'Corona',
  Gem: 'Gema',
  Gift: 'Regalo',
  GlassWater: 'Trago',
  Handshake: 'Alianza',
  IceCream2: 'Helado',
  MapPin: 'Ubicación',
  MessageCircle: 'WhatsApp',
  Percent: 'Porcentaje',
  Pizza: 'Pizza',
  Scissors: 'Peluquería',
  Shirt: 'Remera',
  Sparkles: 'Destello',
  Stamp: 'Sello',
  Star: 'Estrella',
  Ticket: 'Entrada',
  Trophy: 'Trofeo',
  UtensilsCrossed: 'Comida',
  Wine: 'Vino',
}

export const ICON_NAMES: readonly string[] = Object.keys(CURATED_ICONS)

export function resolveIcon(name: string | null | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback
  // `Object.hasOwn` y no un índice suelto: `CURATED_ICONS` es un objeto literal,
  // así que `CURATED_ICONS['constructor']` devuelve `Object` (heredado de
  // Object.prototype) y el `?? fallback` no lo ataja. React lo renderizaría
  // como componente y tiraría abajo la pantalla entera.
  return Object.hasOwn(CURATED_ICONS, name) ? (CURATED_ICONS[name] ?? fallback) : fallback
}

export function LucideByName({
  name,
  fallback,
  className,
}: {
  name: string | null | undefined
  fallback: LucideIcon
  className?: string
}): React.JSX.Element {
  const Icon = resolveIcon(name, fallback)
  return <Icon className={className} aria-hidden="true" />
}
