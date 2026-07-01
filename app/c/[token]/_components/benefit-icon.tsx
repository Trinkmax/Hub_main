import {
  BadgePercent,
  Beer,
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
  Percent,
  Pizza,
  Scissors,
  Shirt,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  UtensilsCrossed,
  Wine,
} from 'lucide-react'

// Resolver curado de iconos Lucide por nombre (string guardado en DB:
// loyalty_tiers.badge_icon y tier_benefits.icon). Curado a propósito para no
// bundlear todo lucide dinámicamente; si el nombre no está, cae al fallback.
const ICONS: Record<string, LucideIcon> = {
  BadgePercent,
  Beer,
  Cake,
  CalendarDays,
  Coffee,
  Crown,
  Gem,
  Gift,
  GlassWater,
  Handshake,
  IceCream2,
  Percent,
  Pizza,
  Scissors,
  Shirt,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  UtensilsCrossed,
  Wine,
}

export function resolveIcon(name: string | null | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback
  return ICONS[name] ?? fallback
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
