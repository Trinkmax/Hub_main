/**
 * La app se pone al día sola — la decisión, PURA y testeada (`tests/lib/app-version.test.ts`).
 *
 * Por qué (25/11/2026, Nacho: «para la app es importante que se refresque en tiempo real… lo que no quiero
 * que pase es que para que las cosas impacten sí o sí debas recargar la pantalla»): producción tiene la
 * protección de versiones de Vercel, así que una app abierta sigue hablando con SU versión (la que tenía
 * cuando se cargó) aunque ya haya otra publicada. Un arreglo no le llega a un celular hasta que la app se
 * recarga entera, y una app instalada no tiene botón de recargar.
 *
 * La pantalla pregunta cada tanto qué versión está publicada (`/api/version`). Si es otra, recarga sola, pero
 * solo en un momento en que no le saca nada de las manos a nadie. Esto decide cuál es ese momento:
 *
 *   · En el panel y en el salón: apenas se cambia de pantalla (lo de la pantalla anterior ya se dejó).
 *   · Solo en el salón, además: al volver a la app, con la app escondida un rato, o tras medio minuto sin
 *     tocar nada (la tele de la cocina y la tablet de las reservas no cambian nunca de pantalla).
 *   · En el panel nunca por quietud ni al volver: ahí hay formularios largos y la gente va a otra pestaña a
 *     copiar datos; recargar les borraría lo escrito.
 *
 * Nunca: sin conexión, sin haber confirmado recién contra el servidor, con algo abierto o escrito (`busy`),
 * con una pantalla que pidió que no (`held`: un cobro, una comanda a medio armar, la cámara, la impresora), ni
 * dos veces seguidas por la misma versión (si al recargar sigue viendo otra, no entra en un bucle).
 *
 * Una excepción: si la versión de esta app YA NO CONTESTA (`orphaned`), nada de lo que haga va a funcionar;
 * en el salón se recarga aunque una pantalla haya pedido que no.
 */

export type Workspace = 'salon' | 'panel'

/** Cada cuánto se pregunta, con la pantalla a la vista. */
export const CHECK_EVERY_MS = 60_000
/** La primera pregunta, un rato después de cargar (que no compita con lo que la pantalla necesita ya). */
export const FIRST_CHECK_MS = 5_000
/** Una recarga tiene que venir pegada a una respuesta del servidor: prueba que hay red y que la versión es esa. */
export const FRESH_CHECK_MS = 15_000
/** Sin tocar nada este tiempo, en el salón, la pantalla está quieta. */
export const IDLE_MS = 30_000
/** Escondida este tiempo: nadie la mira. (Un celular congela la página antes: ahí se recarga al volver.) */
export const HIDDEN_MS = 20_000
/** «Recién llegué a esta pantalla»: se cambió hace un instante y todavía no se tocó nada. */
export const NAV_GRACE_MS = 2_000
/** No se recarga dos veces por la misma versión en menos de esto. */
export const RELOAD_COOLDOWN_MS = 10 * 60_000

export type ReloadMark = { id: string; at: number }

export type Situation = {
  /** La versión con la que se cargó esta app. `null` = no se sabe (desarrollo): no se hace nada. */
  mine: string | null
  /** La versión publicada, según la última respuesta. `null` = todavía no se sabe. */
  latest: string | null
  workspace: Workspace
  now: number
  /** Cuándo llegó la última respuesta buena del servidor. */
  checkedAt: number | null
  online: boolean
  visible: boolean
  /** Hace cuánto está escondida, de corrido (0 si se ve). */
  hiddenMs: number
  /** Esta es la primera mirada después de volver a la app. */
  resumed: boolean
  /** Hace cuánto que nadie toca nada. */
  idleMs: number
  /** Hace cuánto se cambió de pantalla dentro de la app (`null` = no se cambió desde que cargó). */
  sinceNavigationMs: number | null
  /** Si se tocó algo después de ese cambio de pantalla. */
  touchedSinceNavigation: boolean
  /** Hay un diálogo abierto, un campo en uso o algo escrito en la pantalla. */
  busy: boolean
  /** Una pantalla pidió que no se recargue ahora. */
  held: boolean
  /** La versión de esta app ya no contesta: nada de lo que se haga va a llegar. */
  orphaned: boolean
  /** La última recarga que hizo esto, si el navegador la pudo anotar. */
  lastReload: ReloadMark | null
  /** `false` si el navegador no deja anotar nada (modo privado): se cuida el bucle con la edad de la página. */
  canRemember: boolean
  /** Hace cuánto se cargó esta página. */
  pageAgeMs: number
}

export type ReloadReason = 'navigation' | 'resume' | 'hidden' | 'idle' | 'orphaned'
export type WaitReason =
  | 'unknown'
  | 'same'
  | 'offline'
  | 'unconfirmed'
  | 'cooldown'
  | 'panel'
  | 'held'
  | 'busy'
  | 'active'

export type Verdict = { reload: true; why: ReloadReason } | { reload: false; why: WaitReason }

const wait = (why: WaitReason): Verdict => ({ reload: false, why })
const go = (why: ReloadReason): Verdict => ({ reload: true, why })

/** ¿Hay una versión publicada distinta de la de esta app? */
export function isStale(mine: string | null, latest: string | null): boolean {
  return mine !== null && latest !== null && mine !== latest
}

export function decide(s: Situation): Verdict {
  if (s.mine === null || s.latest === null) return wait('unknown')
  if (s.mine === s.latest) return wait('same')
  if (!s.online) return wait('offline')
  if (s.checkedAt === null || s.now - s.checkedAt > FRESH_CHECK_MS) return wait('unconfirmed')

  // Ya se recargó por esta versión hace poco y sigue viendo otra: algo no cierra, no se insiste.
  if (
    s.lastReload !== null &&
    s.lastReload.id === s.latest &&
    s.now - s.lastReload.at < RELOAD_COOLDOWN_MS
  ) {
    return wait('cooldown')
  }
  if (!s.canRemember && s.pageAgeMs < RELOAD_COOLDOWN_MS) return wait('cooldown')

  // Recién se cambió de pantalla y todavía no se tocó nada: lo anterior ya se dejó, lo nuevo no se empezó.
  if (
    s.sinceNavigationMs !== null &&
    s.sinceNavigationMs <= NAV_GRACE_MS &&
    !s.touchedSinceNavigation
  ) {
    return go('navigation')
  }

  if (s.workspace === 'panel') return wait('panel')

  // De acá en más, solo el salón.
  if (s.busy) return wait('busy')
  if (s.orphaned) return go('orphaned')
  if (s.held) return wait('held')
  if (s.resumed && s.visible) return go('resume')
  if (!s.visible && s.hiddenMs >= HIDDEN_MS) return go('hidden')
  if (s.idleMs >= IDLE_MS) return go('idle')
  return wait('active')
}

/** Cuándo conviene volver a mirar, con una versión nueva esperando su momento. `null` = no hace falta. */
export function nextLook(s: Situation, verdict: Verdict): number | null {
  if (verdict.reload) return null
  if (!isStale(s.mine, s.latest)) return null
  switch (verdict.why) {
    // Falta poco para que la pantalla quede quieta (o lleve un rato escondida): se mira justo ahí.
    case 'active': {
      const untilIdle = IDLE_MS - s.idleMs
      const untilHidden = s.visible ? Number.POSITIVE_INFINITY : HIDDEN_MS - s.hiddenMs
      return Math.max(1_000, Math.min(untilIdle, untilHidden) + 250)
    }
    // Algo abierto o una pantalla que pidió que no: se vuelve a mirar cada tanto.
    case 'busy':
    case 'held':
    case 'unconfirmed':
      return 10_000
    // En el panel se espera al cambio de pantalla; sin red o recién recargado, a la próxima pregunta.
    default:
      return null
  }
}

/** El id del deployment que contesta: primero el de Next (el mismo que recibe el navegador), después el de Vercel. */
export function pickDeploymentId(next: unknown, vercel: unknown): string | null {
  for (const candidate of [next, vercel]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return null
}

/** Lee lo que contestó `/api/version`. Cualquier otra cosa es «no sé». */
export function parseVersion(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const id = (body as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null
}

/** Lee la marca de la última recarga. Una marca rota es «no hubo». */
export function parseReloadMark(raw: string | null): ReloadMark | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { id, at } = value as { id?: unknown; at?: unknown }
    if (typeof id !== 'string' || id.length === 0) return null
    if (typeof at !== 'number' || !Number.isFinite(at)) return null
    return { id, at }
  } catch {
    return null
  }
}
