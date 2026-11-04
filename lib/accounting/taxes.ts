/**
 * Los impuestos que se calculan solos (reunión del 29/10/2026): Ingresos Brutos y Comercio e Industria en cada
 * cierre del día, y el impuesto a los débitos y créditos al salir plata de un banco o una billetera.
 *
 * Puro: lo usan el motor, las pantallas y los tests. Los porcentajes viven en `acc_settings.tax_settings` y se
 * cambian en Ajustes › Impuestos. Los «bp» son centésimas de punto: 300 = 3 %.
 */

export const TAX_BASES = ['invoiced_net', 'all_sales'] as const
export type TaxBase = (typeof TAX_BASES)[number]

export type TaxSettings = {
  /** Apagado, nada se calcula solo. */
  auto: boolean
  iibbBp: number
  municipalBp: number
  bankTaxBp: number
  /** Sobre qué se calculan Ingresos Brutos y Comercio e Industria. */
  base: TaxBase
}

/** Lo que dijeron en la reunión. Comercio e Industria se dijo «0,007» y «0,007 %»: quedó 0,7 %. */
export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  auto: true,
  iibbBp: 300,
  municipalBp: 70,
  bankTaxBp: 60,
  base: 'invoiced_net',
}

function bpOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000
    ? value
    : fallback
}

/** `acc_settings.tax_settings` → `TaxSettings`. Un valor raro cae en el de fábrica. */
export function parseTaxSettings(raw: unknown): TaxSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_TAX_SETTINGS
  const r = raw as Record<string, unknown>
  return {
    auto: typeof r.auto === 'boolean' ? r.auto : DEFAULT_TAX_SETTINGS.auto,
    iibbBp: bpOf(r.iibb_bp, DEFAULT_TAX_SETTINGS.iibbBp),
    municipalBp: bpOf(r.municipal_bp, DEFAULT_TAX_SETTINGS.municipalBp),
    bankTaxBp: bpOf(r.bank_tax_bp, DEFAULT_TAX_SETTINGS.bankTaxBp),
    base: r.base === 'all_sales' ? 'all_sales' : 'invoiced_net',
  }
}

/** `TaxSettings` → el `p_settings` de `acc_save_tax_settings`. */
export function taxSettingsPayload(settings: TaxSettings): Record<string, unknown> {
  return {
    auto: settings.auto,
    iibb_bp: settings.iibbBp,
    municipal_bp: settings.municipalBp,
    bank_tax_bp: settings.bankTaxBp,
    base: settings.base,
  }
}

/** Un porcentaje de un importe en centavos, redondeado a la mitad hacia arriba, sin errores de coma flotante. */
export function percentOfCents(cents: number, bp: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0 || bp <= 0) return 0
  return Number((BigInt(cents) * BigInt(bp) + 5000n) / 10000n)
}

/** ¿Al salir plata de esta cuenta se calcula el impuesto? Sin decidir: bancos y billeteras sí, efectivo no. */
export function chargesBankTax(treasury: {
  kind: string
  chargesBankTax?: boolean | null
}): boolean {
  if (typeof treasury.chargesBankTax === 'boolean') return treasury.chargesBankTax
  return treasury.kind === 'bank' || treasury.kind === 'wallet'
}

/** La base de Ingresos Brutos y Comercio e Industria de un cierre, en centavos. */
export function closeTaxBase(
  input: { invoicedNetCents: number; uninvoicedCents: number },
  base: TaxBase,
): number {
  const invoiced = Math.max(0, input.invoicedNetCents)
  return base === 'all_sales' ? invoiced + Math.max(0, input.uninvoicedCents) : invoiced
}

export type CloseTaxes = { iibbCents: number; municipalCents: number }

/** Lo que devenga un cierre. Con los impuestos apagados, nada. */
export function closeTaxes(
  input: { invoicedNetCents: number; uninvoicedCents: number },
  settings: TaxSettings | null | undefined,
): CloseTaxes {
  if (!settings?.auto) return { iibbCents: 0, municipalCents: 0 }
  const base = closeTaxBase(input, settings.base)
  return {
    iibbCents: percentOfCents(base, settings.iibbBp),
    municipalCents: percentOfCents(base, settings.municipalBp),
  }
}

/** El impuesto al cheque de lo que sale de una cuenta. `0` si no corresponde. */
export function bankTaxOf(
  amountCents: number,
  treasury: { kind: string; chargesBankTax?: boolean | null } | null | undefined,
  settings: TaxSettings | null | undefined,
): number {
  if (!settings?.auto || !treasury || !chargesBankTax(treasury)) return 0
  return percentOfCents(amountCents, settings.bankTaxBp)
}

/** «3 %», «0,7 %», para mostrar un porcentaje en pantalla. */
export function bpLabel(bp: number): string {
  const value = (bp / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  return `${value} %`
}

/** «0,7» → 70. `null` si no es un porcentaje entre 0 y 100. */
export function parsePercentToBp(text: string): number | null {
  const clean = text.replace('%', '').trim().replace(',', '.')
  if (clean === '') return null
  const value = Number(clean)
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}
