/**
 * Ajustes › Impuestos, puro: lo que dice cada fila de la tabla y cómo se lee lo que se escribe en
 * una celda. Los porcentajes y sus cuentas viven en `lib/accounting/taxes.ts`.
 */

import {
  bpLabel,
  parsePercentToBp,
  TAX_BASES,
  type TaxBase,
  type TaxSettings,
} from '@/lib/accounting/taxes'

/** Los impuestos que se calculan con un porcentaje que se puede cambiar. */
export type TaxField = 'iibbBp' | 'municipalBp' | 'bankTaxBp'

export const TAX_BASE_LABELS: Readonly<Record<TaxBase, string>> = {
  invoiced_net: 'Lo facturado, sin IVA',
  all_sales: 'Todo lo vendido',
}

export const TAX_BASE_OPTIONS: ReadonlyArray<{ value: TaxBase; label: string }> = TAX_BASES.map(
  (value) => ({ value, label: TAX_BASE_LABELS[value] }),
)

export function isTaxBase(value: unknown): value is TaxBase {
  return typeof value === 'string' && (TAX_BASES as readonly string[]).includes(value)
}

/** Lo que va adentro de la celda: «0,7», sin el «%», que queda afuera. */
export function percentCellText(bp: number): string {
  return bpLabel(bp).replace(/\s*%$/, '')
}

export type TaxRow = {
  /** Único por fila. `iva` no se cambia acá: su alícuota va en cada comprobante. */
  key: TaxField | 'iva'
  name: string
  /** `null`: no se escribe (el IVA). */
  field: TaxField | null
  /** «Sobre qué», cuando es fijo. `null`: se elige (`base`, uno solo para los dos que lo usan). */
  over: string | null
  /** «Cuándo se calcula». */
  when: string
  /** Se apaga con «Calcular solos». */
  automatic: boolean
}

export const TAX_ROWS: readonly TaxRow[] = [
  {
    key: 'iva',
    name: 'IVA',
    field: null,
    over: 'Lo facturado',
    when: 'En cada comprobante',
    automatic: false,
  },
  {
    key: 'iibbBp',
    name: 'Ingresos Brutos',
    field: 'iibbBp',
    over: null,
    when: 'En cada cierre',
    automatic: true,
  },
  {
    key: 'municipalBp',
    name: 'Comercio e Industria',
    field: 'municipalBp',
    over: null,
    when: 'En cada cierre',
    automatic: true,
  },
  {
    key: 'bankTaxBp',
    name: 'Débitos y créditos',
    field: 'bankTaxBp',
    over: 'Cada pago con banco o billetera',
    when: 'Al pagar',
    automatic: true,
  },
]

/** El IVA es solo informativo: la alícuota de cada comprobante la dice el comprobante. */
export const IVA_RATE_BP = 2100
export const IVA_NOTE = 'Solo informativo: la alícuota va por comprobante.'

/** El porcentaje de la reunión que hay que confirmar (se dijo de dos formas). */
export const MUNICIPAL_MEETING_BP = 70

/**
 * La línea de Comercio e Industria: se dijo de dos formas en la reunión del 29/10/2026 y quedó
 * 0,7 %. Mientras siga en ese valor se avisa; si alguien lo cambió, ya no hay nada que confirmar.
 */
export function municipalNote(
  settings: Pick<TaxSettings, 'municipalBp'>,
  opts: { readOnly: boolean },
): string | null {
  if (settings.municipalBp !== MUNICIPAL_MEETING_BP) return null
  const said = 'Comercio e Industria se dijo “0,007” y “0,007 %” en la reunión: quedó 0,7 %.'
  return opts.readOnly
    ? `${said} Si es otro, avisales a los socios.`
    : `${said} Confirmalo con tu contadora.`
}

export const PERCENT_CELL_ERROR = 'Escribí un porcentaje de 0 a 100, por ejemplo 0,7.'

export type PercentCellRead =
  /** No cambió: no hay nada que guardar. */
  { kind: 'same' } | { kind: 'changed'; bp: number } | { kind: 'invalid'; message: string }

/** Lo que quedó escrito en una celda al salir, contra lo que está guardado. */
export function readPercentCell(text: string, savedBp: number): PercentCellRead {
  const bp = parsePercentToBp(text)
  if (bp === null) return { kind: 'invalid', message: PERCENT_CELL_ERROR }
  return bp === savedBp ? { kind: 'same' } : { kind: 'changed', bp }
}
