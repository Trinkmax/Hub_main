/**
 * Volver a leer cuando llega un aviso en vivo, sin perder ninguno y sin leer de más — PURO y testeado.
 *
 * Las pantallas del punto de venta escuchan un canal que dice «algo cambió» y vuelven a leer lo suyo.
 * Las reglas:
 *   · el primer aviso espera un instante (`settleMs`) por si vienen varios juntos: una tanda mueve el
 *     salón y la cocina a la vez;
 *   · los que llegan mientras tanto NO reinician la espera, entran en esa misma lectura. Un chorro
 *     continuo de avisos no puede postergarla para siempre;
 *   · si llega uno durante una lectura, al terminar se lee de nuevo: lo que cambió en el medio no se pierde;
 *   · nunca más de una lectura cada `minGapMs`, por más avisos que lleguen (el canal es compartido).
 */
export type LiveReloadClock = {
  now: () => number
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export type LiveReload = {
  /** Llegó un aviso: leer pronto. */
  poke: () => void
  /** Leer ya (al entrar, al volver la conexión, la red de seguridad). Si hay una lectura en curso, se encola. */
  now: () => Promise<void>
  /** La pantalla se fue: no se lee más. */
  stop: () => void
}

export function createLiveReload(
  read: () => Promise<void> | void,
  options: { settleMs?: number; minGapMs?: number; clock?: LiveReloadClock } = {},
): LiveReload {
  const settleMs = options.settleMs ?? 220
  const minGapMs = options.minGapMs ?? 900
  const clock: LiveReloadClock = options.clock ?? {
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }

  let timer: unknown = null
  let running = false
  let again = false
  let stopped = false
  let lastStart = Number.NEGATIVE_INFINITY

  const run = async (): Promise<void> => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    if (timer !== null) {
      clock.clearTimer(timer)
      timer = null
    }
    running = true
    lastStart = clock.now()
    try {
      await read()
    } catch {
      // Quien lee decide qué mostrar si falla; acá solo importa no quedar trabado.
    } finally {
      running = false
      if (again && !stopped) {
        again = false
        poke()
      }
    }
  }

  const poke = (): void => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    if (timer !== null) return
    const wait = Math.max(settleMs, lastStart + minGapMs - clock.now())
    timer = clock.setTimer(() => {
      timer = null
      void run()
    }, wait)
  }

  return {
    poke,
    now: run,
    stop: () => {
      stopped = true
      if (timer !== null) clock.clearTimer(timer)
      timer = null
    },
  }
}
