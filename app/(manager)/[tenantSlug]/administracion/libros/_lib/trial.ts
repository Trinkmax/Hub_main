/**
 * Sumas y saldos en pantalla (H.12): qué filas se ven según el nivel elegido
 * y si se muestran las cuentas sin saldo ni movimiento. La base devuelve TODO
 * el plan (164 cuentas, la mayoría en cero al principio): por defecto se
 * esconden las que están en cero de punta a punta. Puro.
 */

export type TrialLevel = 1 | 2 | 3 | 'todo'

/** `?nivel=1|2|3`; cualquier otra cosa (o nada) es «Todo». */
export function parseTrialLevel(raw: string | null): TrialLevel {
  return raw === '1' ? 1 : raw === '2' ? 2 : raw === '3' ? 3 : 'todo'
}

type TrialLike = {
  level: number
  openingDebitCents: number
  openingCreditCents: number
  periodDebitCents: number
  periodCreditCents: number
  closingDebitCents: number
  closingCreditCents: number
}

/** Sin saldo inicial, sin movimientos y sin saldo final. */
export function isZeroTrialRow(row: TrialLike): boolean {
  return (
    row.openingDebitCents === 0 &&
    row.openingCreditCents === 0 &&
    row.periodDebitCents === 0 &&
    row.periodCreditCents === 0 &&
    row.closingDebitCents === 0 &&
    row.closingCreditCents === 0
  )
}

/** Las filas que se ven: hasta el nivel elegido y, salvo que se pidan todas, sin las de cero. */
export function visibleTrialRows<T extends TrialLike>(
  rows: readonly T[],
  opts: { level: TrialLevel; includeZero: boolean },
): T[] {
  return rows.filter(
    (row) =>
      (opts.level === 'todo' || row.level <= opts.level) &&
      (opts.includeZero || !isZeroTrialRow(row)),
  )
}

/** El saldo como Debe − Haber (positivo = deudor) a partir de las dos columnas de la base. */
export function netOf(debitCents: number, creditCents: number): number {
  return debitCents - creditCents
}
