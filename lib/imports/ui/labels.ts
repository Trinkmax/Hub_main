/**
 * Los textos de las pantallas de importación (diseño §4.0–§4.3, WP10): qué es
 * cada origen, los estados del lote y de cada propuesta, y las etiquetas de los
 * datos que se eligen en la revisión. En palabras simples, de vos y sin jerga:
 * quien lee es el dueño de un bar, no un contador.
 *
 * Puro (sin React ni `server-only`): lo usan las páginas, los componentes de
 * cliente y los tests. Nunca nombra un bar, una CUIT ni un sistema de caja
 * concreto (la plataforma es de muchos bares).
 */

import type { IvaCondition } from '@/lib/accounting/types'
import type { BankColumn } from '@/lib/imports/bank/statement'
import type { BankExpenseComponent } from '@/lib/imports/server/proposals/bank'
import type {
  BatchAcceptableWarning,
  ImportBatchStatus,
  MpCobroChannel,
  OtherTaxesAs,
  PartyRole,
  ProposalStatus,
  SummaryKind,
} from '@/lib/imports/server/types'

// ─── Orígenes ────────────────────────────────────────────────────────────────

/** Los tres importadores que tienen pantalla (Emitidos llega más adelante). */
export const UI_IMPORT_SOURCES = ['arca_recibidos', 'mp_release', 'bank_statement'] as const
export type UiImportSource = (typeof UI_IMPORT_SOURCES)[number]

export function isUiImportSource(value: unknown): value is UiImportSource {
  return typeof value === 'string' && (UI_IMPORT_SOURCES as readonly string[]).includes(value)
}

export type ImportSourceCopy = {
  /** Título de la tarjeta y de la revisión. */
  title: string
  /** Para listas angostas y el historial. */
  short: string
  /** Qué se carga con este archivo, en una línea. */
  loads: string
  /** Qué hace el importador, para la tarjeta del hub. */
  description: string
  /** Segmento de la ruta de subida (`/importar/<segment>`). */
  segment: 'arca' | 'mercado-pago' | 'banco'
  /** Botón de la tarjeta. */
  cta: string
  /** Cómo se llama lo que sale de cada fila. */
  unit: readonly [one: string, many: string]
}

export const IMPORT_SOURCE_COPY: Readonly<Record<UiImportSource, ImportSourceCopy>> = {
  arca_recibidos: {
    title: 'Compras desde ARCA',
    short: 'ARCA',
    loads: 'Las facturas que te hicieron tus proveedores',
    description:
      'Bajás de ARCA (la ex AFIP) el archivo de «Mis Comprobantes › Recibidos» y lo soltás acá: armamos las compras y te avisamos qué proveedores son nuevos.',
    segment: 'arca',
    cta: 'Importar de ARCA',
    unit: ['comprobante', 'comprobantes'],
  },
  mp_release: {
    title: 'Mercado Pago',
    short: 'Mercado Pago',
    loads: 'Cobros, comisiones, impuestos y retiros',
    description:
      'Subís el reporte de «Liquidaciones» de Mercado Pago: separamos lo que cobraste, la comisión, su IVA y los impuestos de cada día.',
    segment: 'mercado-pago',
    cta: 'Importar Mercado Pago',
    unit: ['movimiento', 'movimientos'],
  },
  bank_statement: {
    title: 'Banco',
    short: 'Banco',
    loads: 'Gastos del banco, transferencias y pagos',
    description:
      'Exportás los movimientos de tu cuenta desde el home banking y los subís: reconocemos comisiones, impuestos y transferencias.',
    segment: 'banco',
    cta: 'Importar banco',
    unit: ['movimiento', 'movimientos'],
  },
}

/** `/{slug}/administracion/importar` y sus sub-rutas (C4). */
export function importHref(slug: string, rest?: string | null): string {
  const base = `/${slug}/administracion/importar`
  return rest ? `${base}/${rest}` : base
}

export function importSourceHref(slug: string, source: UiImportSource): string {
  return importHref(slug, IMPORT_SOURCE_COPY[source].segment)
}

export function importBatchHref(
  slug: string,
  batchId: string,
  query?: Readonly<Record<string, string | number | null | undefined>>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== null && v !== undefined && v !== '') params.set(k, String(v))
  }
  const q = params.toString()
  return `${importHref(slug, batchId)}${q ? `?${q}` : ''}`
}

// ─── Tonos (el estado nunca va solo por color: siempre lleva texto) ──────────

export type UiTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

/** Los badges suaves del panel (admin-ui §1 «Badges»). */
export const TONE_BADGE_CLASS: Readonly<Record<UiTone, string>> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning-text',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info/10 text-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
}

// ─── Estados ─────────────────────────────────────────────────────────────────

export const BATCH_STATUS_COPY: Readonly<
  Record<ImportBatchStatus, { label: string; tone: UiTone; hint: string }>
> = {
  staging: {
    label: 'Sin terminar',
    tone: 'warning',
    hint: 'El archivo no se terminó de subir. Volvé a subirlo y seguimos donde quedó.',
  },
  review: {
    label: 'Para revisar',
    tone: 'info',
    hint: 'Ya está armado: revisalo y cargalo.',
  },
  posting: {
    label: 'Cargando',
    tone: 'info',
    hint: 'Se está cargando (o se cortó a la mitad): entrá y tocá «Cargar» para seguir.',
  },
  done: { label: 'Terminada', tone: 'success', hint: 'Se cargó todo lo que había para cargar.' },
  cancelled: {
    label: 'Cancelada',
    tone: 'muted',
    hint: 'Se canceló: lo que no se cargó quedó afuera.',
  },
}

export const PROPOSAL_STATUS_COPY: Readonly<
  Record<ProposalStatus, { label: string; tone: UiTone }>
> = {
  needs_input: { label: 'Falta un dato', tone: 'warning' },
  ready: { label: 'Lista para cargar', tone: 'info' },
  posting: { label: 'Cargando', tone: 'info' },
  posted: { label: 'Cargada', tone: 'success' },
  stale: { label: 'Cambió: mirala de nuevo', tone: 'warning' },
  error: { label: 'No se pudo cargar', tone: 'danger' },
  skipped: { label: 'No se carga', tone: 'muted' },
  voided: { label: 'Anulada', tone: 'muted' },
}

// ─── Lo que se elige en la revisión ──────────────────────────────────────────

export const IVA_CONDITION_TEXT: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos',
}

/** Las condiciones que tiene sentido elegirle a un proveedor. */
export const SUPPLIER_IVA_CONDITIONS: readonly IvaCondition[] = [
  'responsable_inscripto',
  'monotributo',
  'exento',
  'no_alcanzado',
]

export const OTHER_TAXES_TEXT: Readonly<Record<OtherTaxesAs, { label: string; hint: string }>> = {
  perc_iibb: {
    label: 'Percepción de Ingresos Brutos',
    hint: 'Lo más común: el proveedor te cobró de más un impuesto provincial que después descontás.',
  },
  perc_iva: {
    label: 'Percepción de IVA',
    hint: 'Un adelanto de IVA que te cobró el proveedor y después descontás.',
  },
  internal: {
    label: 'Impuestos internos',
    hint: 'Típico de bebidas con alcohol o gaseosas: va al costo de lo que compraste.',
  },
  account: {
    label: 'Otra cuenta…',
    hint: 'Si no es ninguno de los anteriores, elegí vos a qué cuenta va.',
  },
}

export const MP_CHANNEL_TEXT: Readonly<Record<MpCobroChannel, string>> = {
  qr: 'Cobros con QR',
  point: 'Cobros con Point (el posnet de Mercado Pago)',
  link: 'Cobros con link de pago',
  transfer_in: 'Transferencias que te mandaron',
}

export const PARTY_ROLE_TEXT: Readonly<Record<PartyRole, string>> = {
  supplier: 'Elegí el proveedor',
  tax_agency: 'Elegí el organismo (ARCA, Rentas, la municipalidad…)',
  payroll: 'Elegí a quién corresponde el sueldo',
  card_processor: 'Elegí la tarjeta o el procesador de pagos',
  any: 'Elegí a quién corresponde',
}

/** Qué partícipes muestra el combo según el rol que pide la propuesta. */
export function partyKindsForRole(role: PartyRole): readonly string[] | null {
  switch (role) {
    case 'supplier':
      return ['supplier', 'other']
    case 'tax_agency':
      return ['tax_agency']
    case 'payroll':
      return ['payroll', 'partner', 'other']
    case 'card_processor':
      return ['card_processor', 'payment_wallet', 'delivery_platform']
    default:
      return null
  }
}

export const SUMMARY_KIND_TEXT: Readonly<Record<SummaryKind, string>> = {
  purchase: 'Compra',
  credit_note: 'Nota de crédito',
  mp_collection: 'Cobros del día',
  mp_bank_tax: 'Impuesto a los débitos y créditos',
  mp_iibb: 'Ingresos Brutos',
  mp_yield: 'Rendimientos',
  mp_transfer: 'Retiro a tu cuenta',
  mp_payment: 'Pago',
  mp_review: 'Para revisar',
  mp_reserve: 'Dinero retenido',
  bank_expense: 'Gastos del banco',
  bank_transfer: 'Transferencia entre tus cuentas',
  bank_payment: 'Pago',
  bank_collection: 'Cobro',
  bank_review: 'Para revisar',
}

/** Los números del detalle de una propuesta que vale la pena mostrar (plata en centavos). */
export const SUMMARY_DETAIL_TEXT: Readonly<Record<string, string>> = {
  gross_cents: 'Cobrado (bruto)',
  close_cents: 'Según el cierre del día',
  difference_cents: 'Diferencia con el cierre',
  commission_cents: 'Comisión',
  commission_vat_cents: 'IVA de la comisión',
  sirtac_cents: 'Retención de Ingresos Brutos (SIRTAC)',
  sircupa_cents: 'Retención de Ingresos Brutos (SIRCUPA)',
  ley25413_cents: 'Impuesto al cheque (débitos y créditos)',
  net_cents: 'Neto que te depositaron',
  applied_cents: 'Aplicado a lo pendiente',
  credit_cents: 'Sobre lo que entró',
  debit_cents: 'Sobre lo que salió',
  original_total_cents: 'Total en la moneda original',
}

/** Avisos que se aceptan una sola vez para todo el lote, explicados en criollo. */
export const BATCH_WARNING_TEXT: Readonly<Record<BatchAcceptableWarning, string>> = {
  vat_diff:
    'El IVA no da exacto con la alícuota del neto (ARCA redondea): se cargan tal cual dice cada factura.',
  voucher_condition:
    'Son facturas B o C de proveedores que podrían hacerte A: no te dejan descontar el IVA (va todo al costo). Pediles factura A.',
  voucher_m:
    'Son facturas A «sujetas a retención» (las ex «M»): puede corresponder retenerles IVA y Ganancias. Consultalo con tu contador o contadora.',
  late_registration:
    'Son facturas de hace más de 60 días: van al libro de IVA del mes en que las cargás.',
  treasury_negative:
    'Después de cargarlos, alguna caja quedaría en negativo. Suele faltar un ingreso o un cierre del día.',
}

export const BANK_EXPENSE_COMPONENT_TEXT: Readonly<Record<BankExpenseComponent, string>> = {
  comisiones: 'Comisión del banco',
  iva: 'IVA de la comisión',
  perc_iva: 'Percepción de IVA',
  ley25413_debito: 'Impuesto al cheque sobre lo que sale',
  ley25413_credito: 'Impuesto al cheque sobre lo que entra',
  sircreb: 'Retención de Ingresos Brutos (SIRCREB)',
  intereses: 'Intereses',
  gastos_sin_iva: 'Gasto bancario sin IVA',
}

/** Qué hace una regla del banco (`acc_import_rules.action.kind`). */
export const BANK_RULE_KIND_TEXT = {
  expense_component: 'Es un gasto o impuesto del banco',
  transfer: 'Es plata que pasa a otra cuenta tuya',
  payment: 'Es un pago a un proveedor u organismo',
  collection: 'Es un cobro de un cliente o tarjeta',
  movement: 'Va a una cuenta que elijo',
  ignore: 'No lo cargues (no es nuestro)',
  review: 'Dejalo para revisar',
} as const
export type BankRuleKind = keyof typeof BANK_RULE_KIND_TEXT

export const RULE_DIRECTION_TEXT = {
  any: 'Entra o sale',
  credit: 'Solo si entra plata',
  debit: 'Solo si sale plata',
} as const

/** «Contanos qué es cada columna» (extracto bancario). */
export const BANK_COLUMN_TEXT: Readonly<Record<BankColumn, string>> = {
  date: 'Fecha',
  valueDate: 'Fecha valor',
  description: 'Descripción o concepto',
  voucher: 'Número de comprobante',
  debit: 'Débito (plata que sale)',
  credit: 'Crédito (plata que entra)',
  amount: 'Importe (con signo menos si sale)',
  dc: 'Indica débito o crédito (D/C)',
  balance: 'Saldo',
  status: 'Estado del movimiento',
  counterpartyCuit: 'CUIT de la otra parte',
  counterpartyName: 'Nombre de la otra parte',
  reference: 'Referencia',
}

// ─── Plata para lectores ─────────────────────────────────────────────────────

/** «comprobante» / «comprobantes» según el origen. */
export function unitOf(source: UiImportSource, n: number): string {
  const [one, many] = IMPORT_SOURCE_COPY[source].unit
  return n === 1 ? one : many
}
