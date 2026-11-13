import { describe, expect, it } from 'vitest'
import { createLiveReload, type LiveReloadClock } from '@/lib/pos/live-reload'

/** Un reloj de mentira: el tiempo avanza cuando la prueba lo dice. */
function fakeClock() {
  let t = 0
  let seq = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  const clock: LiveReloadClock = {
    now: () => t,
    setTimer: (run, ms) => {
      seq += 1
      timers.set(seq, { at: t + ms, run })
      return seq
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
  }
  const advance = async (ms: number) => {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].run()
      // Dejar correr lo que quedó esperando una promesa.
      await Promise.resolve()
      await Promise.resolve()
    }
    t = end
  }
  return { clock, advance, pending: () => timers.size }
}

/** Una lectura que termina cuando la prueba la suelta. */
function slowRead() {
  let count = 0
  let release: (() => void) | null = null
  const read = () => {
    count += 1
    return new Promise<void>((resolve) => {
      release = resolve
    })
  }
  return {
    read,
    count: () => count,
    finish: async () => {
      release?.()
      release = null
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('createLiveReload — volver a leer cuando llega un aviso', () => {
  it('varios avisos juntos son una sola lectura', async () => {
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    live.poke()
    live.poke()
    live.poke()
    expect(reads).toBe(0)
    await advance(220)
    expect(reads).toBe(1)
  })

  it('un chorro continuo de avisos no posterga la lectura para siempre', async () => {
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    // Un aviso cada 100 ms durante 3 segundos: con un retardo que se reinicia nunca leería.
    for (let i = 0; i < 30; i += 1) {
      live.poke()
      await advance(100)
    }
    expect(reads).toBeGreaterThanOrEqual(3)
  })

  it('por más avisos que lleguen, no lee más de una vez cada 900 ms', async () => {
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    for (let i = 0; i < 100; i += 1) {
      live.poke()
      await advance(50)
    }
    // 5 segundos: la primera a los 220 ms y después una cada 900 ms.
    expect(reads).toBeLessThanOrEqual(6)
    expect(reads).toBeGreaterThanOrEqual(5)
  })

  it('un aviso que llega durante una lectura no se pierde: se lee de nuevo al terminar', async () => {
    const { clock, advance } = fakeClock()
    const slow = slowRead()
    const live = createLiveReload(slow.read, { clock })
    live.poke()
    await advance(220)
    expect(slow.count()).toBe(1)
    live.poke() // llega mientras la primera lectura sigue en viaje
    await advance(2000)
    expect(slow.count()).toBe(1)
    await slow.finish()
    await advance(900)
    expect(slow.count()).toBe(2)
  })

  it('«leer ya» no espera, y si hay una lectura en curso se encola una sola', async () => {
    const { clock, advance } = fakeClock()
    const slow = slowRead()
    const live = createLiveReload(slow.read, { clock })
    void live.now()
    expect(slow.count()).toBe(1)
    void live.now()
    void live.now()
    live.poke()
    expect(slow.count()).toBe(1)
    await slow.finish()
    await advance(900)
    expect(slow.count()).toBe(2)
    await slow.finish()
    await advance(5000)
    expect(slow.count()).toBe(2)
  })

  it('«leer ya» cancela la lectura que estaba por salir (no lee dos veces seguidas)', async () => {
    const { clock, advance, pending } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    live.poke()
    expect(pending()).toBe(1)
    await live.now()
    expect(reads).toBe(1)
    expect(pending()).toBe(0)
    await advance(1000)
    expect(reads).toBe(1)
  })

  it('una lectura que falla no deja la pantalla trabada', async () => {
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(
      () => {
        reads += 1
        if (reads === 1) throw new Error('sin red')
      },
      { clock },
    )
    live.poke()
    await advance(220)
    expect(reads).toBe(1)
    live.poke()
    await advance(900)
    expect(reads).toBe(2)
  })

  it('después de irse la pantalla no lee más', async () => {
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    live.poke()
    live.stop()
    await advance(1000)
    live.poke()
    await live.now()
    await advance(1000)
    expect(reads).toBe(0)
  })

  it('parar tiene vuelta: si la pantalla vuelve, sigue leyendo', async () => {
    // React desmonta y vuelve a montar una pantalla conservando su estado (en desarrollo, siempre).
    // Con un «parar» sin vuelta la pantalla quedaba «en vivo» pero no se actualizaba nunca.
    const { clock, advance } = fakeClock()
    let reads = 0
    const live = createLiveReload(() => void (reads += 1), { clock })
    live.start()
    live.stop()
    live.start()
    live.poke()
    await advance(220)
    expect(reads).toBe(1)
    await live.now()
    expect(reads).toBe(2)
  })

  it('lo que quedó pendiente al irse no se dispara al volver', async () => {
    const { clock, advance } = fakeClock()
    const slow = slowRead()
    const live = createLiveReload(slow.read, { clock })
    void live.now()
    live.poke() // se encola otra lectura…
    live.stop() // …pero la pantalla se va
    await slow.finish()
    live.start()
    await advance(2000)
    expect(slow.count()).toBe(1)
  })
})
