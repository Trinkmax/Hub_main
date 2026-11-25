/**
 * Lo más nuevo que vio esta pestaña de cada pantalla del punto de venta — PURO y testeado
 * (`tests/lib/pos-freshest.test.ts`).
 *
 * Por qué (25/11/2026, Nacho: «aprieto [servido] y a veces no se marca, y el tema de la cuenta también»): para
 * que ir y volver sea instantáneo, el navegador guarda la última versión de cada pantalla (Next guarda las
 * páginas 30 s con `staleTimes`, y la flecha de «atrás» siempre usa la copia guardada). Al volver a una mesa
 * después de marcar como servido, la pantalla arrancaba con esa copia vieja y mostraba «Servido · 6» otra vez,
 * y la cuenta podía arrancar con un total viejo (medido en producción: 20 s hasta corregirse sola).
 *
 * Cada lectura del punto de venta trae la hora del servidor (`now`). Acá se compara cada versión que llega
 * (la copia guardada al entrar, una lectura, la respuesta de una acción) con la más nueva que ya vio esta
 * pestaña, y gana la más nueva: la pantalla nunca vuelve para atrás. De paso, una lectura lenta que vuelve
 * después de la respuesta de una acción ya no pisa lo que la acción dejó.
 */

export type Stamped = { now: string }

/** Cuántas pantallas recuerda (mesas, cuentas, salones). Una noche entera entra holgada. */
const LIMIT = 300

const store = new Map<string, Stamped>()

function stamp(value: Stamped): number {
  const ms = Date.parse(value.now)
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * La versión más nueva entre `candidate` y la última que vio esta pestaña para `key`. Si `candidate` es la
 * más nueva (o igual de nueva), queda guardada y se devuelve; si no, se devuelve la guardada.
 */
export function keepFreshest<T extends Stamped>(key: string, candidate: T): T {
  const known = store.get(key) as T | undefined
  if (known !== undefined && stamp(known) > stamp(candidate)) return known
  // Borrar y volver a poner la deja al final: así lo que se usa hace rato es lo primero en irse.
  store.delete(key)
  store.set(key, candidate)
  if (store.size > LIMIT) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  return candidate
}

/** Las claves de cada pantalla, en un solo lugar. */
export const freshKey = {
  session: (sessionId: string) => `session:${sessionId}`,
  bill: (sessionId: string) => `bill:${sessionId}`,
  floor: (branchId: string) => `floor:${branchId}`,
}

/** Solo para las pruebas: arrancar sin nada visto. */
export function forgetAllFreshest(): void {
  store.clear()
}
