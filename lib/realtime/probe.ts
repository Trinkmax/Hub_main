/**
 * Revisar si la conexión en vivo sigue viva — PURO y testeado (`tests/lib/realtime-probe.test.ts`).
 *
 * Al bloquear el celular el navegador congela la página y el servidor corta la conexión, pero la página no se
 * entera: al volver, el socket sigue figurando abierto y la librería recién lo da por muerto cuando un latido queda
 * sin respuesta (hasta ~50 s sin avisos). Acá se manda un latido apenas vuelve la pantalla; si en `PROBE_MS` no
 * contesta, se usa el mismo camino que usa la librería cuando un latido vence: marca los canales con error,
 * reconecta y los vuelve a unir.
 *
 * Lo usa `lib/supabase/browser.ts` (`probeRealtime`) al volver la pantalla, la red o la página desde la caché.
 */

/** Lo mínimo del cliente de Realtime que hace falta para revisar la conexión (así se prueba sin navegador). */
export type ProbeableRealtime = {
  getChannels(): ReadonlyArray<unknown>
  isConnected(): boolean
  connect(): void
  /** El latido que se mandó y todavía no tiene respuesta, si hay uno. */
  readonly pendingHeartbeatRef: string | null
  /** Con otro latido sin respuesta, la librería lo da por vencido: reconecta y vuelve a unir los canales. */
  sendHeartbeat(): Promise<void>
}

/** Cuánto se espera la respuesta de un latido antes de dar la conexión por muerta. Sana, contesta en ~100 ms. */
export const PROBE_MS = 3_500

export type ProbeOutcome =
  /** No hay canales: no hay nada que mantener (la librería suelta la conexión sola). */
  | 'idle'
  /** La conexión ya estaba cerrada: se pidió abrirla (los canales con error se vuelven a unir solos). */
  | 'connecting'
  /** Se mandó (o se espera) un latido; si no contesta en `PROBE_MS`, se da por muerta. */
  | 'probing'

export function probeConnection(
  realtime: ProbeableRealtime,
  later: (run: () => void, ms: number) => unknown = (run, ms) => setTimeout(run, ms),
): ProbeOutcome {
  if (realtime.getChannels().length === 0) return 'idle'
  if (!realtime.isConnected()) {
    realtime.connect()
    return 'connecting'
  }
  // Un latido ya en viaje (el de antes de bloquear) se espera; si no hay ninguno, se manda uno ahora.
  if (!realtime.pendingHeartbeatRef) void realtime.sendHeartbeat()
  later(() => {
    // Sigue sin respuesta: un latido más con otro pendiente es, para la librería, «este se venció».
    if (realtime.isConnected() && realtime.pendingHeartbeatRef) void realtime.sendHeartbeat()
  }, PROBE_MS)
  return 'probing'
}
