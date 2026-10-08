import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ChefHat,
  ClipboardList,
  Coins,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MonitorSmartphone,
  Settings2,
  Star,
  Tag,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
  Zap,
} from 'lucide-react'

/**
 * Map keys → componentes Lucide para el sidebar (nav-config.ts) y la nav de
 * Mensajería (messaging-nav.ts). Mantenemos las KEYS como literales
 * serializables (string) para poder pasarlos de Server Components a Client
 * Components sin romper la frontera RSC. El mapping vive solo en el cliente
 * que renderiza.
 *
 * Sólo los íconos que esas dos configs usan: el objeto entero viaja al bundle
 * del cliente, así que cada key de más es peso muerto. El ⌘K importa sus
 * íconos directo de lucide-react.
 */
export const NAV_ICONS = {
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ChefHat,
  ClipboardList,
  Coins,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MonitorSmartphone,
  Settings2,
  Star,
  Tag,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
  Zap,
} satisfies Record<string, LucideIcon>

export type NavIconKey = keyof typeof NAV_ICONS
