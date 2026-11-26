import { describe, expect, it } from 'vitest'
import {
  decide,
  FRESH_CHECK_MS,
  HIDDEN_MS,
  IDLE_MS,
  isStale,
  NAV_GRACE_MS,
  nextLook,
  parseReloadMark,
  parseVersion,
  pickDeploymentId,
  RELOAD_COOLDOWN_MS,
  type Situation,
} from '@/lib/app-version/decide'
import { holdReload, reloadHeld } from '@/lib/app-version/hold'

const NOW = 1_800_000_000_000

/** Un mozo usando el salón, con una versión nueva recién confirmada y nada que impida recargar. */
function salon(overrides: Partial<Situation> = {}): Situation {
  return {
    mine: 'dpl_A',
    latest: 'dpl_B',
    workspace: 'salon',
    now: NOW,
    checkedAt: NOW - 200,
    online: true,
    visible: true,
    hiddenMs: 0,
    resumed: false,
    idleMs: 4_000,
    sinceNavigationMs: null,
    touchedSinceNavigation: false,
    busy: false,
    held: false,
    orphaned: false,
    lastReload: null,
    canRemember: true,
    pageAgeMs: 3 * 60 * 60_000,
    ...overrides,
  }
}
const panel = (overrides: Partial<Situation> = {}) => salon({ workspace: 'panel', ...overrides })

describe('cuándo hay una versión nueva', () => {
  it('solo si se conocen las dos y son distintas', () => {
    expect(isStale('dpl_A', 'dpl_B')).toBe(true)
    expect(isStale('dpl_A', 'dpl_A')).toBe(false)
    expect(isStale(null, 'dpl_B')).toBe(false)
    expect(isStale('dpl_A', null)).toBe(false)
  })

  it('en desarrollo (sin versión) o sin respuesta todavía, no se hace nada', () => {
    expect(decide(salon({ mine: null, idleMs: IDLE_MS * 4 }))).toEqual({
      reload: false,
      why: 'unknown',
    })
    expect(decide(salon({ latest: null, idleMs: IDLE_MS * 4 }))).toEqual({
      reload: false,
      why: 'unknown',
    })
  })

  it('con la misma versión no se recarga nunca, pase lo que pase', () => {
    const same = salon({
      latest: 'dpl_A',
      idleMs: IDLE_MS * 10,
      resumed: true,
      sinceNavigationMs: 10,
      orphaned: true,
    })
    expect(decide(same)).toEqual({ reload: false, why: 'same' })
  })
})

describe('el salón se pone al día solo', () => {
  it('mientras se está usando, espera', () => {
    expect(decide(salon())).toEqual({ reload: false, why: 'active' })
  })

  it('tras medio minuto sin tocar nada (la tele de la cocina, la tablet de reservas), recarga', () => {
    expect(decide(salon({ idleMs: IDLE_MS - 1 }))).toEqual({ reload: false, why: 'active' })
    expect(decide(salon({ idleMs: IDLE_MS }))).toEqual({ reload: true, why: 'idle' })
  })

  it('al volver a la app (el celular desbloqueado), recarga antes de que se toque nada', () => {
    expect(decide(salon({ resumed: true, idleMs: 0 }))).toEqual({ reload: true, why: 'resume' })
  })

  it('escondida un rato (otra pestaña de la compu), recarga sin que nadie lo vea', () => {
    expect(decide(salon({ visible: false, hiddenMs: HIDDEN_MS - 1, idleMs: 1_000 }))).toEqual({
      reload: false,
      why: 'active',
    })
    expect(decide(salon({ visible: false, hiddenMs: HIDDEN_MS, idleMs: 1_000 }))).toEqual({
      reload: true,
      why: 'hidden',
    })
  })

  it('recién al cambiar de pantalla, recarga (lo anterior ya se dejó)', () => {
    expect(decide(salon({ sinceNavigationMs: 150 }))).toEqual({ reload: true, why: 'navigation' })
  })
})

describe('el panel solo se pone al día al cambiar de pantalla', () => {
  it('ni por quietud, ni al volver, ni escondido: ahí hay formularios largos', () => {
    expect(decide(panel({ idleMs: IDLE_MS * 20 }))).toEqual({ reload: false, why: 'panel' })
    expect(decide(panel({ resumed: true }))).toEqual({ reload: false, why: 'panel' })
    expect(decide(panel({ visible: false, hiddenMs: HIDDEN_MS * 30 }))).toEqual({
      reload: false,
      why: 'panel',
    })
    expect(decide(panel({ orphaned: true, idleMs: IDLE_MS * 20 }))).toEqual({
      reload: false,
      why: 'panel',
    })
  })

  it('apenas se cambia de pantalla, sí', () => {
    expect(decide(panel({ sinceNavigationMs: 300 }))).toEqual({ reload: true, why: 'navigation' })
  })
})

describe('«recién llegué»: el cambio de pantalla vale un instante y sin haber tocado nada', () => {
  it('si ya pasó el instante, no cuenta como cambio de pantalla', () => {
    expect(decide(panel({ sinceNavigationMs: NAV_GRACE_MS + 1 }))).toEqual({
      reload: false,
      why: 'panel',
    })
    expect(decide(salon({ sinceNavigationMs: NAV_GRACE_MS + 1 }))).toEqual({
      reload: false,
      why: 'active',
    })
  })

  it('si ya se tocó algo en la pantalla nueva, tampoco', () => {
    expect(decide(panel({ sinceNavigationMs: 400, touchedSinceNavigation: true }))).toEqual({
      reload: false,
      why: 'panel',
    })
  })

  it('al llegar a una pantalla que después va a pedir que no (la cuenta), se recarga igual: no se empezó nada', () => {
    expect(decide(salon({ sinceNavigationMs: 120, held: true, busy: true }))).toEqual({
      reload: true,
      why: 'navigation',
    })
  })
})

describe('nunca le saca nada de las manos a nadie', () => {
  it('con un diálogo abierto, un campo en uso o algo escrito: espera', () => {
    for (const situation of [
      salon({ busy: true, idleMs: IDLE_MS * 5 }),
      salon({ busy: true, resumed: true }),
      salon({ busy: true, visible: false, hiddenMs: HIDDEN_MS * 5 }),
      salon({ busy: true, orphaned: true, idleMs: IDLE_MS * 5 }),
    ]) {
      expect(decide(situation)).toEqual({ reload: false, why: 'busy' })
    }
  })

  it('con una pantalla que pidió que no (un cobro, la comanda a medio armar, la cámara): espera', () => {
    expect(decide(salon({ held: true, idleMs: IDLE_MS * 5 }))).toEqual({
      reload: false,
      why: 'held',
    })
    expect(decide(salon({ held: true, resumed: true }))).toEqual({ reload: false, why: 'held' })
    expect(decide(salon({ held: true, visible: false, hiddenMs: HIDDEN_MS * 5 }))).toEqual({
      reload: false,
      why: 'held',
    })
  })

  it('sin conexión no recarga: la página podría no volver', () => {
    expect(decide(salon({ online: false, idleMs: IDLE_MS * 5 }))).toEqual({
      reload: false,
      why: 'offline',
    })
    expect(decide(panel({ online: false, sinceNavigationMs: 100 }))).toEqual({
      reload: false,
      why: 'offline',
    })
  })

  it('sin una respuesta reciente del servidor no recarga (hay que preguntar de nuevo antes)', () => {
    expect(decide(salon({ checkedAt: null, idleMs: IDLE_MS * 5 }))).toEqual({
      reload: false,
      why: 'unconfirmed',
    })
    expect(decide(salon({ checkedAt: NOW - FRESH_CHECK_MS - 1, idleMs: IDLE_MS * 5 }))).toEqual({
      reload: false,
      why: 'unconfirmed',
    })
    expect(decide(salon({ checkedAt: NOW - FRESH_CHECK_MS, idleMs: IDLE_MS * 5 }))).toEqual({
      reload: true,
      why: 'idle',
    })
  })
})

describe('si la versión de esta app ya no contesta', () => {
  it('en el salón recarga aunque una pantalla haya pedido que no: nada de lo que haga va a llegar', () => {
    expect(decide(salon({ orphaned: true, held: true, idleMs: 500 }))).toEqual({
      reload: true,
      why: 'orphaned',
    })
  })

  it('y sin esperar a que la pantalla quede quieta', () => {
    expect(decide(salon({ orphaned: true, idleMs: 0 }))).toEqual({ reload: true, why: 'orphaned' })
  })
})

describe('no entra en un bucle', () => {
  it('si ya recargó por esta versión hace poco y sigue viendo otra, no insiste', () => {
    const justReloaded = { id: 'dpl_B', at: NOW - 60_000 }
    for (const situation of [
      salon({ lastReload: justReloaded, idleMs: IDLE_MS * 5 }),
      salon({ lastReload: justReloaded, resumed: true }),
      salon({ lastReload: justReloaded, sinceNavigationMs: 100 }),
      salon({ lastReload: justReloaded, orphaned: true }),
      panel({ lastReload: justReloaded, sinceNavigationMs: 100 }),
    ]) {
      expect(decide(situation)).toEqual({ reload: false, why: 'cooldown' })
    }
  })

  it('pasado el rato, prueba una vez más', () => {
    const longAgo = { id: 'dpl_B', at: NOW - RELOAD_COOLDOWN_MS }
    expect(decide(salon({ lastReload: longAgo, idleMs: IDLE_MS }))).toEqual({
      reload: true,
      why: 'idle',
    })
  })

  it('una versión todavía más nueva no espera', () => {
    const other = { id: 'dpl_OLD', at: NOW - 5_000 }
    expect(decide(salon({ lastReload: other, idleMs: IDLE_MS }))).toEqual({
      reload: true,
      why: 'idle',
    })
  })

  it('si el navegador no deja anotar nada, la página tiene que llevar un rato cargada', () => {
    expect(decide(salon({ canRemember: false, pageAgeMs: 30_000, idleMs: IDLE_MS }))).toEqual({
      reload: false,
      why: 'cooldown',
    })
    expect(
      decide(salon({ canRemember: false, pageAgeMs: RELOAD_COOLDOWN_MS, idleMs: IDLE_MS })),
    ).toEqual({ reload: true, why: 'idle' })
  })
})

describe('cuándo volver a mirar', () => {
  it('justo cuando la pantalla va a quedar quieta', () => {
    const s = salon({ idleMs: 12_000 })
    expect(nextLook(s, decide(s))).toBe(IDLE_MS - 12_000 + 250)
  })

  it('escondida: cuando lleve el rato escondida, si eso llega antes', () => {
    const s = salon({ visible: false, hiddenMs: 15_000, idleMs: 2_000 })
    expect(nextLook(s, decide(s))).toBe(HIDDEN_MS - 15_000 + 250)
  })

  it('nunca antes de un segundo', () => {
    const s = salon({ idleMs: IDLE_MS - 10 })
    expect(nextLook(s, decide(s))).toBe(1_000)
  })

  it('con algo abierto o una pantalla que pidió que no: cada tanto', () => {
    const busy = salon({ busy: true })
    expect(nextLook(busy, decide(busy))).toBe(10_000)
    const held = salon({ held: true })
    expect(nextLook(held, decide(held))).toBe(10_000)
  })

  it('en el panel, sin red, recién recargado o al día: no hace falta (espera el próximo cambio o pregunta)', () => {
    for (const s of [
      panel({ idleMs: IDLE_MS * 3 }),
      salon({ online: false }),
      salon({ lastReload: { id: 'dpl_B', at: NOW - 1_000 } }),
      salon({ latest: 'dpl_A' }),
      salon({ latest: null }),
    ]) {
      expect(nextLook(s, decide(s))).toBeNull()
    }
  })

  it('si va a recargar, no hay nada que esperar', () => {
    const s = salon({ idleMs: IDLE_MS })
    expect(nextLook(s, decide(s))).toBeNull()
  })
})

describe('leer lo que llega', () => {
  it('el id del deployment: primero el de Next, después el de Vercel; lo vacío no cuenta', () => {
    expect(pickDeploymentId('dpl_next', 'dpl_vercel')).toBe('dpl_next')
    expect(pickDeploymentId(undefined, 'dpl_vercel')).toBe('dpl_vercel')
    // Sin protección de versiones, Next reemplaza su variable por `false` al compilar.
    expect(pickDeploymentId(false, 'dpl_vercel')).toBe('dpl_vercel')
    expect(pickDeploymentId('', '  ')).toBeNull()
    expect(pickDeploymentId(undefined, undefined)).toBeNull()
  })

  it('la respuesta de /api/version', () => {
    expect(parseVersion({ id: 'dpl_B' })).toBe('dpl_B')
    expect(parseVersion({ id: null })).toBeNull()
    expect(parseVersion({ id: '' })).toBeNull()
    expect(parseVersion({ id: 12 })).toBeNull()
    expect(parseVersion({ id: 'x'.repeat(201) })).toBeNull()
    expect(parseVersion('dpl_B')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })

  it('la marca de la última recarga; una marca rota es «no hubo»', () => {
    expect(parseReloadMark(JSON.stringify({ id: 'dpl_B', at: NOW }))).toEqual({
      id: 'dpl_B',
      at: NOW,
    })
    expect(parseReloadMark(null)).toBeNull()
    expect(parseReloadMark('')).toBeNull()
    expect(parseReloadMark('{no es json')).toBeNull()
    expect(parseReloadMark(JSON.stringify({ id: '', at: NOW }))).toBeNull()
    expect(parseReloadMark(JSON.stringify({ id: 'dpl_B', at: 'ayer' }))).toBeNull()
    expect(parseReloadMark(JSON.stringify(['dpl_B']))).toBeNull()
  })
})

describe('«ahora no»: lo que pide que no se recargue', () => {
  it('vale mientras alguien lo tenga pedido, y se suelta una sola vez', () => {
    expect(reloadHeld()).toBe(false)
    const print = holdReload()
    const bill = holdReload()
    expect(reloadHeld()).toBe(true)
    print()
    expect(reloadHeld()).toBe(true)
    // Soltar dos veces lo mismo no suelta lo de otro.
    print()
    expect(reloadHeld()).toBe(true)
    bill()
    expect(reloadHeld()).toBe(false)
    bill()
    expect(reloadHeld()).toBe(false)
  })
})
