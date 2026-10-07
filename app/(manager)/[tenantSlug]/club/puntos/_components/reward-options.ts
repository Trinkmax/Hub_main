import { Beer, Coffee, Gift, type LucideIcon, Ticket, UtensilsCrossed } from 'lucide-react'

/** Etiquetas legibles para las categorías canónicas del catálogo de canje. */
export const REWARD_CATEGORY_LABELS: Record<string, string> = {
  desayuno: 'Desayuno y merienda',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
  evento: 'Eventos',
}

/** El dibujo de una recompensa sin foto, según su momento del día. */
export const REWARD_CATEGORY_ICON: Record<string, LucideIcon> = {
  desayuno: Coffee,
  almuerzo: UtensilsCrossed,
  cena: Beer,
  evento: Ticket,
}

export const DEFAULT_REWARD_ICON: LucideIcon = Gift
