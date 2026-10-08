/**
 * «Cómo arrancar con Administración» (diseño §5.2): qué se carga una sola vez,
 * qué todos los días, qué todas las semanas y qué todos los meses, y cuándo
 * cada cosa está lista (desde la base: `acc_report_onboarding`).
 *
 * Puro: lo usan la lectura (`queries/onboarding.ts`), la página de la guía y la
 * tarjeta «Primeros pasos» del Resumen. Los textos van de vos, cortos.
 *
 * Los ítems «a mano» (los que solo pasan afuera de la plataforma, como pedirle
 * a los proveedores que facturen a la SAS) se marcan con «Ya lo hice»
 * (`markOnboardingStep` → `acc_guide_progress`, guía `arranque`). Algunos
 * automáticos aceptan además esa marca («Ya cargué los que tengo»).
 */

import { daysBetween, isRealIsoDay } from '@/lib/dates/civil'
import { isoDayInCordoba } from '@/lib/dates/zone'
import { formatCuit } from '@/lib/fiscal'

// ─── Lo que devuelve la base ─────────────────────────────────────────────────

export const SAS_REQUIRED_FIELDS = [
  'cuit',
  'iibb_number',
  'activity_start_date',
  'fiscal_address',
] as const
export type SasRequiredField = (typeof SAS_REQUIRED_FIELDS)[number]

export type OnboardingImportSource =
  | 'arca_recibidos'
  | 'arca_emitidos'
  | 'mp_release'
  | 'bank_statement'

export type OnboardingImportStats = {
  /** Instante (ISO) del último lote no cancelado. */
  lastBatchAt: string | null
  /** Lotes con algo contabilizado (cargando o terminados). */
  postedBatches: number
  /** Lotes esperando revisión o carga. */
  pendingReview: number
}

/** `acc_report_onboarding` en camelCase. */
export type OnboardingData = {
  today: string
  /** Datos de la SAS que faltan. */
  sasMissing: SasRequiredField[]
  bankWithCbu: boolean
  walletWithCvu: boolean
  salesMethods: number
  salesPoints: number
  openingDone: boolean
  partnerGranted: boolean
  accountantAdded: boolean
  arca: { status: string; certNotAfter: string | null; emissionEnabled: boolean } | null
  arcaVouchersAttention: number
  mp: { status: string; lastSyncAt: string | null; lastErrorKey: string | null } | null
  imports: Partial<Record<OnboardingImportSource, OnboardingImportStats>>
  /** Hay un lote de Mis Comprobantes que cubre todo el mes anterior. */
  mcPrevMonthCovered: boolean
  recurringActive: number
  /** Días de los últimos 7 (desde el inicio de los libros) sin cierre del día. */
  dailyCloseMissing: number
  /** Hay una factura de comisiones (`settles_commissions`) en el mes. */
  mpInvoiceThisMonth: boolean
  /** Cajas sin «Ajustar saldo» en el mes (sin contar la tarjeta de la empresa). */
  treasuriesUnchecked: number
  prevMonthClosed: boolean
  /** Ítems marcados a mano («Ya lo hice»). */
  manual: string[]
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return 0
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

const IMPORT_SOURCES: readonly OnboardingImportSource[] = [
  'arca_recibidos',
  'arca_emitidos',
  'mp_release',
  'bank_statement',
]

/** El jsonb de `acc_report_onboarding` → `OnboardingData`; `null` si no es uno. */
export function parseOnboardingData(raw: unknown): OnboardingData | null {
  const r = rec(raw)
  if (!r) return null
  const today = text(r.today)?.slice(0, 10)
  if (!today || !isRealIsoDay(today)) return null
  const arca = rec(r.arca)
  const mp = rec(r.mp)
  const importsRaw = rec(r.imports) ?? {}
  const imports: OnboardingData['imports'] = {}
  for (const source of IMPORT_SOURCES) {
    const s = rec(importsRaw[source])
    if (!s) continue
    imports[source] = {
      lastBatchAt: text(s.last_batch_at),
      postedBatches: num(s.posted_batches),
      pendingReview: num(s.pending_review),
    }
  }
  const sasMissing = (Array.isArray(r.sas_missing) ? r.sas_missing : []).filter(
    (f): f is SasRequiredField => (SAS_REQUIRED_FIELDS as readonly unknown[]).includes(f),
  )
  return {
    today,
    sasMissing,
    bankWithCbu: r.bank_with_cbu === true,
    walletWithCvu: r.wallet_with_cvu === true,
    salesMethods: num(r.sales_methods),
    salesPoints: num(r.sales_points),
    openingDone: r.opening_done === true,
    partnerGranted: r.partner_granted === true,
    accountantAdded: r.accountant_added === true,
    arca: arca
      ? {
          status: text(arca.status) ?? 'draft',
          certNotAfter: text(arca.cert_not_after),
          emissionEnabled: arca.emission_enabled === true,
        }
      : null,
    arcaVouchersAttention: num(r.arca_vouchers_attention),
    mp: mp
      ? {
          status: text(mp.status) ?? 'csv_only',
          lastSyncAt: text(mp.last_sync_at),
          lastErrorKey: text(mp.last_error_key),
        }
      : null,
    imports,
    mcPrevMonthCovered: r.mc_prev_month_covered === true,
    recurringActive: num(r.recurring_active),
    dailyCloseMissing: num(r.daily_close_missing),
    mpInvoiceThisMonth: r.mp_invoice_this_month === true,
    treasuriesUnchecked: num(r.treasuries_unchecked),
    prevMonthClosed: r.prev_month_closed === true,
    manual: (Array.isArray(r.manual) ? r.manual : []).filter(
      (s): s is string => typeof s === 'string',
    ),
  }
}

// ─── Los ítems de la guía ────────────────────────────────────────────────────

export const ONBOARDING_SECTIONS = ['day1', 'daily', 'weekly', 'monthly'] as const
export type OnboardingSection = (typeof ONBOARDING_SECTIONS)[number]

export const ONBOARDING_SECTION_LABEL: Readonly<Record<OnboardingSection, string>> = {
  day1: 'Día 1 · una sola vez',
  daily: 'Todos los días (≈ 5 minutos)',
  weekly: 'Todas las semanas',
  monthly: 'Todos los meses',
}

export const ONBOARDING_ITEM_IDS = [
  'sas_data',
  'treasuries',
  'sales_methods',
  'sales_points',
  'opening',
  'access',
  'arca',
  'arca_first_import',
  'recurring',
  'mp_connect',
  'suppliers_message',
  'daily_close',
  'small_expenses',
  'mp_weekly',
  'bank_weekly',
  'arca_monthly',
  'mp_invoice',
  'treasury_check',
  'month_close',
] as const
export type OnboardingItemId = (typeof ONBOARDING_ITEM_IDS)[number]

/**
 * - `auto`: lo verifica la plataforma.
 * - `manual`: solo pasa afuera; se marca con «Ya lo hice».
 * - `info`: no se marca (es para saber dónde se hace).
 */
export type OnboardingKind = 'auto' | 'manual' | 'info'

export type OnboardingItem = {
  id: OnboardingItemId
  section: OnboardingSection
  title: string
  /** El chip «Dónde»: texto y ruta relativa a `/<bar>/administracion` (`null` si es afuera). */
  where: { label: string; path: string | null }
  /** «Qué cargás» (una línea). */
  what: string
  /** «Cómo» (hasta 3 viñetas). */
  how: readonly string[]
  /** «La plataforma lo hace sola» (si aplica). */
  auto: string | null
  /** Tiempo estimado en minutos (`null` si no aplica). */
  minutes: number | null
  /** El botón de acción. */
  actionLabel: string | null
  kind: OnboardingKind
  /** No cuenta para «X de Y listos». */
  optional?: true
  /** Un ítem automático que también se puede dar por hecho a mano. */
  manualOverride?: true
}

export const ONBOARDING_ITEMS: readonly OnboardingItem[] = [
  {
    id: 'sas_data',
    section: 'day1',
    title: 'Datos de la SAS',
    where: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
    what: 'Razón social, CUIT, Ingresos Brutos, inicio de actividades y domicilio fiscal.',
    how: [
      'Copialos de la constancia de inscripción de ARCA.',
      'En Ingresos Brutos elegí si es local o Convenio Multilateral.',
    ],
    auto: null,
    minutes: 5,
    actionLabel: 'Completar',
    kind: 'auto',
  },
  {
    id: 'treasuries',
    section: 'day1',
    title: 'Cajas y cuentas',
    where: { label: 'Ajustes › Cajas y cuentas', path: '/ajustes?tab=cajas' },
    what: 'La caja de efectivo, el banco (CBU, alias y número) y Mercado Pago (CVU y alias).',
    how: [
      'Cargá también la tarjeta de crédito de la empresa, si hay.',
      'Los CBU y CVU sirven para reconocer tus transferencias entre cuentas.',
    ],
    auto: null,
    minutes: 5,
    actionLabel: 'Ir a Cajas',
    kind: 'auto',
    manualOverride: true,
  },
  {
    id: 'sales_methods',
    section: 'day1',
    title: 'Medios de cobro',
    where: { label: 'Ajustes › Medios de cobro', path: '/ajustes?tab=medios' },
    what: 'En el orden del cierre de caja de Thinkeon, y adónde va cada uno.',
    how: ['Efectivo, QR, transferencias, débito, crédito y plataformas de delivery.'],
    auto: null,
    minutes: 3,
    actionLabel: 'Revisar',
    kind: 'auto',
  },
  {
    id: 'sales_points',
    section: 'day1',
    title: 'Puntos de venta',
    where: { label: 'Ajustes › Puntos de venta', path: '/ajustes?tab=puntos-de-venta' },
    what: 'Los de Thinkeon con su canal (salón, delivery o eventos).',
    how: ['El de la plataforma lo crea «Conectar ARCA».'],
    auto: null,
    minutes: 2,
    actionLabel: 'Revisar',
    kind: 'auto',
  },
  {
    id: 'opening',
    section: 'day1',
    title: 'Saldos iniciales',
    where: { label: 'Configurar › Saldos iniciales', path: '/configurar' },
    what: 'A la fecha de arranque: efectivo, banco, Mercado Pago, facturas impagas y lo que te deben.',
    how: [
      'El efectivo contado, el banco según el resumen y Mercado Pago según la app.',
      'Las facturas impagas a proveedores y los impuestos a pagar.',
      'Si no hay nada, «Arrancar en cero».',
    ],
    auto: null,
    minutes: 20,
    actionLabel: 'Cargar saldos',
    kind: 'auto',
  },
  {
    id: 'access',
    section: 'day1',
    title: 'Accesos',
    where: { label: 'Ajustes › Accesos', path: '/ajustes?tab=accesos' },
    what: 'Los socios que van a cargar y la contadora (solo lectura).',
    how: ['Administración es privada: solo la ven los dueños que habilites.'],
    auto: null,
    minutes: 3,
    actionLabel: 'Ir a Accesos',
    kind: 'auto',
  },
  {
    id: 'arca',
    section: 'day1',
    title: 'Conectar ARCA',
    where: { label: 'Ajustes › ARCA', path: '/ajustes/arca' },
    what: 'La guía paso a paso: certificado, punto de venta y prueba de conexión.',
    how: ['Lo hace quien maneja la clave fiscal de la SAS.', 'Lleva unos 40 minutos.'],
    auto: 'Completa proveedores y clientes con la CUIT y emite facturas de eventos con CAE.',
    minutes: 40,
    actionLabel: 'Empezar a conectar',
    kind: 'auto',
  },
  {
    id: 'arca_first_import',
    section: 'day1',
    title: 'Proveedores y compras del mes pasado',
    where: { label: 'Importar › ARCA', path: '/importar/arca' },
    what: 'El ZIP de Mis Comprobantes (Recibidos) del mes anterior.',
    how: [
      'Bajalo de ARCA y arrastralo tal cual (no lo abras con Excel).',
      'Se crean los proveedores: vos solo elegís en qué gastás con cada uno.',
    ],
    auto: 'Arma cada compra con su IVA y detecta las que ya cargaste.',
    minutes: 15,
    actionLabel: 'Importar de ARCA',
    kind: 'auto',
  },
  {
    id: 'recurring',
    section: 'day1',
    title: 'Gastos fijos',
    where: { label: 'Compras › Gastos fijos', path: '/compras?tab=gastos-fijos' },
    what: 'Alquiler, luz, gas, agua, internet, Thinkeon, contador, seguros… con su día de vencimiento.',
    how: ['Te avisamos antes de cada vencimiento.'],
    auto: 'Avisa antes de cada vencimiento.',
    minutes: 10,
    actionLabel: 'Cargar gastos fijos',
    kind: 'auto',
    manualOverride: true,
  },
  {
    id: 'mp_connect',
    section: 'day1',
    title: 'Conectar Mercado Pago',
    where: { label: 'Importar › Mercado Pago', path: '/importar/mercado-pago' },
    what: 'A qué medio del cierre corresponde cada canal y el primer reporte de Liquidaciones.',
    how: ['Bajá el reporte de Liquidaciones desde la compu y subilo.'],
    auto: 'Separa la comisión, el IVA y los impuestos de cada cobro.',
    minutes: 10,
    actionLabel: 'Configurar',
    kind: 'auto',
    optional: true,
  },
  {
    id: 'suppliers_message',
    section: 'day1',
    title: 'Pedíselo a tus proveedores',
    where: { label: 'Por WhatsApp o mail', path: null },
    what: 'Que te facturen a la SAS, con Factura A.',
    how: ['Sin eso, la compra no aparece en ARCA o aparece como B y se pierde el crédito fiscal.'],
    auto: null,
    minutes: 5,
    actionLabel: 'Copiar el mensaje',
    kind: 'manual',
  },
  {
    id: 'daily_close',
    section: 'daily',
    title: 'Cierre del día',
    where: { label: 'Ventas › Cargar cierre', path: '/ventas/cierre' },
    what: 'Pegá la columna del cierre de caja de Thinkeon.',
    how: ['Lo vendido y cómo te pagaron: efectivo, QR, tarjetas y plataformas.'],
    auto: null,
    minutes: 5,
    actionLabel: 'Cargar cierre',
    kind: 'auto',
  },
  {
    id: 'small_expenses',
    section: 'daily',
    title: 'Gastos chicos',
    where: { label: '«Nuevo gasto» (⌘K o la barra del celular)', path: null },
    what: 'Hielo, verdulería, una compra suelta.',
    how: ['Lo que no tiene factura a nombre de la SAS.'],
    auto: null,
    minutes: 1,
    actionLabel: null,
    kind: 'info',
  },
  {
    id: 'mp_weekly',
    section: 'weekly',
    title: 'Mercado Pago',
    where: { label: 'Importar › Mercado Pago', path: '/importar/mercado-pago' },
    what: 'Bajá el reporte de Liquidaciones y subilo; revisá y confirmá los días nuevos.',
    how: ['Hasta 60 días por reporte.'],
    auto: 'Arma los cobros por día y medio, los impuestos y los retiros.',
    minutes: 10,
    actionLabel: 'Importar Mercado Pago',
    kind: 'auto',
  },
  {
    id: 'bank_weekly',
    section: 'weekly',
    title: 'Banco',
    where: { label: 'Importar › Banco', path: '/importar/banco' },
    what: 'Exportá los movimientos de Nación Empresa 24 y subilos.',
    how: ['Guarda 3 meses: no lo dejes pasar.'],
    auto: 'Arma los gastos bancarios del día y reconoce tus transferencias.',
    minutes: 10,
    actionLabel: 'Importar del banco',
    kind: 'auto',
  },
  {
    id: 'arca_monthly',
    section: 'monthly',
    title: 'Compras de ARCA (del 11 en adelante)',
    where: { label: 'Importar › ARCA', path: '/importar/arca' },
    what: 'Mis Comprobantes del mes anterior y el actual.',
    how: ['Las facturas pueden llegar tarde: bajá del 1 del mes anterior a hoy.'],
    auto: 'Saltea las que ya estaban cargadas.',
    minutes: 15,
    actionLabel: 'Importar de ARCA',
    kind: 'auto',
  },
  {
    id: 'mp_invoice',
    section: 'monthly',
    title: 'Factura de Mercado Pago',
    where: { label: 'Compras › Nueva compra', path: '/compras/nueva' },
    what: 'La factura mensual de comisiones (o llega por Importar › ARCA).',
    how: ['Marcá «Es la factura mensual de comisiones».'],
    auto: 'Pasa a crédito fiscal el IVA de las comisiones que ya se descontaron.',
    minutes: 3,
    actionLabel: 'Cargar la factura',
    kind: 'auto',
  },
  {
    id: 'treasury_check',
    section: 'monthly',
    title: 'Ajustar saldos',
    where: { label: 'Cajas › Ajustar saldo', path: '/cajas?accion=ajustar' },
    what: 'Contá el efectivo y compará el banco y Mercado Pago.',
    how: ['Una vez por mes para cada caja.'],
    auto: null,
    minutes: 10,
    actionLabel: 'Ajustar saldos',
    kind: 'auto',
  },
  {
    id: 'month_close',
    section: 'monthly',
    title: 'Cerrar el mes con la contadora',
    where: { label: 'Libros › Cierres', path: '/libros/cierres' },
    what: 'Revisar la lista y cerrar. La contadora baja el «Paquete del mes».',
    how: ['Después de cerrar, el mes no se puede tocar sin reabrirlo.'],
    auto: null,
    minutes: 15,
    actionLabel: 'Ir a Cierres',
    kind: 'auto',
  },
]

/** Los pasos que se pueden marcar a mano (`acc_guide_progress`, guía `arranque`). */
export const ONBOARDING_MANUAL_STEPS: readonly OnboardingItemId[] = ONBOARDING_ITEMS.filter(
  (i) => i.kind === 'manual' || i.manualOverride,
).map((i) => i.id)

/** «Qué tener a mano» (casillas de ayuda, no se guardan). */
export const ONBOARDING_HAVE_AT_HAND: readonly string[] = [
  'La constancia de CUIT de la SAS y la de Rentas (Ingresos Brutos).',
  'El último resumen del banco (el saldo a la fecha de arranque).',
  'El saldo de Mercado Pago de ese día.',
  'El efectivo contado de la caja.',
  'Las facturas impagas a proveedores (proveedor, número, importe y vencimiento).',
  'Lo que te deben: tarjetas y plataformas a acreditar, clientes.',
  'Los gastos fijos con su día de vencimiento.',
  'Los puntos de venta de Thinkeon.',
]

/** «Lo que hace la plataforma sola» (pie de la guía). */
export const PLATFORM_DOES: readonly string[] = [
  'Completa proveedores y clientes con ARCA.',
  'Detecta comprobantes repetidos.',
  'Separa la comisión, el IVA y los impuestos de Mercado Pago.',
  'Arma los gastos bancarios del día.',
  'Propone la cuenta de cada proveedor.',
  'Numera las facturas con ARCA.',
  'Avisa los vencimientos (gastos fijos y certificado).',
]

// ─── Estado ──────────────────────────────────────────────────────────────────

export type OnboardingStatus = 'done' | 'todo' | 'info'

export type OnboardingItemState = OnboardingItem & {
  status: OnboardingStatus
  /** Se marcó con «Ya lo hice» (no lo verificó la plataforma). */
  manualDone: boolean
  /** Por qué falta, si hay algo concreto («Faltan 2 cierres»). */
  pending: string | null
}

export type OnboardingState = {
  items: OnboardingItemState[]
  /** Listos / total (sin los informativos ni los opcionales). */
  done: number
  total: number
  /** «Lo próximo que te conviene hacer»: el primer pendiente (los opcionales al final). */
  next: OnboardingItemId | null
  sections: Record<OnboardingSection, { done: number; total: number }>
}

/** Un lote de hace 8 días o menos (lo semanal). */
function recent(lastAt: string | null | undefined, today: string): boolean {
  if (!lastAt) return false
  const day = isoDayInCordoba(lastAt) ?? lastAt.slice(0, 10)
  return isRealIsoDay(day) && daysBetween(day, today) <= 8
}

const SAS_FIELD_LABEL: Readonly<Record<SasRequiredField, string>> = {
  cuit: 'la CUIT',
  iibb_number: 'el número de Ingresos Brutos',
  activity_start_date: 'el inicio de actividades',
  fiscal_address: 'el domicilio fiscal',
}

function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/** Si el ítem está listo según la base y, si no, por qué. */
function evaluate(
  id: OnboardingItemId,
  d: OnboardingData,
): { done: boolean; pending: string | null } {
  switch (id) {
    case 'sas_data':
      return d.sasMissing.length === 0
        ? { done: true, pending: null }
        : {
            done: false,
            pending: `Falta ${listText(d.sasMissing.map((f) => SAS_FIELD_LABEL[f]))}.`,
          }
    case 'treasuries':
      if (d.bankWithCbu && d.walletWithCvu) return { done: true, pending: null }
      return {
        done: false,
        pending: !d.bankWithCbu ? 'Falta el CBU del banco.' : 'Falta el CVU de Mercado Pago.',
      }
    case 'sales_methods':
      return {
        done: d.salesMethods > 0,
        pending: d.salesMethods > 0 ? null : 'No hay medios activos.',
      }
    case 'sales_points':
      return { done: d.salesPoints > 0, pending: d.salesPoints > 0 ? null : 'Cargá al menos uno.' }
    case 'opening':
      return { done: d.openingDone, pending: d.openingDone ? null : 'Faltan los saldos iniciales.' }
    case 'access': {
      const done = d.partnerGranted && d.accountantAdded
      return {
        done,
        pending: done
          ? null
          : !d.partnerGranted && !d.accountantAdded
            ? 'Faltan tu socio y la contadora.'
            : !d.partnerGranted
              ? 'Falta darle acceso a tu socio.'
              : 'Falta sumar a la contadora.',
      }
    }
    case 'arca': {
      const status = d.arca?.status ?? null
      if (status === 'connected') return { done: true, pending: null }
      return {
        done: false,
        pending:
          status === 'error'
            ? 'La última prueba dio error.'
            : status && status !== 'draft' && status !== 'disconnected'
              ? 'La conexión está a medio hacer.'
              : null,
      }
    }
    case 'arca_first_import':
      return { done: (d.imports.arca_recibidos?.postedBatches ?? 0) > 0, pending: null }
    case 'recurring':
      return {
        done: d.recurringActive >= 3,
        pending:
          d.recurringActive >= 3
            ? null
            : d.recurringActive === 0
              ? 'Todavía no hay gastos fijos.'
              : `Hay ${d.recurringActive} cargado${d.recurringActive === 1 ? '' : 's'}.`,
      }
    case 'mp_connect':
      return {
        done: d.mp?.status === 'connected' || (d.imports.mp_release?.postedBatches ?? 0) > 0,
        pending: d.mp?.status === 'reconnect' ? 'Hay que volver a conectar Mercado Pago.' : null,
      }
    case 'suppliers_message':
      return { done: false, pending: null }
    case 'daily_close':
      return {
        done: d.dailyCloseMissing === 0,
        pending:
          d.dailyCloseMissing === 0
            ? null
            : d.dailyCloseMissing === 1
              ? 'Falta 1 cierre de la última semana.'
              : `Faltan ${d.dailyCloseMissing} cierres de la última semana.`,
      }
    case 'small_expenses':
      return { done: false, pending: null }
    case 'mp_weekly':
      return {
        done: recent(d.imports.mp_release?.lastBatchAt, d.today),
        pending:
          (d.imports.mp_release?.pendingReview ?? 0) > 0 ? 'Hay un reporte para revisar.' : null,
      }
    case 'bank_weekly':
      return {
        done: recent(d.imports.bank_statement?.lastBatchAt, d.today),
        pending:
          (d.imports.bank_statement?.pendingReview ?? 0) > 0
            ? 'Hay un extracto para revisar.'
            : null,
      }
    case 'arca_monthly':
      return { done: d.mcPrevMonthCovered, pending: null }
    case 'mp_invoice':
      return { done: d.mpInvoiceThisMonth, pending: null }
    case 'treasury_check':
      return {
        done: d.treasuriesUnchecked === 0,
        pending:
          d.treasuriesUnchecked === 0
            ? null
            : d.treasuriesUnchecked === 1
              ? 'Falta ajustar 1 caja este mes.'
              : `Faltan ajustar ${d.treasuriesUnchecked} cajas este mes.`,
      }
    case 'month_close':
      return {
        done: d.prevMonthClosed,
        pending: d.prevMonthClosed ? null : 'El mes pasado sigue abierto.',
      }
  }
}

/** El estado de cada ítem, el progreso y «lo próximo» (`manual` = pasos marcados a mano). */
export function onboardingState(
  data: OnboardingData,
  manual: readonly string[] = data.manual,
): OnboardingState {
  const marked = new Set(manual)
  const sections = Object.fromEntries(
    ONBOARDING_SECTIONS.map((s) => [s, { done: 0, total: 0 }]),
  ) as Record<OnboardingSection, { done: number; total: number }>
  const items: OnboardingItemState[] = ONBOARDING_ITEMS.map((item) => {
    if (item.kind === 'info') return { ...item, status: 'info', manualDone: false, pending: null }
    const checked = evaluate(item.id, data)
    const canMark = item.kind === 'manual' || item.manualOverride === true
    const manualDone = canMark && marked.has(item.id) && !checked.done
    const done = checked.done || manualDone
    return {
      ...item,
      status: done ? 'done' : 'todo',
      manualDone,
      pending: done ? null : checked.pending,
    }
  })
  let done = 0
  let total = 0
  for (const i of items) {
    if (i.status === 'info' || i.optional) continue
    total++
    sections[i.section].total++
    if (i.status === 'done') {
      done++
      sections[i.section].done++
    }
  }
  const next =
    items.find((i) => i.status === 'todo' && !i.optional)?.id ??
    items.find((i) => i.status === 'todo')?.id ??
    null
  return { items, done, total, next, sections }
}

/**
 * El mensaje para los proveedores («Pedíselo a tus proveedores»), listo para
 * copiar. Sin CUIT cargada, sin el renglón de la CUIT.
 */
export function supplierRequestMessage(o: { legalName: string; cuit: string | null }): string {
  const name = o.legalName.trim().toUpperCase()
  const cuit = o.cuit ? `, CUIT ${formatCuit(o.cuit)}` : ''
  return `Hola, desde ahora facturanos a ${name}${cuit}, Responsable inscripto, con Factura A. ¡Gracias!`
}
