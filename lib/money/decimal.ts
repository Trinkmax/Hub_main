/**
 * Dígitos en es-AR escritos a mano para valores en UNIDADES que llegan como
 * `number` con coma flotante: pesos y dólares de «Cómo nos fue», cotizaciones,
 * conteos y porcentajes.
 *
 * Se mudó tal cual desde `lib/salon/event-marketing.ts`, que lo reexporta: las
 * pantallas y las planillas de «Cómo nos fue» dependen de este redondeo exacto
 * (sus tests lo fijan), así que acá no se cambia una coma.
 *
 * Por qué a mano y no `Intl.NumberFormat`: el ICU de Node 25 y el del navegador
 * del dueño no dan las mismas cadenas (`21,6%` contra `21,6 %`, `US$ 175,26`
 * con o sin espacio duro), y la misma cuenta renderizada en el server y en el
 * cliente rompía la hidratación. A mano sale idéntico en cualquier runtime.
 *
 * La plata guardada en centavos (enteros) NO pasa por acá: va por `format.ts`,
 * que trabaja con enteros y nunca toca coma flotante.
 */

/**
 * `round(|v| × 10^exp)` como entero, redondeando sobre la representación
 * decimal corta del número y no sobre el binario. Con `Math.round(v * 100)`,
 * 1,005 da 100 (porque 1,005 × 100 = 100,49999…); `Intl` y cualquier persona
 * dicen 1,01. Pasando por el string `'1.005e2'` sale 100,5 → 101, igual que
 * `Intl`. Los números en notación exponencial (< 1e-6 o ≥ 1e21) no tienen ese
 * problema a la escala que usamos y van por la cuenta directa.
 */
export function scaledInt(v: number, exp: number): number {
  const abs = Math.abs(v)
  const s = String(abs)
  return s.includes('e') ? Math.round(abs * 10 ** exp) : Math.round(Number(`${s}e${exp}`))
}

/** `1234567` → `'1.234.567'`. es-AR agrupa desde el millar (1.234, no 1234). */
export function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Número con `digits` decimales fijos, coma decimal y puntos de miles opcionales. */
export function decimalEsAr(v: number, digits: number, grouping: boolean): string {
  if (!Number.isFinite(v)) return '—'
  const n = scaledInt(v, digits)
  const negative = v < 0 && n > 0
  const fixed = (n / 10 ** digits).toFixed(digits)
  const [int = '0', frac] = fixed.split('.')
  const intPart = grouping ? groupThousands(int) : int
  return `${negative ? '-' : ''}${intPart}${frac ? `,${frac}` : ''}`
}

/** Redondeo a `digits` decimales con la misma regla que el formato. */
export function roundTo(v: number, digits: number): number {
  const n = scaledInt(v, digits) / 10 ** digits
  return v < 0 ? -n : n
}

/**
 * Entero si es redondo, dos decimales si los tiene: `1450` → `'1.450'`,
 * `1450.5` → `'1.450,50'`. Es la regla del dólar del día y de los precios
 * unitarios de «Cómo nos fue» (allá se llamaba `rateDigits`).
 */
export function decimalEsArAuto(v: number, grouping: boolean): string {
  const r = roundTo(v, 2)
  return decimalEsAr(r, Number.isInteger(r) ? 0 : 2, grouping)
}
