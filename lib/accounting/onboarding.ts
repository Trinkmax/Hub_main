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

import type { SasIvaCondition } from '@/lib/accounting/types'
import { addDays, daysBetween, isRealIsoDay, startOfMonth } from '@/lib/dates/civil'
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
  /**
   * Día de arranque de los libros (`acc_settings.books_start_date`). No viene en
   * el reporte: lo suma `getOnboarding`. Con los libros arrancados este mes
   * todavía no hay un mes para cerrar.
   */
  booksStartDate: string | null
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

function isoDayOrNull(v: unknown): string | null {
  const day = text(v)?.slice(0, 10) ?? null
  return day && isRealIsoDay(day) ? day : null
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
    booksStartDate: isoDayOrNull(r.books_start_date),
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

/** La bajada de cada sección, en una línea. */
export const ONBOARDING_SECTION_HINT: Readonly<Record<OnboardingSection, string>> = {
  day1: 'Se hace una sola vez. Seguí el orden: cada paso usa lo que cargaste antes.',
  daily: 'Lo de cada día. El resto lo arma la plataforma.',
  weekly: 'Bajás dos archivos y la plataforma arma todo: vos revisás y confirmás.',
  monthly: 'Las compras de ARCA, los saldos y el cierre del mes con la contadora.',
}

export const ONBOARDING_ITEM_IDS = [
  'sas_data',
  'treasuries',
  'sales_methods',
  'platforms',
  'sales_points',
  'opening',
  'access',
  'chart_review',
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

/** La hoja de acción rápida que abre el botón, sobre la misma guía. */
export type OnboardingSheet = 'gasto' | 'cobrar' | 'ajustar'

/** La mini guía «¿Cómo lo bajo?» del archivo que se sube (diseño §5.1.4). */
export type OnboardingHowTo = 'mis_comprobantes' | 'mercado_pago' | 'banco'

export type OnboardingItem = {
  id: OnboardingItemId
  section: OnboardingSection
  title: string
  /**
   * El «Dónde»: texto y ruta relativa a `/<bar>/administracion` (`null` si es
   * afuera de la plataforma o si está en todas las pantallas).
   */
  where: { label: string; path: string | null }
  /** «Qué cargás» (una línea). */
  what: string
  /** El rótulo de `what` si no es «Qué cargás» («Qué pedís», «Qué revisás»…). */
  whatLabel?: string
  /** «Cómo» (de 2 a 4 pasos cortos, en orden). */
  how: readonly string[]
  /** Un ejemplo concreto («Ejemplo: …»), si ayuda. */
  example: string | null
  /** «La plataforma lo hace sola» (si aplica). */
  auto: string | null
  /** Tiempo estimado en minutos (`null` si no aplica). */
  minutes: number | null
  /** El botón de acción: va a `where.path` o abre `sheet`. */
  actionLabel: string | null
  /** El botón abre esta hoja de acción rápida en vez de ir a otra pantalla. */
  sheet?: OnboardingSheet
  /** La mini guía para bajar el archivo que se sube. */
  howTo?: OnboardingHowTo
  /** El texto de la marca a mano («Ya lo hice») de los ítems que la aceptan. */
  manualLabel?: string
  kind: OnboardingKind
  /** No cuenta para «X de Y listos». */
  optional?: true
  /** Un ítem automático que también se puede dar por hecho a mano. */
  manualOverride?: true
}

/*
 * Los textos explican cada palabra de ARCA o de contabilidad la primera vez
 * que aparece (y están en `ONBOARDING_GLOSSARY`). Nada propio de un bar: ni su
 * nombre, ni su CUIT, ni el sistema de caja o el banco que usa (la guía es la
 * misma para todos los bares; los datos del bar los pone la pantalla).
 */
export const ONBOARDING_ITEMS: readonly OnboardingItem[] = [
  {
    id: 'sas_data',
    section: 'day1',
    title: 'Datos de la SAS',
    where: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
    what: 'Cómo figura la SAS en ARCA (la ex AFIP): razón social, CUIT, Ingresos Brutos, inicio de actividades y domicilio fiscal.',
    how: [
      'Bajá la constancia de inscripción: en arca.gob.ar tocá «Constancia de CUIT» y escribí la CUIT de la SAS.',
      'Copiá la razón social, la CUIT, el domicilio fiscal y el inicio de actividades tal cual figuran ahí.',
      'Ingresos Brutos es el impuesto de la provincia: el número está en la constancia de Rentas.',
      'Elegí «Local» si vendés en una sola provincia, o «Convenio Multilateral» si vendés en varias.',
    ],
    example: null,
    auto: 'Con estos datos arma los libros de IVA y el mensaje para tus proveedores.',
    minutes: 5,
    actionLabel: 'Completar los datos',
    kind: 'auto',
  },
  {
    id: 'treasuries',
    section: 'day1',
    title: 'Cajas y cuentas',
    where: { label: 'Ajustes › Cajas y cuentas', path: '/ajustes?tab=cajas' },
    what: 'Dónde está la plata de la SAS: la caja de efectivo, cada banco y Mercado Pago.',
    how: [
      'Tocá «Agregar caja o cuenta» y elegí el tipo: efectivo, banco, billetera o tarjeta de crédito.',
      'En el banco cargá el CBU (los 22 números de la cuenta), el alias y el número de cuenta.',
      'En Mercado Pago cargá el CVU (es como el CBU, pero de una billetera) y el alias.',
      'Si la empresa tiene tarjeta de crédito, sumala también.',
    ],
    example:
      'Ejemplo: «Caja del local» (efectivo), el banco con su CBU y alias, y Mercado Pago con su CVU.',
    auto: 'Con el CBU y el CVU reconoce sola las transferencias entre tus cuentas.',
    minutes: 5,
    actionLabel: 'Ir a Cajas y cuentas',
    manualLabel: 'Ya cargué las que tengo',
    kind: 'auto',
    manualOverride: true,
  },
  {
    id: 'sales_methods',
    section: 'day1',
    title: 'Medios de cobro',
    where: { label: 'Ajustes › Medios de cobro', path: '/ajustes?tab=medios' },
    what: 'Cómo te pagan los clientes y a qué caja va cada cobro.',
    how: [
      'Revisá la lista: efectivo, QR, transferencia, débito, crédito y las apps de delivery.',
      'Ordenalos igual que el cierre de caja del sistema que usás hoy: así pegás la columna entera de una vez.',
      'En cada uno elegí a qué caja entra la plata.',
      'Si te paga otro (tarjetas, apps), poné en cuántos días se acredita: o sea, cuándo llega la plata a tu cuenta.',
    ],
    example: 'Ejemplo: «Débito» entra al banco y se acredita a los 2 días.',
    auto: 'Reparte cada cierre del día entre tus cajas y anota lo que te tienen que acreditar.',
    minutes: 5,
    actionLabel: 'Revisar los medios',
    kind: 'auto',
  },
  {
    id: 'platforms',
    section: 'day1',
    title: 'Apps de delivery, tarjetas y Mercado Pago',
    where: { label: 'Ajustes › Plataformas', path: '/ajustes?tab=participes' },
    what: 'Con cuáles trabajás y cuánto te descuenta cada una antes de pagarte.',
    how: [
      'Prendé «Trabajamos con esta plataforma» en las que usás y apagá las que no.',
      'Cargá la comisión y las retenciones que figuran en su liquidación (el resumen que te mandan con cada pago). Una retención es un impuesto que te descuentan antes de pagarte.',
      'Si no las sabés, dejalas vacías: se pueden corregir en cada cobro.',
    ],
    example:
      'Ejemplo: una app de delivery con comisión del 25 % y retención de Ingresos Brutos del 3 %.',
    auto: 'Con esas tasas precarga cada acreditación: vos solo la confirmás.',
    minutes: 10,
    actionLabel: 'Ir a Plataformas',
    manualLabel: 'Ya las revisé',
    kind: 'manual',
  },
  {
    id: 'sales_points',
    section: 'day1',
    title: 'Puntos de venta',
    where: { label: 'Ajustes › Puntos de venta', path: '/ajustes?tab=puntos-de-venta' },
    what: 'Los puntos de venta con los que facturás hoy y a qué canal va cada uno.',
    how: [
      'El punto de venta es el número que va antes del guion en cada factura.',
      'Mirá una factura del sistema que usás hoy y cargá cada número con su canal: salón, delivery o eventos.',
      'El de la plataforma lo crea solo «Conectar ARCA»: no lo cargues a mano.',
    ],
    // \u2060 (unión de palabras): que «0003-00014501» no se corte en el guion.
    example: 'Ejemplo: en la factura 0003-\u206000014501 el punto de venta es el 3.',
    auto: null,
    minutes: 3,
    actionLabel: 'Ir a Puntos de venta',
    kind: 'auto',
  },
  {
    id: 'opening',
    section: 'day1',
    title: 'Saldos iniciales',
    where: { label: 'Configurar › Saldos iniciales', path: '/configurar' },
    what: 'Cuánta plata había y cuánto se debía el día que arrancan los libros.',
    how: [
      'Plata en cada caja: el efectivo contado, el banco según el resumen y Mercado Pago según la app.',
      'Deudas con proveedores: cada factura sin pagar, con su importe y su vencimiento.',
      'Lo que te debían: tarjetas y apps por acreditar, y clientes con cuenta.',
      'Si arrancás de cero, tocá «Arrancar en cero».',
    ],
    example:
      'Ejemplo: banco $ 1.250.000, caja $ 80.000 y una factura de bebidas sin pagar de $ 320.000 que vence el 15.',
    auto: 'Con eso, cada caja y cada proveedor arranca con su saldo real.',
    minutes: 20,
    actionLabel: 'Cargar saldos iniciales',
    kind: 'auto',
  },
  {
    id: 'access',
    section: 'day1',
    title: 'Accesos',
    where: { label: 'Ajustes › Accesos', path: '/ajustes?tab=accesos' },
    what: 'Quién más entra a Administración: tus socios y la contadora.',
    how: [
      'Administración es privada: solo la ven los dueños que habilites.',
      'Dales acceso a los socios que van a cargar gastos y cierres.',
      'Sumá a la contadora: ve y baja los libros, pero no carga ni cambia nada.',
    ],
    example: null,
    auto: null,
    minutes: 3,
    actionLabel: 'Ir a Accesos',
    manualLabel: 'Ya están todos',
    kind: 'auto',
    manualOverride: true,
  },
  {
    id: 'chart_review',
    section: 'day1',
    title: 'Plan de cuentas con la contadora',
    where: { label: 'Plan de cuentas', path: '/plan-de-cuentas' },
    what: 'La lista de cuentas donde se ordena cada gasto y cada venta. Ya viene una armada para bares.',
    whatLabel: 'Qué revisás',
    how: [
      'Pedile a la contadora que la mire: la ve y la baja desde su acceso.',
      'Si te pide otra cuenta, creala con «Nueva cuenta».',
      'Si ella ya tiene un plan propio, se trae con «Importar plan».',
    ],
    example: 'Ejemplo: si quiere separar las propinas, creás la cuenta «Propinas a repartir».',
    auto: 'Propone la cuenta de cada gasto y de cada proveedor.',
    minutes: 15,
    actionLabel: 'Ver el plan de cuentas',
    manualLabel: 'Ya lo revisamos',
    kind: 'manual',
  },
  {
    id: 'arca',
    section: 'day1',
    title: 'Conectar ARCA',
    where: { label: 'Ajustes › ARCA', path: '/ajustes/arca' },
    what: 'La conexión con ARCA, para que la plataforma consulte y facture sola.',
    whatLabel: 'Qué hacés',
    how: [
      'Lo hace quien maneja la clave fiscal de la SAS, con la guía paso a paso.',
      'Lleva unos 40 minutos y se hace una sola vez.',
      'Cada paso se marca solo apenas la plataforma lo ve hecho.',
    ],
    example: null,
    auto: 'Completa proveedores y clientes con solo la CUIT y te deja facturar eventos desde acá.',
    minutes: 40,
    actionLabel: 'Empezar a conectar',
    kind: 'auto',
  },
  {
    id: 'arca_first_import',
    section: 'day1',
    title: 'Proveedores y compras del mes pasado',
    where: { label: 'Importar › ARCA', path: '/importar/arca' },
    what: 'Las facturas que te hicieron el mes pasado, desde «Mis Comprobantes»: la parte de ARCA donde aparece toda factura hecha a la CUIT de la SAS.',
    how: [
      'En ARCA entrá a «Mis Comprobantes» › «Recibidos» y bajá el mes pasado en «CSV»: baja un archivo ZIP.',
      'Arrastralo tal cual a Importar › ARCA, sin abrirlo con Excel.',
      'Por cada proveedor nuevo elegí en qué gastás con él: bebidas, verdulería, alquiler…',
      'Revisá y confirmá: entran todas juntas.',
    ],
    example: 'Ejemplo: si arrancás en octubre, bajás septiembre completo.',
    auto: 'Crea los proveedores, arma cada compra con su IVA y saltea las que ya cargaste.',
    minutes: 15,
    actionLabel: 'Importar de ARCA',
    howTo: 'mis_comprobantes',
    kind: 'auto',
  },
  {
    id: 'recurring',
    section: 'day1',
    title: 'Gastos fijos',
    where: { label: 'Compras › Gastos fijos', path: '/compras?tab=gastos-fijos' },
    what: 'Lo que pagás todos los meses, con su día de vencimiento.',
    how: [
      'Tocá «Nuevo gasto fijo» y cargá a quién le pagás, cuánto más o menos y qué día vence.',
      'Sumá el alquiler, la luz, el gas, el agua, internet, los sistemas que pagás por mes, el contador y los seguros.',
      'No es una deuda hasta que cargás la factura: es un recordatorio.',
    ],
    example: 'Ejemplo: Alquiler · vence el 10 · alrededor de $ 850.000.',
    auto: 'Te avisa antes de cada vencimiento y la factura se carga en un toque.',
    minutes: 10,
    actionLabel: 'Cargar gastos fijos',
    manualLabel: 'Ya cargué los que tengo',
    kind: 'auto',
    manualOverride: true,
  },
  {
    id: 'mp_connect',
    section: 'day1',
    title: 'Conectar Mercado Pago',
    where: { label: 'Importar › Mercado Pago', path: '/importar/mercado-pago' },
    what: 'A qué medio de cobro va cada canal de Mercado Pago (QR, posnet, link de pago) y el primer reporte.',
    how: [
      'En Importar › Mercado Pago elegí a qué medio de cobro va cada canal.',
      'Desde la compu, bajá el reporte de «Liquidaciones»: el detalle de cada cobro, su comisión y lo que te acreditaron.',
      'Subilo y confirmá los días.',
    ],
    example: 'Ejemplo: los cobros con QR van a «QR» y los del posnet de Mercado Pago a «Débito».',
    auto: 'Separa la comisión, el IVA y los impuestos de cada cobro.',
    minutes: 10,
    actionLabel: 'Configurar Mercado Pago',
    howTo: 'mercado_pago',
    kind: 'auto',
    optional: true,
  },
  {
    id: 'suppliers_message',
    section: 'day1',
    title: 'Pedíselo a tus proveedores',
    where: { label: 'Por WhatsApp o mail, afuera de la plataforma', path: null },
    what: 'Que desde ahora te facturen a nombre de la SAS, con su CUIT.',
    whatLabel: 'Qué pedís',
    how: [
      'Copiá el mensaje y mandáselo a cada proveedor por WhatsApp o mail.',
      'Si te facturan a otro nombre o como consumidor final, esa compra no aparece en ARCA a nombre de la SAS y no la podés importar.',
    ],
    example: null,
    auto: null,
    minutes: 5,
    actionLabel: 'Copiar el mensaje',
    manualLabel: 'Ya se lo pedí',
    kind: 'manual',
  },
  {
    id: 'daily_close',
    section: 'daily',
    title: 'Cierre del día',
    where: { label: 'Ventas › Cargar cierre', path: '/ventas/cierre' },
    what: 'Lo que vendiste el día anterior y cómo te pagaron.',
    how: [
      'Abrí el cierre de caja del sistema que usás hoy.',
      'Copiá la columna de importes y pegala en el primer medio: se reparte sola hacia abajo.',
      'En «Lo facturado» escribí el último número de cada punto de venta y el total.',
      'Si contaste otro efectivo, anotalo: la diferencia queda como faltante o sobrante.',
    ],
    example: null,
    auto: 'Reparte la venta entre tus cajas y anota lo que te tienen que acreditar.',
    minutes: 5,
    actionLabel: 'Cargar el cierre',
    kind: 'auto',
  },
  {
    id: 'small_expenses',
    section: 'daily',
    title: 'Gastos chicos',
    where: {
      label: '«Nuevo gasto»: en la barra de abajo del celular o con ⌘K en la compu',
      path: null,
    },
    what: 'Lo que pagás en el momento y no tiene factura a nombre de la SAS.',
    whatLabel: 'Qué es',
    how: ['Tocá «Nuevo gasto».', 'Elegí en qué se gastó, el importe y con qué caja lo pagaste.'],
    example: 'Ejemplo: hielo por $ 6.000, pagado con la plata de la caja.',
    auto: null,
    minutes: 1,
    actionLabel: 'Nuevo gasto',
    sheet: 'gasto',
    kind: 'info',
  },
  {
    id: 'mp_weekly',
    section: 'weekly',
    title: 'Mercado Pago',
    where: { label: 'Importar › Mercado Pago', path: '/importar/mercado-pago' },
    what: 'El reporte de «Liquidaciones» desde la última vez que lo subiste.',
    how: [
      'Desde la compu, bajá «Liquidaciones» en CSV (hasta 60 días por reporte).',
      'Subilo en Importar › Mercado Pago.',
      'Revisá los días nuevos y confirmalos.',
    ],
    example: 'Ejemplo: cada lunes bajás desde el lunes anterior hasta ayer.',
    auto: 'Arma los cobros por día y por medio, los impuestos y los retiros.',
    minutes: 10,
    actionLabel: 'Importar Mercado Pago',
    howTo: 'mercado_pago',
    kind: 'auto',
  },
  {
    id: 'bank_weekly',
    section: 'weekly',
    title: 'Banco',
    where: { label: 'Importar › Banco', path: '/importar/banco' },
    what: 'Los movimientos del banco desde la última vez que los subiste.',
    how: [
      'En el home banking de la empresa, exportá los movimientos en CSV, TXT o Excel.',
      'Subilos en Importar › Banco. La primera vez decinos qué es cada columna.',
      'Revisá y confirmá. Muchos bancos guardan solo los últimos 3 meses: no lo dejes pasar.',
    ],
    example: 'Ejemplo: cada lunes exportás la semana anterior.',
    auto: 'Arma los gastos bancarios de cada día y reconoce tus transferencias.',
    minutes: 10,
    actionLabel: 'Importar del banco',
    howTo: 'banco',
    kind: 'auto',
  },
  {
    id: 'arca_monthly',
    section: 'monthly',
    title: 'Compras de ARCA (del 11 en adelante)',
    where: { label: 'Importar › ARCA', path: '/importar/arca' },
    what: 'Las facturas que te hicieron, bajadas de «Mis Comprobantes».',
    how: [
      'Esperá al día 11: muchas facturas llegan tarde a ARCA.',
      'Bajá «Recibidos» desde el 1 del mes anterior hasta hoy, en CSV.',
      'Subilo tal cual: las que ya estaban cargadas se saltean solas.',
    ],
    example: 'Ejemplo: el 11 de noviembre bajás desde el 1 de octubre hasta ese día.',
    auto: 'Saltea las que ya cargaste y crea los proveedores nuevos.',
    minutes: 15,
    actionLabel: 'Importar de ARCA',
    howTo: 'mis_comprobantes',
    kind: 'auto',
  },
  {
    id: 'mp_invoice',
    section: 'monthly',
    title: 'Factura de Mercado Pago',
    where: { label: 'Importar › ARCA', path: '/importar/arca' },
    what: 'La factura de las comisiones que te cobró Mercado Pago en el mes.',
    how: [
      'Llega con las compras de ARCA: no la cargues a mano.',
      'Cuando la importes, a «¿Es la factura mensual de comisiones de Mercado Pago?» contestá que sí.',
    ],
    example: null,
    auto: 'Pasa a crédito fiscal el IVA de las comisiones que ya te descontaron: es el IVA de tus compras que se resta del que pagás.',
    minutes: 3,
    actionLabel: 'Importar de ARCA',
    kind: 'auto',
  },
  {
    id: 'treasury_check',
    section: 'monthly',
    title: 'Ajustar saldos',
    where: { label: 'Cajas › Ajustar saldo', path: '/cajas' },
    what: 'Que lo que dice la plataforma coincida con lo que hay de verdad.',
    whatLabel: 'Qué controlás',
    how: [
      'Contá el efectivo de la caja y mirá el saldo del banco y el de Mercado Pago.',
      'En «Ajustar saldo» escribí lo que hay de verdad en cada una.',
      'La diferencia queda anotada sola.',
    ],
    example:
      'Ejemplo: la plataforma dice $ 82.000 en la caja y contaste $ 80.000: escribís $ 80.000.',
    auto: null,
    minutes: 10,
    actionLabel: 'Ajustar saldo',
    sheet: 'ajustar',
    kind: 'auto',
  },
  {
    id: 'month_close',
    section: 'monthly',
    title: 'Cerrar el mes con la contadora',
    where: { label: 'Libros › Cierres', path: '/libros/cierres' },
    what: 'Revisar el mes que pasó y cerrarlo para que no cambie más.',
    whatLabel: 'Qué hacés',
    how: [
      'En Libros › Cierres mirá la lista de lo que falta revisar.',
      'Cuando esté todo, cerrá el mes. Si hace falta, se puede reabrir.',
      'La contadora baja el «Paquete del mes» desde Libros.',
    ],
    example: null,
    auto: 'Arma sola los libros del mes: diario, IVA compras e IVA ventas.',
    minutes: 15,
    actionLabel: 'Ir a Cierres',
    kind: 'auto',
  },
]

/** Los pasos que se pueden marcar a mano (`acc_guide_progress`, guía `arranque`). */
export const ONBOARDING_MANUAL_STEPS: readonly OnboardingItemId[] = ONBOARDING_ITEMS.filter(
  (i) => i.kind === 'manual' || i.manualOverride,
).map((i) => i.id)

/** «Tené a mano» (casillas de ayuda, no se guardan). */
export const ONBOARDING_HAVE_AT_HAND: readonly string[] = [
  'La constancia de inscripción de la SAS (de ARCA) y la de Ingresos Brutos (de Rentas).',
  'El último resumen del banco: el saldo del día que arrancan los libros.',
  'El saldo de Mercado Pago de ese mismo día.',
  'El efectivo contado de la caja.',
  'Las facturas sin pagar a proveedores: proveedor, número, importe y vencimiento.',
  'Lo que te deben: tarjetas y apps por acreditar, y clientes con cuenta.',
  'La comisión que te cobra cada app y cada tarjeta (está en sus liquidaciones).',
  'Los gastos fijos con su día de vencimiento.',
  'Una factura del sistema de caja que usás hoy, para ver tus puntos de venta.',
]

/** «Lo que hace la plataforma sola» (pie de la guía). */
export const PLATFORM_DOES: readonly string[] = [
  'Completa proveedores y clientes con solo la CUIT (con ARCA conectado).',
  'Detecta comprobantes repetidos y saltea lo que ya cargaste.',
  'Separa la comisión, el IVA y los impuestos de cada cobro de Mercado Pago.',
  'Arma los gastos bancarios de cada día y reconoce tus transferencias.',
  'Propone en qué se gasta con cada proveedor.',
  'Numera y autoriza con ARCA las facturas que hacés desde acá.',
  'Arma sola los libros del mes: diario, IVA compras e IVA ventas.',
  'Te avisa los vencimientos: gastos fijos y el certificado de ARCA.',
]

/** Lo que se sigue cargando a mano y por qué (diseño §4.5). */
export type OnboardingManualTask = {
  title: string
  where: { label: string; path: string | null }
  sheet?: OnboardingSheet
  /** Por qué no se automatiza todavía. */
  why: string
}

export const ONBOARDING_STAYS_MANUAL: readonly OnboardingManualTask[] = [
  {
    title: 'Lo vendido cada día y cómo te pagaron',
    where: { label: 'Ventas › Cargar cierre', path: '/ventas/cierre' },
    why: 'Hasta que tu sistema de caja esté conectado a la plataforma, lo pegás desde su cierre de caja.',
  },
  {
    title: 'Gastos chicos sin factura',
    where: { label: '«Nuevo gasto»', path: null },
    sheet: 'gasto',
    why: 'El hielo o la verdulería no tienen factura a nombre de la SAS, así que no están en ARCA.',
  },
  {
    title: 'Lo que te depositan las tarjetas',
    where: { label: '«Registrar un cobro»', path: null },
    sheet: 'cobrar',
    why: 'Todavía no leemos las liquidaciones de las tarjetas. Con las tasas de Plataformas, el cobro viene casi armado.',
  },
  {
    title: 'Sueldos y cargas sociales',
    where: { label: 'Libros › Asiento manual', path: '/libros/asiento-manual' },
    why: 'Te los pasa la contadora una vez por mes.',
  },
  {
    title: 'Facturas del exterior, en papel o de contingencia',
    where: { label: 'Compras › Nueva compra', path: '/compras/nueva' },
    why: 'No aparecen en Mis Comprobantes de ARCA.',
  },
  {
    title: 'Los saldos iniciales',
    where: { label: 'Configurar › Saldos iniciales', path: '/configurar' },
    why: 'Es una sola vez, el día que arrancan los libros.',
  },
]

/** «Palabras que vas a ver», en palabras simples. */
export const ONBOARDING_GLOSSARY: ReadonlyArray<{ term: string; meaning: string }> = [
  {
    term: 'ARCA',
    meaning: 'La ex AFIP: donde está inscripta la SAS y donde queda registrada cada factura.',
  },
  { term: 'CUIT', meaning: 'El número de la SAS en ARCA. Tiene 11 números.' },
  {
    term: 'Constancia de inscripción',
    meaning: 'La hoja de ARCA que dice cómo está inscripta la SAS. Se baja con la CUIT.',
  },
  {
    term: 'Ingresos Brutos',
    meaning: 'El impuesto de la provincia. El número está en la constancia de Rentas.',
  },
  {
    term: 'Factura A y Factura B',
    meaning:
      'La A muestra el IVA aparte y la SAS lo puede descontar. La B es la de consumidor final.',
  },
  {
    term: 'Crédito fiscal',
    meaning: 'El IVA de tus compras con Factura A: se resta del IVA que pagás cada mes.',
  },
  {
    term: 'Punto de venta',
    meaning: 'El número que va antes del guion en cada factura: en 0003-\u206000014501 es el 3.',
  },
  {
    term: 'Mis Comprobantes',
    meaning: 'La parte de ARCA donde aparecen todas las facturas hechas a la CUIT de la SAS.',
  },
  {
    term: 'CBU y CVU',
    meaning:
      'Los 22 números de una cuenta: CBU si es de un banco, CVU si es de una billetera como Mercado Pago.',
  },
  {
    term: 'Acreditación',
    meaning:
      'Cuando la plata de una venta con tarjeta, QR o app llega a tu cuenta, ya con los descuentos.',
  },
  {
    term: 'Retención',
    meaning:
      'Un impuesto que te descuentan antes de pagarte. Después se resta del que tenés que pagar.',
  },
  {
    term: 'Saldos iniciales',
    meaning: 'Cuánta plata había y cuánto se debía el día que arrancan los libros.',
  },
  {
    term: 'Plan de cuentas',
    meaning: 'La lista de cuentas donde se ordena cada gasto y cada venta.',
  },
  {
    term: 'Asiento',
    meaning: 'El registro de cada movimiento en los libros. La plataforma los arma sola.',
  },
  {
    term: 'Cerrar el mes',
    meaning:
      'Revisarlo con la contadora y dejarlo fijo: después ya no cambia, salvo que lo reabras.',
  },
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
              : // Solo «Hay 2 cargados.» con el ícono de aviso no decía qué faltaba.
                `Hay ${d.recurringActive} cargado${d.recurringActive === 1 ? '' : 's'}: sumá los que falten.`,
      }
    case 'mp_connect':
      return {
        done: d.mp?.status === 'connected' || (d.imports.mp_release?.postedBatches ?? 0) > 0,
        pending: d.mp?.status === 'reconnect' ? 'Hay que volver a conectar Mercado Pago.' : null,
      }
    // Solo pasan afuera de la plataforma: los da por hechos la marca «Ya lo hice».
    case 'platforms':
    case 'chart_review':
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
      // Los libros arrancaron este mes: todavía no hay un mes para cerrar.
      if (d.booksStartDate && d.booksStartDate > addDays(startOfMonth(d.today), -1)) {
        return { done: true, pending: null }
      }
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

// ─── Para la pantalla ────────────────────────────────────────────────────────

/** `unknown`: no sabemos el estado (la guía todavía sin datos de la base). */
export type OnboardingRowStatus = OnboardingStatus | 'unknown'

export type OnboardingRow = OnboardingItem & {
  status: OnboardingRowStatus
  manualDone: boolean
  pending: string | null
}

/**
 * Las filas de la guía: con el estado de la base, o sin marcas (`unknown`)
 * mientras la base no lo puede dar. Nunca vacía.
 */
export function onboardingRows(state: OnboardingState | null): OnboardingRow[] {
  if (state) return state.items
  return ONBOARDING_ITEMS.map((item) => ({
    ...item,
    status: item.kind === 'info' ? 'info' : 'unknown',
    manualDone: false,
    pending: null,
  }))
}

/** El ítem acepta «Ya lo hice». */
export function canMarkManually(item: Pick<OnboardingItem, 'kind' | 'manualOverride'>): boolean {
  return item.kind === 'manual' || item.manualOverride === true
}

/**
 * El estado en palabras (nunca solo el color): «Listo» lo de una vez, «Al día»
 * las rutinas, «Lo próximo» el que conviene hacer ahora. `null` sin datos.
 */
export function onboardingStatusText(
  row: Pick<OnboardingRow, 'status' | 'section' | 'manualDone'>,
  isNext = false,
): string | null {
  const once = row.section === 'day1'
  switch (row.status) {
    case 'info':
      return 'Para saber'
    case 'unknown':
      return null
    case 'done':
      return row.manualDone ? 'Marcado por vos' : once ? 'Listo' : 'Al día'
    case 'todo':
      return isNext ? 'Lo próximo' : once ? 'Falta' : 'Te toca'
  }
}

/** «7 de 12 listos» (una sola vez) · «1 de 2 al día» (rutinas). Vacío si no hay qué contar. */
export function sectionProgressText(
  section: OnboardingSection,
  counts: { done: number; total: number },
): string {
  if (counts.total === 0) return ''
  return section === 'day1'
    ? `${counts.done} de ${counts.total} ${counts.total === 1 ? 'listo' : 'listos'}`
    : `${counts.done} de ${counts.total} al día`
}

/** «≈ 5 min» · «≈ 1 h» · «≈ 1 h 30 min». */
export function minutesText(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null
  const m = Math.round(minutes)
  if (m < 60) return `≈ ${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `≈ ${h} h` : `≈ ${h} h ${rest} min`
}

// ─── El mensaje para los proveedores ─────────────────────────────────────────

const IVA_CONDITION_TEXT: Readonly<
  Record<Exclude<SasIvaCondition, 'responsable_inscripto'>, string>
> = {
  monotributo: 'Monotributo',
  exento: 'IVA exento',
}

/**
 * El mensaje para los proveedores («Pedíselo a tus proveedores»), listo para
 * copiar. Sin CUIT cargada, sin el renglón de la CUIT. Una SAS responsable
 * inscripta pide Factura A (para descontar el IVA); si no, solo el nombre y la
 * condición.
 */
export function supplierRequestMessage(o: {
  legalName: string
  cuit: string | null
  ivaCondition?: SasIvaCondition | null
}): string {
  const name = o.legalName.trim().toUpperCase()
  const cuit = o.cuit ? `, CUIT ${formatCuit(o.cuit)}` : ''
  const condition = o.ivaCondition ?? 'responsable_inscripto'
  if (condition === 'responsable_inscripto') {
    return `Hola, desde ahora facturanos a ${name}${cuit}, Responsable inscripto, con Factura A. ¡Gracias!`
  }
  return `Hola, desde ahora facturanos a ${name}${cuit} (${IVA_CONDITION_TEXT[condition]}). ¡Gracias!`
}

/** Por qué conviene la Factura A (solo para una SAS responsable inscripta). */
export function supplierRequestWhy(
  ivaCondition: SasIvaCondition | null | undefined,
): string | null {
  return (ivaCondition ?? 'responsable_inscripto') === 'responsable_inscripto'
    ? 'Con Factura A recuperás el IVA de cada compra: es el crédito fiscal, que se resta del IVA que pagás.'
    : null
}
