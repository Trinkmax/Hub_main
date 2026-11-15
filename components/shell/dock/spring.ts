/**
 * Resortes amortiguados para la barra de abajo (masa 1). Puros: no tocan el DOM ni piden cuadros; el
 * componente los avanza en su propio `requestAnimationFrame` y deja de pedir cuadros cuando todos se
 * quedan quietos.
 *
 * Se integran en pasos fijos de 1/240 s: si un cuadro tarda (el celular estaba ocupado), el resorte da
 * varios pasos chicos en vez de uno gigante, y no se desboca.
 */
export type Spring = {
  value: number
  velocity: number
  target: number
  /** Rigidez: cuánto tira hacia el destino. */
  stiffness: number
  /** Amortiguación: cuánto frena. Con poca, rebota. */
  damping: number
  /** Debajo de esta distancia (y su velocidad equivalente) se considera quieto. */
  precision: number
}

/** El paso fijo de la integración. */
const STEP = 1 / 240
/** Un cuadro más largo que esto no se recupera: es una pestaña que volvió del fondo, no movimiento. */
const MAX_FRAME = 0.064

export function createSpring(
  value: number,
  {
    stiffness,
    damping,
    precision = 0.01,
  }: { stiffness: number; damping: number; precision?: number },
): Spring {
  return { value, velocity: 0, target: value, stiffness, damping, precision }
}

/** Avanza el resorte `dt` segundos. */
export function stepSpring(spring: Spring, dt: number): void {
  let remaining = Math.min(Math.max(dt, 0), MAX_FRAME)
  while (remaining > 1e-9) {
    const h = Math.min(STEP, remaining)
    const force =
      -spring.stiffness * (spring.value - spring.target) - spring.damping * spring.velocity
    // Euler semi-implícito: primero la velocidad, después la posición con la velocidad nueva. Es estable
    // con estos pasos chicos y no inventa energía.
    spring.velocity += force * h
    spring.value += spring.velocity * h
    remaining -= h
  }
}

/** ¿Llegó y se quedó quieto? */
export function springSettled(spring: Spring): boolean {
  return (
    Math.abs(spring.value - spring.target) < spring.precision &&
    Math.abs(spring.velocity) < spring.precision * 20
  )
}

/** Lo deja clavado en `value` (sin animar): para el primer dibujo y para «reducir movimiento». */
export function snapSpring(spring: Spring, value: number = spring.target): void {
  spring.value = value
  spring.target = value
  spring.velocity = 0
}

/** Cambia cómo se mueve sin cortar el movimiento que trae. */
export function tuneSpring(spring: Spring, stiffness: number, damping: number): void {
  spring.stiffness = stiffness
  spring.damping = damping
}
