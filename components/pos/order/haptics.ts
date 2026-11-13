/**
 * Un toque corto en la mano cuando el celular entendió. Los iPhone no vibran desde la web: ahí no
 * pasa nada (y no es un error).
 */
export function buzz(pattern: number | number[] = 10): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // El navegador no lo permite (por ejemplo, antes del primer toque): se sigue sin vibrar.
  }
}
