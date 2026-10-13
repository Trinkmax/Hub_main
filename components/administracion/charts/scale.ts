/**
 * Las cuentas de los gráficos de Administración: escala del eje, porcentajes y
 * la geometría de líneas y áreas. Todo puro y con tests
 * (`tests/lib/adm-chart-scale.test.ts`).
 *
 * Dos reglas que cruzan todo el archivo:
 *
 * 1. **Sumas, productos y redondeo a 2 decimales**, sin seno, coseno ni
 *    logaritmos: el server y el navegador tienen que escribir exactamente los
 *    mismos atributos (un `height: 33.333333%` distinto en el último dígito es
 *    un aviso de hidratación).
 * 2. **Sin `Intl`**: la plata corta del eje es la misma de «Cómo se movió la
 *    plata» (`formatAxisCents`), para que dos gráficos de la sección nunca
 *    digan «$ 1,2 M» y «$ 1.2M» del mismo número.
 */

import { formatAxisCents } from '@/lib/accounting/cash-daily'
import { NBSP } from '@/lib/money'

/** Un peso, en centavos: el eje nunca baja de pesos enteros. */
const ONE_PESO = 100

/** 2 decimales: el mismo atributo en el server y en el navegador, y un HTML corto. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * El paso «redondo» del eje (1, 2 o 5 por una potencia de diez, en pesos) para
 * que `maxCents` entre en `maxTicks` tramos como mucho. Con 1-2-5 las etiquetas
 * nunca pasan de tres cifras («$ 150 mil», «$ 2 M»): un paso de 2,5 daría
 * «$ 12,5 mil» y no entra en el margen del celular.
 */
export function niceStep(maxCents: number, maxTicks = 4): number {
  if (!Number.isFinite(maxCents) || maxCents <= 0) return ONE_PESO
  const raw = maxCents / Math.max(1, Math.floor(maxTicks))
  let pow = ONE_PESO
  // Multiplicando (y no con `log10`): enteros exactos en cualquier motor.
  while (pow * 10 <= raw) pow *= 10
  for (const m of [1, 2, 5]) {
    if (pow * m >= raw) return pow * m
  }
  return pow * 10
}

/**
 * El tope del eje: el primer múltiplo del paso que alcanza a `maxCents`. Sin
 * datos (cero, negativo, `NaN`) devuelve un paso, así nadie divide por cero.
 */
export function niceMax(maxCents: number, maxTicks = 4): number {
  const step = niceStep(maxCents, maxTicks)
  if (!Number.isFinite(maxCents) || maxCents <= 0) return step
  return Math.ceil(maxCents / step) * step
}

/** Las marcas del eje, de 0 al tope: `ticks(1_230_000_00)` → 0, $ 500 mil, $ 1 M, $ 1,5 M. */
export function ticks(maxCents: number, maxTicks = 4): number[] {
  const step = niceStep(maxCents, maxTicks)
  const top = niceMax(maxCents, maxTicks)
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

export type NiceDomain = { min: number; max: number; step: number; ticks: number[] }

/**
 * El eje de algo que puede quedar bajo cero (el saldo de una caja en
 * descubierto). El cero SIEMPRE entra: un área que no arranca en cero miente
 * el tamaño. `min <= 0 <= max`, los dos múltiplos del paso.
 */
export function niceDomain(minCents: number, maxCents: number, maxTicks = 4): NiceDomain {
  const lo = Number.isFinite(minCents) ? Math.min(0, minCents) : 0
  const hi = Number.isFinite(maxCents) ? Math.max(0, maxCents) : 0
  const step = niceStep(hi - lo, maxTicks)
  // `|| 0`: sin esto un `-0` se cuela en el eje y rompe comparaciones exactas.
  const min = -Math.ceil(-lo / step) * step || 0
  let max = Math.ceil(hi / step) * step || 0
  if (max === min) max = min + step
  const out: number[] = []
  for (let v = min; v <= max; v += step) out.push(v)
  return { min, max, step, ticks: out }
}

/**
 * Qué parte es `part` de `total`, de 0 a 100 y redondeado: el `width` o el
 * `height` de una marca. Sin total (cero o negativo) es 0, nunca `NaN`.
 */
export function pct(part: number, total: number, decimals = 2): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  const f = 10 ** Math.max(0, Math.floor(decimals))
  return Math.round(clamp((part / total) * 100, 0, 100) * f) / f
}

/**
 * Porcentajes enteros que suman 100 (resto mayor): la leyenda de una barra
 * partida no puede sumar 99 ni 101. Los valores negativos o inválidos cuentan
 * como cero; sin total, todo es cero.
 */
export function sharePercents(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = clean.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return clean.map(() => 0)
  const exact = clean.map((v) => (v / total) * 100)
  const out = exact.map((e) => Math.floor(e))
  let left = 100 - out.reduce((sum, v) => sum + v, 0)
  // El punto que falta va al de mayor resto; a igual resto, al más grande.
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e), value: clean[i] ?? 0 }))
    .sort((a, b) => b.rest - a.rest || b.value - a.value || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    out[o.i] = (out[o.i] ?? 0) + 1
    left -= 1
  }
  return out
}

/**
 * Un porcentaje entero en palabras de pantalla: `24 %`. Algo mayor que cero
 * que redondea a cero dice «menos de 1 %» (un «0 %» al lado de una barrita que
 * se ve sería mentira).
 */
export function percentLabel(percent: number, hasValue = percent > 0): string {
  if (!Number.isFinite(percent)) return '—'
  if (percent <= 0) return hasValue ? `menos de 1${NBSP}%` : `0${NBSP}%`
  return `${Math.round(percent)}${NBSP}%`
}

/**
 * Lo mismo en la columna angosta de una leyenda: `24 %` y `<1 %`. La versión
 * en palabras queda para el globito y el `aria-label`, donde hay lugar.
 */
export function percentShort(percent: number, hasValue = percent > 0): string {
  if (!Number.isFinite(percent)) return '—'
  if (percent <= 0 && hasValue) return `<1${NBSP}%`
  return percentLabel(percent, hasValue)
}

/**
 * Plata corta para el eje y las etiquetas sobre las marcas: «$ 850»,
 * «$ 350 mil», «$ 1,2 M», «−$ 2 M». Es `formatAxisCents` (la del gráfico de
 * cajas) con el nombre de esta familia: una sola regla de abreviado.
 */
export function compactCents(cents: number): string {
  return formatAxisCents(cents)
}

/**
 * Qué casilleros llevan etiqueta en el eje cuando no entran todos: uno cada
 * tantos, más los `pinned` (hoy, el último). Una etiqueta común que queda
 * pegada a una fijada se saca: en 320 px dos números a 2 casilleros se pisan.
 */
export function labelIndexes(
  count: number,
  maxLabels: number,
  pinned: readonly number[] = [],
): number[] {
  if (!Number.isFinite(count) || count <= 0) return []
  const n = Math.floor(count)
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(maxLabels))))
  const fixed = pinned.filter((p) => Number.isInteger(p) && p >= 0 && p < n)
  const minGap = Math.ceil(step * 0.6)
  const out = new Set<number>(fixed)
  for (let i = 0; i < n; i += step) {
    if (fixed.every((p) => p === i || Math.abs(p - i) >= minGap)) out.add(i)
  }
  return [...out].sort((a, b) => a - b)
}

/* ── Geometría de líneas y áreas ─────────────────────────────────────────────
   El lienzo es siempre de 100 × 100 (`viewBox="0 0 100 100"` estirado con
   `preserveAspectRatio="none"`): `x` e `y` son a la vez coordenadas del SVG y
   porcentajes de CSS, así una marca dibujada con `div` cae justo sobre la
   línea. Cada dato ocupa un casillero del mismo ancho y su punto va al centro
   del casillero (igual que una columna), no en los bordes. */

export type ChartPoint = { x: number; y: number }

/** El centro del casillero `index` de `count`, de 0 a 100. */
export function slotX(index: number, count: number): number {
  if (count <= 0) return 50
  return round2(((index + 0.5) / count) * 100)
}

/** El borde izquierdo del casillero `index` de `count`, de 0 a 100. */
export function slotEdge(index: number, count: number): number {
  if (count <= 0) return 0
  return round2(clamp(index / count, 0, 1) * 100)
}

/** Altura de un valor en el lienzo: 0 arriba (`max`), 100 abajo (`min`). */
export function valueY(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 100
  return round2(clamp(1 - (value - min) / (max - min), 0, 1) * 100)
}

/**
 * Una línea que NO une los puntos a los dos lados de un dato faltante: cada
 * tramo seguido es un `path` aparte y un dato suelto (sin vecinos) vuelve como
 * punto para dibujarlo con un círculo. Un día sin cargar no es un día en cero.
 */
export function linePaths(points: ReadonlyArray<ChartPoint | null>): {
  paths: string[]
  lonely: ChartPoint[]
} {
  const paths: string[] = []
  const lonely: ChartPoint[] = []
  let run: ChartPoint[] = []
  const flush = () => {
    const first = run[0]
    if (run.length === 1 && first) lonely.push(first)
    else if (run.length > 1) {
      paths.push(run.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '))
    }
    run = []
  }
  for (const p of points) {
    if (p) run.push(p)
    else flush()
  }
  flush()
  return { paths, lonely }
}

/**
 * Línea ESCALONADA de un saldo: cada valor se sostiene todo el ancho de su
 * casillero y salta derecho al siguiente (un saldo no «sube de a poco» entre
 * dos días). `from`/`to` recortan casilleros (`to` excluido) para dibujar por
 * separado lo que ya pasó y lo que viene.
 */
export function stepLinePath(
  ys: readonly number[],
  from = 0,
  to: number = ys.length,
): string | null {
  const n = ys.length
  const start = clamp(Math.floor(from), 0, n)
  const end = clamp(Math.floor(to), 0, n)
  if (end <= start) return null
  let d = ''
  for (let i = start; i < end; i++) {
    const y = ys[i] ?? 100
    d += i === start ? `M${slotEdge(i, n)} ${y}` : ` V${y}`
    d += ` H${slotEdge(i + 1, n)}`
  }
  return d
}

/** La misma línea escalonada cerrada contra `baseY` (el cero): el lavado de abajo. */
export function stepAreaPath(
  ys: readonly number[],
  baseY: number,
  from = 0,
  to: number = ys.length,
): string | null {
  const line = stepLinePath(ys, from, to)
  if (!line) return null
  const n = ys.length
  const start = clamp(Math.floor(from), 0, n)
  return `${line} V${baseY} H${slotEdge(start, n)} Z`
}
