/**
 * Sumas y saldos en pantalla (H.12): qué filas se ven según el nivel elegido
 * y si se muestran las cuentas sin saldo ni movimiento. La base devuelve TODO
 * el plan (226 cuentas en el estándar, la mayoría en cero al principio): por
 * defecto se esconden las que están en cero de punta a punta. Puro.
 *
 * Niveles: el plan estándar tiene 5 (`1.0.00.00.000` Activo … `1.1.01.01.001`
 * Caja). Un plan importado o editado puede ir más hondo (la base acepta hasta
 * 8): ahí aparece además «Todo».
 */

/** Los niveles que se ofrecen siempre (los del plan estándar). */
export const TRIAL_LEVELS = [1, 2, 3, 4, 5] as const

export type TrialLevel = (typeof TRIAL_LEVELS)[number] | 'todo'

/** `?nivel=1…5`; cualquier otra cosa (o nada) es «Todo». */
export function parseTrialLevel(raw: string | null): TrialLevel {
  const n = raw !== null && /^[1-5]$/.test(raw) ? Number(raw) : null
  return TRIAL_LEVELS.find((l) => l === n) ?? 'todo'
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

/** El nivel más hondo del plan (al menos 1). */
export function deepestTrialLevel(rows: ReadonlyArray<{ level: number }>): number {
  return rows.reduce((max, row) => (row.level > max ? row.level : max), 1)
}

export type TrialLevelChip = {
  value: TrialLevel
  label: string
  aria: string
  /** Lo que va en `?nivel=` (`null` = sin parámetro: todo el plan). */
  param: string | null
}

const LEVEL_ARIA: Readonly<Record<(typeof TRIAL_LEVELS)[number], string>> = {
  1: 'Solo los rubros principales',
  2: 'Hasta el segundo nivel',
  3: 'Hasta el tercer nivel',
  4: 'Hasta el cuarto nivel',
  5: 'Hasta el quinto nivel',
}

/**
 * Los chips de nivel: 1 a 5 siempre; «Todo» solo si el plan tiene cuentas más
 * hondas que el nivel 5 (si no, el 5 ya es el plan entero y es el elegido por
 * defecto).
 */
export function trialLevelChips(deepest: number): TrialLevelChip[] {
  const deeper = deepest > 5
  const chips: TrialLevelChip[] = TRIAL_LEVELS.map((level) => ({
    value: level,
    label: String(level),
    aria: !deeper && level === 5 ? 'Todas las cuentas' : LEVEL_ARIA[level],
    param: !deeper && level === 5 ? null : String(level),
  }))
  if (deeper) chips.push({ value: 'todo', label: 'Todo', aria: 'Todas las cuentas', param: null })
  return chips
}

/** El chip activo: el nivel pedido, o el que muestra el plan entero. */
export function isActiveTrialChip(chip: TrialLevelChip, level: TrialLevel): boolean {
  if (chip.param === null) return level === 'todo' || chip.value === level
  return chip.value === level
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
