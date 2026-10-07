import {
  ArrowLeftRight,
  Banknote,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BarChart3,
  BookOpen,
  BookOpenText,
  BookText,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarCheck2,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileCode2,
  FilePlus2,
  FileText,
  Gift,
  HandCoins,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ListChecks,
  ListTree,
  Lock,
  type LucideIcon,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  Package,
  PartyPopper,
  Percent,
  Receipt,
  ReceiptText,
  Scale,
  Settings2,
  Sparkles,
  Stamp,
  Star,
  SwatchBook,
  Tags,
  Truck,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  Workflow,
  Zap,
} from 'lucide-react'
import {
  type CommandAccountingGate,
  commandAccountingAllows,
  NO_ACCOUNTING_ACCESS,
} from '@/components/shell/accounting-gates'
import { matchesPath } from '@/components/shell/nav-active'
import type { FeatureKey, TenantFeatures } from '@/lib/platform/features'
import { ACCOUNTING_READ_ROLES } from '@/lib/tenant/roles'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import { PUBLIC_WORKSPACE_SEGMENTS } from '@/lib/workspace'

/**
 * Los grupos de la paleta, en el orden en que se muestran. El tipo del grupo
 * sale de esta lista: una entrada no puede tener un grupo que no se dibuje
 * (antes el union y el orden vivían en archivos distintos y una entrada con un
 * grupo fuera del orden desaparecía en silencio).
 */
export const COMMAND_GROUPS = ['Acciones rápidas', 'Administración', 'Operación', 'Ir a'] as const

export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export type CommandActionType = 'navigate' | 'navigate-new'

/**
 * Las acciones rápidas de Administración que son hojas, no páginas (contable
 * §H.0): se abren con `?accion=` sobre la pantalla de Administración en la que
 * estés, o sobre el Resumen de Administración si venís de otro lado.
 */
export type AccountingSheetAction = 'gasto' | 'pagar' | 'cobrar' | 'mover' | 'ajustar'

export type CommandEntry = {
  id: string
  label: string
  icon: LucideIcon
  group: CommandGroup
  /**
   * `navigate`: una página (puede volver en «Recientes»). `navigate-new`: una
   * acción (crear, cargar, cerrar); nunca es «Reciente».
   */
  type: CommandActionType
  /** Devuelve el path destino dado el slug. */
  href: (slug: string) => string
  /** Para narrow keyword search en cmdk. */
  keywords?: string[]
  /**
   * Si está, sólo se muestra cuando la feature está ON (o quien mira es
   * superadmin, salvo en lo que lleva `accounting`).
   */
  feature?: FeatureKey
  /**
   * Roles que ven la entrada. Default: solo owner (fail-closed: el palette es
   * mayormente territorio del dueño; los roles acotados suman lo suyo explícito).
   */
  roles?: ReadonlyArray<TenantRole>
  /**
   * Administración: además del rol y del flag, el acceso por persona
   * (`TenantAccess.accounting`). `read` = navegación; `write` = cargar, pagar,
   * cerrar: nunca la contadora ni un dueño sin acceso.
   */
  accounting?: CommandAccountingGate
  /** Hoja de Administración que abre (ver `resolveCommandHref`). */
  sheetAction?: AccountingSheetAction
  /** Pista a la derecha, en texto de apoyo: dónde vive la página («Libros»). */
  hint?: string
}

/**
 * Palabras que encuentran cualquier entrada de Administración (con y sin
 * tildes: nadie tipea la tilde apurado). Cada entrada suma las suyas.
 */
const ACCOUNTING_KEYWORDS = [
  'administracion',
  'administración',
  'contable',
  'contabilidad',
  'contadora',
]

export const commandEntries: CommandEntry[] = [
  // Acciones rápidas (mutaciones / new resource)
  {
    id: 'new-customer',
    label: 'Nuevo cliente',
    icon: Users,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/clientes/nuevo`,
    keywords: ['cliente', 'persona', 'agregar', 'crear'],
  },
  {
    // El alta pelada: al guardar vuelve a la lista de Reservas en el día de la
    // reserva (sin ?volver, el destino por defecto).
    id: 'new-reservation',
    label: 'Nueva reserva',
    icon: CalendarCheck,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/reservas/nuevo`,
    keywords: ['reserva', 'mesa', 'agendar', 'crear'],
    roles: ['owner', 'host'],
  },
  {
    id: 'new-broadcast',
    label: 'Nueva difusión',
    icon: Megaphone,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/mensajeria/difusiones/nueva`,
    keywords: ['enviar', 'whatsapp', 'broadcast', 'campaña'],
  },
  {
    id: 'new-event',
    label: 'Programar evento',
    icon: CalendarDays,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/eventos/programados/nuevo`,
    keywords: ['fecha', 'agenda', 'show', 'fiesta', 'calendario'],
    roles: ['owner', 'host'],
  },
  {
    id: 'new-flow',
    label: 'Nueva automatización',
    icon: Workflow,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/mensajeria/flows/nuevo`,
    keywords: ['automatización', 'recurrente'],
  },
  {
    id: 'new-marketing-task',
    label: 'Nueva tarea de marketing',
    icon: ListChecks,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/tareas`,
    keywords: ['tarea', 'marketing', 'contenido', 'reel', 'historia', 'diseño'],
  },
  {
    id: 'new-landing-page',
    label: 'Nueva página HTML',
    icon: FileCode2,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/paginas`,
    keywords: ['landing', 'html', 'promo', 'evento', 'pagina', 'publicar'],
  },
  {
    id: 'close-table-legacy',
    label: 'Cerrar mesa (legacy)',
    icon: Receipt,
    group: 'Acciones rápidas',
    type: 'navigate',
    href: (s) => `/${s}/visitas/nueva`,
    keywords: ['cerrar', 'mesa', 'cobrar'],
    feature: 'table_service',
  },

  // Administración (contable §H.0). Acciones: solo dueños con acceso de
  // escritura (`roles` por defecto owner + `accounting: 'write'`).
  {
    id: 'acc-new-expense',
    label: 'Nuevo gasto',
    icon: ReceiptText,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion?accion=gasto`,
    sheetAction: 'gasto',
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'gasto',
      'compra',
      'ticket',
      'pague',
      'pagué',
      'compre',
      'compré',
    ],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-sales-close',
    label: 'Cierre del día',
    icon: ClipboardCheck,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion/ventas/cierre`,
    keywords: [...ACCOUNTING_KEYWORDS, 'cierre', 'ventas', 'caja', 'thinkeon', 'dia', 'día'],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-pay-supplier',
    label: 'Pagar a un proveedor',
    icon: BanknoteArrowUp,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion?accion=pagar`,
    sheetAction: 'pagar',
    keywords: [...ACCOUNTING_KEYWORDS, 'pagar', 'pago', 'orden de pago', 'proveedor', 'deuda'],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-collect',
    label: 'Registrar un cobro',
    icon: BanknoteArrowDown,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion?accion=cobrar`,
    sheetAction: 'cobrar',
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'cobro',
      'cobrar',
      'acreditacion',
      'acreditación',
      'liquidacion',
      'liquidación',
      'posnet',
      'pedidosya',
    ],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-transfer',
    label: 'Mover plata',
    icon: ArrowLeftRight,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion?accion=mover`,
    sheetAction: 'mover',
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'transferir',
      'transferencia',
      'depositar',
      'deposito',
      'depósito',
    ],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-adjust-balance',
    label: 'Ajustar saldo de una caja',
    icon: Scale,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion?accion=ajustar`,
    sheetAction: 'ajustar',
    keywords: [...ACCOUNTING_KEYWORDS, 'arqueo', 'contar caja', 'mercado pago', 'saldo', 'ajuste'],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-new-purchase-invoice',
    label: 'Nueva factura de proveedor',
    icon: FilePlus2,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion/compras/nueva`,
    keywords: [...ACCOUNTING_KEYWORDS, 'factura', 'comprobante', 'compra', 'proveedor', 'iva'],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-bank-expense',
    label: 'Gasto bancario',
    icon: Building2,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion/cajas/gasto-bancario`,
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'banco',
      'comision',
      'comisión',
      'impuesto',
      'debito',
      'débito',
    ],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-manual-entry',
    label: 'Asiento manual',
    icon: NotebookPen,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion/libros/asiento-manual`,
    keywords: [...ACCOUNTING_KEYWORDS, 'asiento', 'ajuste', 'sueldos', 'debe', 'haber'],
    feature: 'accounting',
    accounting: 'write',
  },
  {
    id: 'acc-close-month',
    label: 'Cerrar el mes',
    icon: Lock,
    group: 'Administración',
    type: 'navigate-new',
    href: (s) => `/${s}/administracion/libros/cierres`,
    keywords: [...ACCOUNTING_KEYWORDS, 'cierre', 'cerrar', 'mes', 'periodo', 'período'],
    feature: 'accounting',
    accounting: 'write',
  },
  // Administración · navegación: dueños con acceso y la contadora.
  {
    id: 'acc-home',
    label: 'Resumen de Administración',
    icon: Landmark,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion`,
    keywords: [...ACCOUNTING_KEYWORDS, 'resumen', 'plata', 'saldos', 'balance'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
  },
  {
    id: 'acc-suppliers',
    label: 'Proveedores',
    icon: Truck,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/compras?tab=proveedores`,
    keywords: [...ACCOUNTING_KEYWORDS, 'proveedores', 'compras', 'cuenta corriente', 'deuda'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Compras',
  },
  {
    id: 'acc-customers',
    label: 'Clientes y plataformas',
    icon: HandCoins,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/ventas?tab=clientes`,
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'clientes',
      'ventas',
      'plataformas',
      'tarjetas',
      'billeteras',
    ],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Ventas',
  },
  {
    id: 'acc-treasury',
    label: 'Cajas y bancos',
    icon: Wallet,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/cajas`,
    keywords: [...ACCOUNTING_KEYWORDS, 'cajas', 'bancos', 'saldos', 'mercado pago', 'flujo'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
  },
  {
    id: 'acc-journal',
    label: 'Libro diario',
    icon: BookText,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/diario`,
    keywords: [...ACCOUNTING_KEYWORDS, 'libro', 'diario', 'asientos'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-ledger',
    label: 'Mayor',
    icon: BookOpenText,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/mayor`,
    keywords: [...ACCOUNTING_KEYWORDS, 'libro', 'mayor', 'cuenta', 'movimientos'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-trial-balance',
    label: 'Sumas y saldos',
    icon: Calculator,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/sumas-y-saldos`,
    keywords: [...ACCOUNTING_KEYWORDS, 'sumas', 'saldos', 'balance', 'balance de comprobacion'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-iva-purchases',
    label: 'Libro IVA compras',
    icon: FileText,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/iva-compras`,
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'libro',
      'iva',
      'compras',
      'credito fiscal',
      'crédito fiscal',
    ],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-iva-sales',
    label: 'Libro IVA ventas',
    icon: FileText,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/iva-ventas`,
    keywords: [...ACCOUNTING_KEYWORDS, 'libro', 'iva', 'ventas', 'debito fiscal', 'débito fiscal'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-iva-position',
    label: 'Posición de IVA',
    icon: Percent,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/posicion-iva`,
    keywords: [
      ...ACCOUNTING_KEYWORDS,
      'iva',
      'posicion',
      'posición',
      'saldo tecnico',
      'saldo técnico',
    ],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-monthly-package',
    label: 'Paquete del mes',
    icon: Package,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros`,
    keywords: [...ACCOUNTING_KEYWORDS, 'paquete', 'exportar', 'libros', 'mes', 'excel', 'csv'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-month-closings',
    label: 'Cierres de mes',
    icon: CalendarCheck2,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/libros/cierres`,
    keywords: [...ACCOUNTING_KEYWORDS, 'cierres', 'meses', 'periodos', 'períodos', 'ejercicio'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
    hint: 'Libros',
  },
  {
    id: 'acc-chart-of-accounts',
    label: 'Plan de cuentas',
    icon: ListTree,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/plan-de-cuentas`,
    keywords: [...ACCOUNTING_KEYWORDS, 'plan de cuentas', 'cuentas', 'rubros', 'mayor'],
    roles: ACCOUNTING_READ_ROLES,
    feature: 'accounting',
    accounting: 'read',
  },
  {
    // Solo escritura: la contadora no configura nada.
    id: 'acc-settings',
    label: 'Ajustes de Administración',
    icon: Settings2,
    group: 'Administración',
    type: 'navigate',
    href: (s) => `/${s}/administracion/ajustes`,
    keywords: [...ACCOUNTING_KEYWORDS, 'ajustes', 'accesos', 'sas', 'ejercicio', 'puntos de venta'],
    feature: 'accounting',
    accounting: 'write',
  },

  // Operación (turno en vivo)
  {
    id: 'live-sessions',
    label: 'Salón en vivo',
    icon: ClipboardList,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/salon/mesas`,
    keywords: ['mesas', 'sesiones', 'salón', 'live'],
    feature: 'table_service',
  },
  {
    id: 'kitchen',
    label: 'Cocina',
    icon: ChefHat,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/salon/cocina`,
    keywords: ['kitchen', 'tickets', 'pedidos'],
    feature: 'kitchen',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/mensajeria/inbox`,
    keywords: ['mensajes', 'whatsapp', 'instagram', 'inbox', 'bandeja', 'mensajeria'],
  },

  // Ir a (navegación)
  {
    id: 'operativo',
    label: 'Operativo',
    icon: ClipboardList,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/operativo`,
    keywords: ['hoy', 'timeline', 'llegadas', 'dia'],
    roles: ['owner', 'host'],
  },
  {
    id: 'my-numbers',
    label: 'Mis números',
    icon: BarChart3,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/mis-numeros`,
    keywords: ['comisiones', 'ganancias', 'plata', 'liquidacion'],
    roles: ['host'],
  },
  {
    id: 'home',
    label: 'Resumen',
    icon: LayoutDashboard,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}`,
    keywords: ['dashboard', 'home', 'inicio'],
  },
  {
    id: 'people',
    label: 'Personas',
    icon: Users,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/clientes`,
    keywords: ['clientes', 'crm'],
  },
  {
    id: 'marketing-tasks',
    label: 'Tareas de marketing',
    icon: ListChecks,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/tareas`,
    keywords: ['tareas', 'marketing', 'contenido', 'organico', 'checklist', 'socios'],
  },
  {
    id: 'public-links',
    label: 'Link de Instagram',
    icon: Link2,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/enlaces`,
    keywords: ['bio', 'instagram', 'linktree', 'biolink', 'enlaces', 'links'],
  },
  {
    id: 'landing-pages',
    label: 'Páginas',
    icon: FileCode2,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/paginas`,
    keywords: ['landing', 'html', 'pagina', 'promo', 'evento', 'link', 'web'],
  },
  {
    id: 'audiences',
    label: 'Audiencias',
    icon: UsersRound,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/mensajeria/audiencias`,
    keywords: ['segmentos', 'filtros'],
  },
  {
    id: 'broadcasts',
    label: 'Difusiones',
    icon: Megaphone,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/mensajeria/difusiones`,
    keywords: ['campañas', 'whatsapp'],
  },
  {
    id: 'flows',
    label: 'Automatizaciones',
    icon: Workflow,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/mensajeria/flows`,
    keywords: ['automatización'],
  },
  {
    id: 'calendar',
    label: 'Calendario',
    icon: CalendarDays,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/eventos/programados`,
    // Desde el calendario también se reserva (por servicio o adentro de un
    // evento): buscar «reserva» trae Reservas y también el calendario.
    keywords: [
      'agenda',
      'mes',
      'sushi libre',
      'pizza libre',
      'cupos',
      'eventos',
      'fiesta',
      'show',
      'peña',
      'reserva',
      'reservas',
      'reservar',
      'mesa',
    ],
    roles: ['owner', 'host'],
  },
  {
    id: 'reservations',
    label: 'Reservas',
    icon: CalendarCheck,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/reservas`,
    keywords: ['reserva', 'mesa', 'reservar', 'lista', 'pasar lista'],
    roles: ['owner', 'host'],
  },
  {
    id: 'menu',
    label: 'Carta',
    icon: UtensilsCrossed,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/menu`,
    keywords: ['menu', 'carta', 'productos', 'items', 'fotos'],
    roles: ['owner', 'editor'],
  },
  {
    id: 'club',
    label: 'Club de beneficios',
    icon: Star,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/club?tab=programa`,
    keywords: ['fidelizacion', 'lealtad', 'loyalty', 'beneficios'],
  },
  {
    id: 'tiers',
    label: 'Niveles del club',
    icon: Sparkles,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/club?tab=programa`,
    keywords: ['vip', 'tiers', 'escalones', 'club'],
  },
  {
    id: 'points',
    label: 'Puntos y recompensas',
    icon: Gift,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/club?tab=programa`,
    keywords: ['fidelidad', 'rewards', 'recompensas', 'club'],
  },
  {
    id: 'punch-cards',
    label: 'Punch cards',
    icon: Stamp,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/club?tab=punch`,
    keywords: ['tarjetas', 'sellos', 'club'],
  },
  {
    id: 'welcome-gift',
    label: 'Regalo de bienvenida',
    icon: Star,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/club?tab=bienvenida`,
    keywords: ['bienvenida', 'welcome', 'regalo', 'club'],
  },
  {
    id: 'tags',
    label: 'Tags de carta',
    icon: Tags,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/menu/tags`,
    keywords: ['etiquetas'],
    roles: ['owner', 'editor'],
  },
  {
    id: 'floor-plan',
    label: 'Plano del salón',
    icon: LayoutGrid,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/mesas`,
    keywords: ['mesas', 'floor', 'plano', 'salón'],
    feature: 'floor_plan',
  },
  {
    id: 'auto-accept',
    label: 'Auto-aceptación',
    icon: Zap,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/auto-aceptacion`,
    keywords: ['settings'],
    feature: 'auto_accept',
  },
  {
    id: 'templates',
    label: 'Plantillas WhatsApp',
    icon: MessageSquareText,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/mensajeria/plantillas`,
    keywords: ['mensajes', 'plantillas'],
  },
  {
    id: 'team',
    label: 'Equipo',
    icon: UsersRound,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion/equipo`,
    keywords: ['staff', 'invitar'],
  },
  {
    id: 'stats',
    label: 'Estadísticas',
    icon: BarChart3,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/estadisticas`,
    keywords: ['reportes', 'analytics'],
  },
  {
    id: 'how-it-went',
    label: 'Cómo nos fue',
    icon: PartyPopper,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/estadisticas/como-nos-fue`,
    keywords: [
      'gente',
      'personas',
      'cubiertos',
      'asistencia',
      'evento',
      'noche',
      'promedio',
      'como nos fue',
      'pauta',
      'meta',
      'anuncios',
      'publicidad',
    ],
  },
  {
    id: 'deposits',
    label: 'Señas',
    icon: Banknote,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/estadisticas/senas`,
    // Con y sin tilde: el matching de cmdk es literal sobre label + keywords y
    // nadie escribe "señas" con la eñe cuando está apurado.
    keywords: ['senas', 'senias', 'sena', 'adelanto', 'anticipo', 'deposito', 'plata', 'ingresos'],
  },
  {
    id: 'commissions',
    label: 'Comisiones',
    icon: Coins,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/estadisticas/comisiones`,
    keywords: ['liquidacion', 'gestores', 'plata'],
  },
  {
    id: 'docs',
    label: 'Documentación',
    icon: BookOpen,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/docs`,
    keywords: ['ayuda', 'guía', 'manual', 'help'],
  },
  {
    // El catálogo interno del kit (kit §6.1): no está en el menú lateral ni en
    // el de la cuenta, que se abren muchas veces por día. Se llega desde acá y
    // desde Documentación. Solo el dueño.
    id: 'component-catalog',
    label: 'Catálogo de componentes',
    icon: SwatchBook,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/docs/componentes`,
    keywords: ['componentes', 'kit', 'diseño', 'diseno', 'catalogo', 'catálogo', 'ui'],
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings2,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion`,
    keywords: ['ajustes', 'preferencias'],
  },
]

// ─── Visibilidad, grupos y destino ───────────────────────────────────────────

const DEFAULT_COMMAND_ROLES: ReadonlyArray<TenantRole> = ['owner']

export type CommandAudience = {
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** `TenantAccess.accounting`. Sin él, Administración queda cerrada. */
  accounting?: AccountingAccess
}

/**
 * Rol (fail-closed: sin `roles`, solo el dueño) + flag (el superadmin ve los
 * paneles apagados, salvo Administración, donde la base no lo deja entrar por
 * serlo) + acceso por persona a Administración.
 */
export function isCommandVisible(entry: CommandEntry, audience: CommandAudience): boolean {
  const roleOk = (entry.roles ?? DEFAULT_COMMAND_ROLES).includes(audience.role)
  const featureOk =
    !entry.feature ||
    audience.features[entry.feature] ||
    (audience.isPlatformAdmin && !entry.accounting)
  const accountingOk = commandAccountingAllows(
    entry.accounting,
    audience.accounting ?? NO_ACCOUNTING_ACCESS,
  )
  return roleOk && featureOk && accountingOk
}

export function visibleCommandEntries(
  entries: ReadonlyArray<CommandEntry>,
  audience: CommandAudience,
): CommandEntry[] {
  return entries.filter((entry) => isCommandVisible(entry, audience))
}

/** Agrupa en el orden de `COMMAND_GROUPS` y descarta los grupos vacíos. */
export function groupCommandEntries(
  entries: ReadonlyArray<CommandEntry>,
): Array<{ group: CommandGroup; items: CommandEntry[] }> {
  return COMMAND_GROUPS.map((group) => ({
    group,
    items: entries.filter((entry) => entry.group === group),
  })).filter((g) => g.items.length > 0)
}

/** Parámetros propios de una hoja de Administración: no pasan a la que se abre desde ⌘K. */
const SHEET_PARAMS = ['accion', 'proveedor', 'cliente', 'caja', 'partida'] as const

/**
 * A dónde lleva una entrada. Las hojas de Administración (`sheetAction`) se
 * abren sobre la pantalla de Administración en la que estés (conservando su
 * pestaña o su período); desde cualquier otro lado, sobre el Resumen de
 * Administración. El resto va a su `href`.
 */
export function resolveCommandHref(
  entry: CommandEntry,
  slug: string,
  location: { pathname: string; search: string },
): string {
  if (entry.sheetAction && matchesPath(location.pathname, `/${slug}/administracion`)) {
    const params = new URLSearchParams(location.search)
    for (const key of SHEET_PARAMS) params.delete(key)
    params.set('accion', entry.sheetAction)
    return `${location.pathname}?${params.toString()}`
  }
  return entry.href(slug)
}

/**
 * ¿El destino es el salón o una superficie pública? Esos tienen su propio
 * `<html>` (tema, avisos): se llega con una recarga, nunca con una navegación
 * blanda, que conservaría el `<html>` del panel (kit §7.a.4).
 */
export function needsFullReload(href: string, slug: string): boolean {
  const path = href.split(/[?#]/)[0] ?? href
  const [first, second] = path.split('/').filter(Boolean)
  if (!first) return false
  if (first === slug && second === 'salon') return true
  return PUBLIC_WORKSPACE_SEGMENTS.has(first)
}
