/**
 * El campo de precio de «Precios», puro: pesos ENTEROS en la pantalla, centavos en la base.
 *
 * - Mientras se tipea, los miles se separan solos («12500» → «12.500») y el cursor no salta.
 * - Vacío no es cero: vaciar el campo y salir deja el precio como estaba.
 * - Lo que se pega se lee con el parser de plata de siempre (`parseMoneyToCents`), así
 *   «$ 12.500,50» no se convierte en un millón y pico.
 */

import { groupThousands, parseMoneyToCents } from '@/lib/money'

/**
 * Hasta $ 999.999.999. Sobra para un precio de carta y queda bien por debajo del tope de la
 * base (1e12 centavos).
 */
export const MAX_PESOS_DIGITS = 9

/** Los ceros de adelante que no cuentan («007» → «7»; un «0» solo se queda). */
const LEADING_ZEROS = /^0+(?=\d)/

/** Solo los dígitos, sin ceros de adelante y cortado al máximo. */
export function pesosDigits(raw: string): string {
  return raw.replace(/\D/g, '').replace(LEADING_ZEROS, '').slice(0, MAX_PESOS_DIGITS)
}

/**
 * Lo tipeado, con los miles separados, y dónde tiene que quedar el cursor: después de la
 * misma cantidad de dígitos que tenía a la izquierda. `caret` vacío = al final.
 */
export function formatPesosTyping(
  raw: string,
  caret: number | null,
): { text: string; caret: number } {
  const text = groupThousands(pesosDigits(raw))
  if (caret === null) return { text, caret: text.length }

  const allDigits = raw.replace(/\D/g, '')
  const dropped = allDigits.length - allDigits.replace(LEADING_ZEROS, '').length
  const digitsLeft = Math.min(
    Math.max(0, raw.slice(0, caret).replace(/\D/g, '').length - dropped),
    MAX_PESOS_DIGITS,
  )

  let position = 0
  let seen = 0
  while (position < text.length && seen < digitsLeft) {
    if (/\d/.test(text.charAt(position))) seen += 1
    position += 1
  }
  return { text, caret: position }
}

/**
 * Lo que se tipeó de más: si `after` es `before` con dígitos metidos en algún lugar, esos
 * dígitos; si no (se reemplazó una selección, se borró algo, no cambió nada), `null`.
 *
 * Sirve para que «tocar un precio y tipear» lo reemplace aunque el navegador no haya dejado
 * todo seleccionado: «16.500» → «116.500» quiere decir que la persona tipeó «1», y ese «1» es
 * el precio nuevo que está empezando a escribir.
 */
export function insertedDigits(before: string, after: string): string | null {
  const was = before.replace(/\D/g, '')
  const now = after.replace(/\D/g, '')
  if (now.length <= was.length) return null
  let prefix = 0
  while (prefix < was.length && was.charAt(prefix) === now.charAt(prefix)) prefix += 1
  let suffix = 0
  while (
    suffix < was.length - prefix &&
    was.charAt(was.length - 1 - suffix) === now.charAt(now.length - 1 - suffix)
  ) {
    suffix += 1
  }
  if (prefix + suffix < was.length) return null
  return now.slice(prefix, now.length - suffix)
}

/** Centavos → lo que se lee en el campo («12.500»). Al peso; la mitad redondea para arriba. */
export function pesosFieldText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return ''
  return groupThousands(String(Math.floor((Math.abs(cents) + 50) / 100)))
}

export type PesosRead = { kind: 'empty' } | { kind: 'value'; cents: number }

/** Lo que quedó escrito en el campo → centavos. */
export function readPesosField(text: string): PesosRead {
  const digits = pesosDigits(text)
  if (digits === '') return { kind: 'empty' }
  return { kind: 'value', cents: Number(digits) * 100 }
}

/**
 * Lo que se pega desde una planilla o un mensaje («$ 12.500,50», «12,500.00», «12500») →
 * el texto del campo, en pesos enteros. `null` si no se entiende o no entra.
 */
export function pesosFromPaste(clip: string): string | null {
  const parsed = parseMoneyToCents(clip)
  if (!parsed.ok) return null
  const digits = String(Math.floor((parsed.cents + 50) / 100))
  if (digits.length > MAX_PESOS_DIGITS) return null
  return groupThousands(digits)
}
