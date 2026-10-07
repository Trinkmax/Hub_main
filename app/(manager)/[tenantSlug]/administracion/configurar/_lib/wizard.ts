/**
 * El asistente de puesta en marcha (H.3), puro: estado inicial, lo que se
 * manda a `bootstrapAccounting` y los errores de cada campo. La validación es
 * el MISMO esquema que corre el servidor (`bootstrapSchemaAt`): lo que el
 * asistente deja pasar, la acción lo acepta.
 */

import { bootstrapMethodsIssue } from '@/lib/accounting/actions/payloads'
import {
  BOOKS_START_MAX_DAYS_BACK,
  type BootstrapInput,
  bootstrapSchemaAt,
} from '@/lib/accounting/schemas'
import type { Channel, SasIvaCondition, TreasuryKind } from '@/lib/accounting/types'
import { addDays, isRealIsoDay, startOfMonth } from '@/lib/dates'
import { parsePercentToBp } from '../../ajustes/_lib/percent'

// ─── Catálogos del asistente ─────────────────────────────────────────────────

export const PLATFORMS = [
  { key: 'pedidosya', label: 'PedidosYa' },
  { key: 'rappi', label: 'Rappi' },
  { key: 'uber_eats', label: 'Uber Eats' },
  { key: 'mp_delivery', label: 'Mercado Pago Delivery' },
  { key: 'pedix', label: 'Pedix' },
] as const
export type PlatformKey = (typeof PLATFORMS)[number]['key']

export const WIZARD_METHODS = [
  'cash',
  'transfer',
  'qr_mp',
  'debit',
  'credit',
  'customer_account',
] as const
export type WizardMethod = (typeof WIZARD_METHODS)[number]

export const TREASURY_KIND_OPTIONS: ReadonlyArray<{ value: TreasuryKind; label: string }> = [
  { value: 'cash', label: 'Caja (efectivo)' },
  { value: 'bank', label: 'Banco' },
  { value: 'wallet', label: 'Billetera (Mercado Pago, Ualá…)' },
  { value: 'credit_card', label: 'Tarjeta de crédito de la empresa' },
  { value: 'other', label: 'Otra' },
]

// ─── Estado ──────────────────────────────────────────────────────────────────

export type WizardTreasury = {
  /** Clave del asistente (`cash_main`, `extra_1`): la base la usa para enlazar medios. */
  key: string
  /** Las tres propuestas; las que suma la persona, `null`. */
  preset: 'cash' | 'wallet' | 'bank' | null
  enabled: boolean
  name: string
  kind: TreasuryKind
  alias: string
  bankName: string
  cbuCvu: string
}

export type WizardSalesPoint = { id: string; number: string; label: string; channel: Channel }

export type WizardRates = {
  mpQr: string
  mpIibb: string
  debit: string
  credit: string
  platforms: Record<PlatformKey, string>
}

export type WizardState = {
  displayName: string
  legalName: string
  cuit: string
  ivaCondition: SasIvaCondition
  iibbRegime: 'local' | 'convenio_multilateral' | 'exento'
  iibbNumber: string
  activityStartDate: string | null
  fiscalAddress: string
  booksStartDate: string | null
  /** La persona eligió la fecha de arranque: ya no la mueve el inicio de actividades. */
  booksStartTouched: boolean
  fiscalYearEndMonth: number
  ivaOnClose: boolean
  treasuries: WizardTreasury[]
  methods: Record<WizardMethod, boolean>
  platforms: Record<PlatformKey, boolean>
  /** Clave de la caja adonde entran las transferencias. */
  transferDestination: string | null
  transferDeductsIibb: boolean
  rates: WizardRates
  salesPoints: WizardSalesPoint[]
}

/** «HUB» → «HUB SAS»; si ya dice SAS, queda igual. */
export function defaultLegalName(tenantName: string): string {
  const name = tenantName.trim()
  if (!name) return ''
  return /\bS\.?\s?A\.?\s?S\.?$/i.test(name) ? name : `${name} SAS`
}

export function initialWizardState(opts: {
  tenantName: string
  displayName: string
  today: string
}): WizardState {
  return {
    displayName: opts.displayName,
    legalName: defaultLegalName(opts.tenantName),
    cuit: '',
    ivaCondition: 'responsable_inscripto',
    iibbRegime: 'local',
    iibbNumber: '',
    activityStartDate: null,
    fiscalAddress: '',
    booksStartDate: startOfMonth(opts.today),
    booksStartTouched: false,
    fiscalYearEndMonth: 12,
    ivaOnClose: true,
    treasuries: [
      {
        key: 'cash_main',
        preset: 'cash',
        enabled: true,
        name: 'Caja',
        kind: 'cash',
        alias: '',
        bankName: '',
        cbuCvu: '',
      },
      {
        key: 'wallet_main',
        preset: 'wallet',
        enabled: true,
        name: 'Mercado Pago',
        kind: 'wallet',
        alias: '',
        bankName: '',
        cbuCvu: '',
      },
      {
        key: 'bank_main',
        preset: 'bank',
        enabled: true,
        name: 'Banco Nación · cuenta corriente',
        kind: 'bank',
        alias: '',
        bankName: 'Banco de la Nación Argentina',
        cbuCvu: '',
      },
    ],
    methods: {
      cash: true,
      transfer: true,
      qr_mp: true,
      debit: true,
      credit: true,
      customer_account: true,
    },
    platforms: {
      pedidosya: false,
      rappi: false,
      uber_eats: false,
      mp_delivery: false,
      pedix: false,
    },
    transferDestination: 'wallet_main',
    transferDeductsIibb: true,
    rates: {
      mpQr: '1,5',
      mpIibb: '3,5',
      debit: '0,8',
      credit: '1,8',
      platforms: { pedidosya: '25', rappi: '', uber_eats: '', mp_delivery: '', pedix: '' },
    },
    salesPoints: [{ id: 'sp_1', number: '', label: '', channel: 'salon' }],
  }
}

/**
 * La fecha de arranque que se propone (H.3): el 1 del mes en curso, o el
 * inicio de actividades si es de los últimos 13 meses (una SAS nueva arranca
 * los libros el día que empezó).
 */
export function suggestedBooksStart(activityStartDate: string | null, today: string): string {
  const earliest = addDays(today, -BOOKS_START_MAX_DAYS_BACK)
  if (
    activityStartDate &&
    isRealIsoDay(activityStartDate) &&
    activityStartDate >= earliest &&
    activityStartDate <= today
  ) {
    return activityStartDate
  }
  return startOfMonth(today)
}

// ─── Borrador (localStorage) ─────────────────────────────────────────────────

const TREASURY_KINDS_SET: ReadonlySet<string> = new Set([
  'cash',
  'bank',
  'wallet',
  'credit_card',
  'other',
])
const CHANNELS_SET: ReadonlySet<string> = new Set(['salon', 'delivery', 'events'])

function text(v: unknown, fallback: string, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && isRealIsoDay(v) ? v : null
}

/**
 * Un borrador guardado en el navegador → el estado del asistente, completado
 * con `initial` campo por campo (un borrador viejo o roto nunca deja el
 * asistente a medias). `null` si no se lee.
 */
export function wizardStateFromDraft(raw: unknown, initial: WizardState): WizardState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.treasuries) || !Array.isArray(d.salesPoints)) return null
  const rec = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

  const treasuries: WizardTreasury[] = []
  for (const item of d.treasuries) {
    const t = rec(item)
    const key = typeof t.key === 'string' && /^[a-z][a-z0-9_]{1,30}$/.test(t.key) ? t.key : null
    const kind = typeof t.kind === 'string' && TREASURY_KINDS_SET.has(t.kind) ? t.kind : null
    if (!key || !kind || treasuries.some((x) => x.key === key)) continue
    const preset =
      t.preset === 'cash' || t.preset === 'wallet' || t.preset === 'bank' ? t.preset : null
    treasuries.push({
      key,
      preset,
      enabled: preset === 'cash' ? true : flag(t.enabled, true),
      name: text(t.name, '', 60),
      kind: kind as TreasuryKind,
      alias: text(t.alias, '', 20),
      bankName: text(t.bankName, '', 80),
      cbuCvu: text(t.cbuCvu, '', 26),
    })
  }
  if (!treasuries.some((t) => t.kind === 'cash')) return null

  const salesPoints: WizardSalesPoint[] = []
  for (const item of d.salesPoints) {
    const p = rec(item)
    if (typeof p.id !== 'string' || !/^sp_\d+$/.test(p.id)) continue
    salesPoints.push({
      id: p.id,
      number: text(p.number, '', 5).replace(/\D/g, ''),
      label: text(p.label, '', 60),
      channel:
        typeof p.channel === 'string' && CHANNELS_SET.has(p.channel)
          ? (p.channel as Channel)
          : 'salon',
    })
  }

  const methods = rec(d.methods)
  const platforms = rec(d.platforms)
  const rates = rec(d.rates)
  const ratePlatforms = rec(rates.platforms)
  const iva = d.ivaCondition
  const iibb = d.iibbRegime
  const month = typeof d.fiscalYearEndMonth === 'number' ? d.fiscalYearEndMonth : 12

  return {
    displayName: text(d.displayName, initial.displayName, 80),
    legalName: text(d.legalName, initial.legalName, 160),
    cuit: text(d.cuit, '', 16),
    ivaCondition:
      iva === 'responsable_inscripto' || iva === 'monotributo' || iva === 'exento'
        ? iva
        : initial.ivaCondition,
    iibbRegime:
      iibb === 'local' || iibb === 'convenio_multilateral' || iibb === 'exento'
        ? iibb
        : initial.iibbRegime,
    iibbNumber: text(d.iibbNumber, '', 30),
    activityStartDate: isoOrNull(d.activityStartDate),
    fiscalAddress: text(d.fiscalAddress, '', 200),
    booksStartDate: isoOrNull(d.booksStartDate) ?? initial.booksStartDate,
    booksStartTouched: flag(d.booksStartTouched, false),
    fiscalYearEndMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12,
    ivaOnClose: flag(d.ivaOnClose, initial.ivaOnClose),
    treasuries,
    methods: Object.fromEntries(
      WIZARD_METHODS.map((m) => [m, flag(methods[m], initial.methods[m])]),
    ) as Record<WizardMethod, boolean>,
    platforms: Object.fromEntries(
      PLATFORMS.map((p) => [p.key, flag(platforms[p.key], initial.platforms[p.key])]),
    ) as Record<PlatformKey, boolean>,
    transferDestination:
      typeof d.transferDestination === 'string'
        ? d.transferDestination
        : initial.transferDestination,
    transferDeductsIibb: flag(d.transferDeductsIibb, initial.transferDeductsIibb),
    rates: {
      mpQr: text(rates.mpQr, initial.rates.mpQr, 12),
      mpIibb: text(rates.mpIibb, initial.rates.mpIibb, 12),
      debit: text(rates.debit, initial.rates.debit, 12),
      credit: text(rates.credit, initial.rates.credit, 12),
      platforms: Object.fromEntries(
        PLATFORMS.map((p) => [
          p.key,
          text(ratePlatforms[p.key], initial.rates.platforms[p.key], 12),
        ]),
      ) as Record<PlatformKey, string>,
    },
    salesPoints,
  }
}

// ─── Lo que se ve habilitado ─────────────────────────────────────────────────

export function enabledTreasuries(state: WizardState): WizardTreasury[] {
  return state.treasuries.filter((t) => t.enabled)
}

/** Cajas adonde pueden entrar las transferencias (billeteras y bancos prendidos). */
export function transferTargets(state: WizardState): WizardTreasury[] {
  return enabledTreasuries(state).filter((t) => t.kind === 'wallet' || t.kind === 'bank')
}

export function hasWallet(state: WizardState): boolean {
  return enabledTreasuries(state).some((t) => t.kind === 'wallet')
}

/**
 * Lo que de verdad se manda: un medio que no tiene adónde ir (QR sin
 * billetera, transferencia sin billetera ni banco) se ve apagado y no viaja.
 */
export function effectiveMethods(state: WizardState): Record<WizardMethod, boolean> {
  return {
    ...state.methods,
    transfer: state.methods.transfer && transferTargets(state).length > 0,
    qr_mp: state.methods.qr_mp && hasWallet(state),
  }
}

/** La caja de las transferencias: la elegida si sigue prendida, si no la primera billetera o banco. */
export function effectiveTransferDestination(state: WizardState): string | null {
  const targets = transferTargets(state)
  const chosen = targets.find((t) => t.key === state.transferDestination)
  return (chosen ?? targets.find((t) => t.kind === 'wallet') ?? targets[0])?.key ?? null
}

/** ¿Se usa Mercado Pago? (QR, o transferencias a una billetera). */
export function usesWallet(state: WizardState): boolean {
  const methods = effectiveMethods(state)
  const destination = effectiveTransferDestination(state)
  const destKind = state.treasuries.find((t) => t.key === destination)?.kind
  return methods.qr_mp || (methods.transfer && destKind === 'wallet')
}

// ─── Payload y errores ───────────────────────────────────────────────────────

/** Campos del paso 1 (datos de la SAS): un error ahí vuelve a ese paso. */
export const STEP_ONE_FIELDS = [
  'displayName',
  'legalName',
  'cuit',
  'ivaCondition',
  'iibbRegime',
  'iibbNumber',
  'iibbJurisdictionCode',
  'activityStartDate',
  'fiscalAddress',
  'booksStartDate',
  'fiscalYearEndMonth',
  'ivaSettlementMode',
] as const

export function isStepOneField(field: string): boolean {
  return (STEP_ONE_FIELDS as readonly string[]).includes(field)
}

type RateField =
  | 'rates.mpQr'
  | 'rates.mpIibb'
  | 'rates.debit'
  | 'rates.credit'
  | `rates.${PlatformKey}`

export type WizardPayload = {
  /** Lo que recibe `bootstrapAccounting` (antes de zod). */
  raw: Record<string, unknown>
  /** Índice → clave de la caja (los errores de zod vienen por índice). */
  treasuryKeys: string[]
  /** Índice → id de la fila del punto de venta. */
  salesPointIds: string[]
  /** Porcentajes que no se leen (no viajan; se marcan en su campo). */
  rateErrors: Partial<Record<RateField, string>>
}

function blankSalesPoint(p: WizardSalesPoint): boolean {
  return p.number.trim() === '' && p.label.trim() === ''
}

function optional(text: string): string | null {
  const t = text.trim()
  return t === '' ? null : t
}

export function wizardPayload(state: WizardState): WizardPayload {
  const rateErrors: Partial<Record<RateField, string>> = {}
  const rate = (field: RateField, text: string): number | undefined => {
    const parsed = parsePercentToBp(text)
    if (!parsed.ok) {
      rateErrors[field] = parsed.message
      return undefined
    }
    return parsed.bp ?? undefined
  }

  const treasuries = enabledTreasuries(state)
  const methods = effectiveMethods(state)
  const enabledMethods = WIZARD_METHODS.filter((m) => methods[m])
  const enabledPlatforms = PLATFORMS.map((p) => p.key).filter((k) => state.platforms[k])

  const rates: Record<string, Record<string, number>> = {}
  const put = (party: string, values: Record<string, number | undefined>) => {
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(values)) if (v !== undefined) clean[k] = v
    if (Object.keys(clean).length > 0) rates[party] = clean
  }
  if (usesWallet(state)) {
    put('mercado_pago', {
      commissionBp: methods.qr_mp ? rate('rates.mpQr', state.rates.mpQr) : undefined,
      sircupaBp: rate('rates.mpIibb', state.rates.mpIibb),
    })
  }
  if (methods.debit) put('posnet_debito', { commissionBp: rate('rates.debit', state.rates.debit) })
  if (methods.credit) {
    put('posnet_credito', { commissionBp: rate('rates.credit', state.rates.credit) })
  }
  for (const key of enabledPlatforms) {
    put(key, { commissionBp: rate(`rates.${key}`, state.rates.platforms[key]) })
  }

  const points = state.salesPoints.filter((p) => !blankSalesPoint(p))
  const raw = {
    displayName: state.displayName,
    settings: {
      legalName: state.legalName,
      cuit: optional(state.cuit),
      ivaCondition: state.ivaCondition,
      iibbRegime: state.iibbRegime,
      iibbNumber: optional(state.iibbNumber),
      iibbJurisdictionCode: 904,
      activityStartDate: state.activityStartDate,
      fiscalAddress: optional(state.fiscalAddress),
      booksStartDate: state.booksStartDate ?? '',
      fiscalYearEndMonth: state.fiscalYearEndMonth,
      ivaSettlementMode: state.ivaOnClose ? 'on_close' : 'manual',
    },
    treasuries: treasuries.map((t) => {
      const bankName = optional(t.bankName)
      return {
        key: t.key,
        name: t.name,
        kind: t.kind,
        alias: optional(t.alias),
        bankName,
        cbuCvu: optional(t.cbuCvu),
        // Un banco con nombre queda también como proveedor (sus gastos van al Libro IVA).
        createBankParty: t.kind === 'bank' && bankName !== null,
      }
    }),
    sales: {
      transferDestination: methods.transfer ? effectiveTransferDestination(state) : null,
      transferDeductsIibb: state.transferDeductsIibb,
      enabledMethods,
      enabledPlatforms,
      rates,
      salesPoints: points.map((p) => {
        const text = p.number.trim()
        const number = /^\d{1,5}$/.test(text) ? Number(text) : text
        const label = p.label.trim()
        return {
          number,
          label: label || (typeof number === 'number' ? `Punto de venta ${number}` : ''),
          defaultChannel: p.channel,
        }
      }),
    },
  }
  return {
    raw,
    treasuryKeys: treasuries.map((t) => t.key),
    salesPointIds: points.map((p) => p.id),
    rateErrors,
  }
}

/**
 * Un error con la ruta de zod (`settings.cuit`, `treasuries.1.name`,
 * `sales.salesPoints.0.number`) → la clave del campo del asistente.
 */
export function wizardFieldKey(
  path: string,
  payload: Pick<WizardPayload, 'treasuryKeys' | 'salesPointIds'>,
): string {
  if (path === 'displayName') return 'displayName'
  if (path.startsWith('settings.')) {
    const field = path.split('.')[1] ?? 'form'
    // Los que el asistente no muestra como campo van al aviso general.
    return field === 'iibbJurisdictionCode' || field === 'ivaSettlementMode' ? 'form' : field
  }
  const treasury = /^treasuries\.(\d+)\.(\w+)/.exec(path)
  if (treasury) {
    const key = payload.treasuryKeys[Number(treasury[1])]
    return key ? `treasury.${key}.${treasury[2]}` : 'treasuries'
  }
  if (path.startsWith('treasuries')) return 'treasuries'
  const point = /^sales\.salesPoints\.(\d+)\.(\w+)/.exec(path)
  if (point) {
    const id = payload.salesPointIds[Number(point[1])]
    return id ? `salesPoint.${id}.${point[2]}` : 'salesPoints'
  }
  if (path.startsWith('sales.salesPoints')) return 'salesPoints'
  if (path === 'sales.transferDestination') return 'transferDestination'
  if (path.startsWith('sales.enabledMethods') || path.startsWith('sales.enabledPlatforms')) {
    return 'methods'
  }
  if (path.startsWith('sales.rates')) return 'rates'
  return 'form'
}

/** El paso de un campo: 1 = datos de la SAS; 2 = cajas y cobros. */
export function stepOfField(field: string): 1 | 2 {
  return isStepOneField(field) ? 1 : 2
}

export type WizardCheck =
  | { ok: true; input: BootstrapInput }
  | { ok: false; errors: Record<string, string>; step: 1 | 2 }

/**
 * Valida con el esquema del servidor. `upTo: 1` mira solo el paso 1 (para
 * pasar al 2 sin que salten errores de lo que todavía no se vio).
 */
export function checkWizard(state: WizardState, today: string, upTo: 1 | 2 = 2): WizardCheck {
  const payload = wizardPayload(state)
  const errors: Record<string, string> = {}
  const parsed = bootstrapSchemaAt(today).safeParse(payload.raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path
        .map((p) => (typeof p === 'symbol' ? (p.description ?? '') : String(p)))
        .join('.')
      const field = wizardFieldKey(path, payload)
      if (upTo === 1 && !isStepOneField(field)) continue
      if (!(field in errors)) errors[field] = issue.message
    }
  }
  if (upTo === 2) {
    for (const [field, message] of Object.entries(payload.rateErrors)) {
      if (message && !(field in errors)) errors[field] = message
    }
    if (parsed.success && Object.keys(errors).length === 0) {
      const issue = bootstrapMethodsIssue(parsed.data)
      if (issue) errors.methods = issue.message
    }
  }
  const fields = Object.keys(errors)
  if (fields.length > 0) {
    return { ok: false, errors, step: fields.some(isStepOneField) ? 1 : 2 }
  }
  if (!parsed.success) return { ok: false, errors: { form: 'Revisá los datos.' }, step: 1 }
  return { ok: true, input: parsed.data }
}

/** Errores de la base que corresponden a un campo puntual del asistente. */
export const SERVER_KEY_FIELDS: Readonly<Record<string, string>> = {
  invalid_cuit: 'cuit',
  invalid_start_date: 'booksStartDate',
  cash_required: 'treasuries',
  sales_point_taken: 'salesPoints',
  treasury_name_taken: 'treasuries',
  invalid_method_targets: 'methods',
}
