/**
 * Ayudas chicas de los ejemplos del catálogo. Puro y sin React.
 */

/** Espera de mentira: lo que tarda una Server Action o una búsqueda en volver. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
