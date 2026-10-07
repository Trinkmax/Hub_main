/**
 * CUIT / CUIL: 11 dígitos, prefijo válido y dígito verificador módulo 11.
 *
 * Es el MISMO algoritmo que `public.acc_cuit_is_valid` (Sprint 1, A.1), así lo
 * que el formulario acepta la base no lo rechaza:
 * - prefijos 20, 23, 24, 25, 26, 27 (personas) y 30, 33, 34 (empresas);
 * - pesos 5, 4, 3, 2, 7, 6, 5, 4, 3, 2 sobre los primeros 10 dígitos;
 * - verificador = 11 − (suma % 11); si da 11 es 0, y si da 10 el número no
 *   existe (ARCA reasigna el prefijo a 23 y el verificador queda 9 o 4).
 *
 * Verificados con la base: 30-71876543-5, 33-69345023-9 y 30-70308853-4.
 */

export const CUIT_PREFIXES = ['20', '23', '24', '25', '26', '27', '30', '33', '34'] as const

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const

/** Solo los dígitos: `'20-12345678-6'` y `'20 12345678 6'` → `'20123456786'`. */
export function normalizeCuit(input: string | null | undefined): string {
  return (input ?? '').replace(/\D/g, '')
}

/**
 * El verificador de los primeros 10 dígitos, o `null` si no hay verificador
 * posible (suma que da 10) o si no son 10 dígitos.
 */
export function cuitCheckDigit(firstTen: string): number | null {
  if (!/^\d{10}$/.test(firstTen)) return null
  let sum = 0
  for (let i = 0; i < 10; i++) sum += Number(firstTen[i]) * (CUIT_WEIGHTS[i] ?? 0)
  const check = 11 - (sum % 11)
  if (check === 11) return 0
  if (check === 10) return null
  return check
}

export type CuitIssue = 'vacio' | 'largo' | 'prefijo' | 'digito'

export type CuitParse = { ok: true; cuit: string } | { ok: false; reason: CuitIssue }

/** Lee un CUIT tipeado con o sin guiones; devuelve los 11 dígitos o por qué no sirve. */
export function parseCuit(input: string | null | undefined): CuitParse {
  const raw = (input ?? '').trim()
  if (raw === '') return { ok: false, reason: 'vacio' }
  // Solo dígitos, espacios, guiones, puntos y barras: una letra no es un CUIT.
  if (/[^\d\s\-./]/.test(raw)) return { ok: false, reason: 'largo' }
  const digits = normalizeCuit(raw)
  if (digits.length !== 11) return { ok: false, reason: 'largo' }
  if (!(CUIT_PREFIXES as readonly string[]).includes(digits.slice(0, 2))) {
    return { ok: false, reason: 'prefijo' }
  }
  const check = cuitCheckDigit(digits.slice(0, 10))
  if (check === null || check !== Number(digits[10])) return { ok: false, reason: 'digito' }
  return { ok: true, cuit: digits }
}

/** ¿Es un CUIT/CUIL válido? Acepta guiones y espacios. */
export function isValidCuit(input: string | null | undefined): boolean {
  return parseCuit(input).ok
}

/**
 * `'20123456786'` → `'20-12345678-6'`. Si no son 11 dígitos devuelve lo que
 * vino (sin espacios en los bordes), así el campo muestra lo tipeado junto al
 * error en vez de inventar guiones.
 */
export function formatCuit(input: string | null | undefined): string {
  const digits = normalizeCuit(input)
  if (digits.length !== 11) return (input ?? '').trim()
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

/** Mensajes del campo (kit, CodeField). */
export const CUIT_MESSAGES: Readonly<Record<CuitIssue, string>> = {
  vacio: 'Falta el CUIT.',
  largo: 'El CUIT tiene 11 números.',
  prefijo: 'El CUIT tiene que empezar con 20, 23, 24, 25, 26, 27, 30, 33 o 34.',
  digito: 'El CUIT no es válido: revisá el último número',
}
