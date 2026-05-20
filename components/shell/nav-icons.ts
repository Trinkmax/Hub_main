import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Coins,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MonitorSmartphone,
  ScanLine,
  Settings2,
  Sparkles,
  Stamp,
  Star,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
} from 'lucide-react'

/**
 * Map keys → componentes Lucide para el sidebar y el command palette.
 * Mantenemos las KEYS como literales serializables (string) para poder
 * pasarlos de Server Components a Client Components sin romper la
 * frontera RSC. El mapping vive solo en el cliente que renderiza.
 */
export const NAV_ICONS = {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Coins,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MonitorSmartphone,
  ScanLine,
  Settings2,
  Sparkles,
  Stamp,
  Star,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
} satisfies Record<string, LucideIcon>

export type NavIconKey = keyof typeof NAV_ICONS
