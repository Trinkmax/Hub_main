// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CARTA_CHECK_INTERVAL_MS,
  CARTA_CHECK_STUCK_MS,
  CARTA_MAX_AGE_MS,
  CARTA_MIN_CHECK_GAP_MS,
  CARTA_REFRESH_GRACE_MS,
  CARTA_SCHEDULE_MARGIN_MS,
  type CartaCheckGate,
  type CartaRefreshInput,
  cartaScheduleDue,
  cartaScheduleDueAt,
  decideCartaRefresh,
  parseMenuRev,
  readCartaRevAnswer,
  shouldCheckCarta,
} from '@/lib/menu/freshness'

/**
 * La carta siempre al día (docs/features/carta-al-dia.md): cuándo una carta abierta en el celular
 * se vuelve a pedir. Lo que se fija: refresca solo si la versión es más nueva, nunca entra en bucle
 * con una respuesta vacía o rara, la red de seguridad de 12 h no salta sin señal ni por un reloj
 * corrido, y los eventos que llegan juntos al volver a la pestaña son una sola pregunta.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.parse('2026-11-15T20:00:00-03:00')

const input = (over: Partial<CartaRefreshInput> = {}): CartaRefreshInput => ({
  renderedRev: 10,
  latestRev: 10,
  renderedAt: T0,
  seenAt: T0,
  now: T0 + 5 * MIN,
  ...over,
})

describe('constantes', () => {
  it('chequea cada 4 min, la red de seguridad es de 12 h, la gracia de 6 s y el mínimo de 15 s', () => {
    expect(CARTA_CHECK_INTERVAL_MS).toBe(4 * MIN)
    expect(CARTA_MAX_AGE_MS).toBe(12 * HOUR)
    expect(CARTA_REFRESH_GRACE_MS).toBe(6_000)
    expect(CARTA_MIN_CHECK_GAP_MS).toBe(15_000)
  })
})

describe('decideCartaRefresh — con la versión a mano', () => {
  it('una versión más nueva refresca', () => {
    expect(decideCartaRefresh(input({ latestRev: 11 }))).toBe('refresh')
    expect(decideCartaRefresh(input({ latestRev: 250 }))).toBe('refresh')
  })

  it('la misma versión no refresca, aunque la carta lleve días abierta: el número manda', () => {
    expect(decideCartaRefresh(input())).toBe('stay')
    expect(decideCartaRefresh(input({ now: T0 + 72 * HOUR }))).toBe('stay')
  })

  it('una versión menor (réplica atrasada) nunca refresca: si no, volvería a pedirla para siempre', () => {
    expect(decideCartaRefresh(input({ latestRev: 9 }))).toBe('stay')
    expect(decideCartaRefresh(input({ latestRev: 0 }))).toBe('stay')
  })

  it('un render que no pudo leer su número (0 o NaN) se refresca una vez con el número nuevo', () => {
    expect(decideCartaRefresh(input({ renderedRev: 0, latestRev: 7 }))).toBe('refresh')
    expect(decideCartaRefresh(input({ renderedRev: Number.NaN, latestRev: 7 }))).toBe('refresh')
    // El componente deja 7 de base aunque el render nuevo vuelva con 0: la misma respuesta ya no refresca.
    expect(decideCartaRefresh(input({ renderedRev: 7, latestRev: 7 }))).toBe('stay')
  })

  it('un bar sin cambios todavía (0 y 0) no refresca', () => {
    expect(decideCartaRefresh(input({ renderedRev: 0, latestRev: 0 }))).toBe('stay')
  })
})

describe('decideCartaRefresh — sin la versión (red de seguridad)', () => {
  it('con la consulta fallada y la carta fresca, se queda', () => {
    expect(decideCartaRefresh(input({ latestRev: null }))).toBe('stay')
    expect(decideCartaRefresh(input({ latestRev: null, now: T0 + 11 * HOUR }))).toBe('stay')
  })

  it('con la consulta fallada y la carta de más de 12 h, refresca igual', () => {
    expect(decideCartaRefresh(input({ latestRev: null, now: T0 + 12 * HOUR + 1 }))).toBe('refresh')
    expect(decideCartaRefresh(input({ latestRev: null, now: T0 + 3 * 24 * HOUR }))).toBe('refresh')
  })

  it('justo 12 h todavía no: tiene que tener MÁS', () => {
    expect(decideCartaRefresh(input({ latestRev: null, now: T0 + 12 * HOUR }))).toBe('stay')
  })

  it('NaN, negativo o fraccionario cuentan como «no se sabe», nunca como cambio', () => {
    for (const latestRev of [Number.NaN, -1, 10.5, Number.POSITIVE_INFINITY]) {
      expect(decideCartaRefresh(input({ latestRev }))).toBe('stay')
      expect(decideCartaRefresh(input({ latestRev, now: T0 + 13 * HOUR }))).toBe('refresh')
    }
  })

  it('sin señal nunca refresca, ni por edad: la recarga terminaría en una página de error', () => {
    expect(
      decideCartaRefresh(input({ latestRev: null, unreachable: true, now: T0 + 48 * HOUR })),
    ).toBe('stay')
  })

  it('después de una recarga por edad (el celular la marca vista) no se repite: no hay bucle', () => {
    const now = T0 + 13 * HOUR
    expect(decideCartaRefresh(input({ latestRev: null, now }))).toBe('refresh')
    // El componente pone seenAt = ahora al pedir la recarga, llegue o no el render nuevo.
    expect(decideCartaRefresh(input({ latestRev: null, seenAt: now, now: now + 4 * MIN }))).toBe(
      'stay',
    )
    expect(
      decideCartaRefresh(input({ latestRev: null, seenAt: now, now: now + 12 * HOUR + 1 })),
    ).toBe('refresh')
  })

  it('con el reloj del celular 13 h adelantado, la red de seguridad no salta apenas abre', () => {
    const skew = 13 * HOUR
    const seenAt = T0 + skew
    expect(decideCartaRefresh(input({ latestRev: null, seenAt, now: seenAt + 5 * MIN }))).toBe(
      'stay',
    )
    // Pasadas 12 h de verdad (con su propio reloj), sí.
    expect(
      decideCartaRefresh(input({ latestRev: null, seenAt, now: seenAt + 12 * HOUR + 1 })),
    ).toBe('refresh')
  })

  it('con el reloj del celular atrasado, la red llega más tarde, nunca de más', () => {
    const seenAt = T0 - 2 * HOUR
    expect(decideCartaRefresh(input({ latestRev: null, seenAt, now: seenAt + 13 * HOUR }))).toBe(
      'stay',
    )
    expect(decideCartaRefresh(input({ latestRev: null, seenAt, now: seenAt + 15 * HOUR }))).toBe(
      'refresh',
    )
  })

  it('sin seenAt cuenta desde el render del servidor', () => {
    expect(decideCartaRefresh(input({ latestRev: null, seenAt: null, now: T0 + 13 * HOUR }))).toBe(
      'refresh',
    )
    expect(
      decideCartaRefresh(input({ latestRev: null, seenAt: undefined, now: T0 + 2 * HOUR })),
    ).toBe('stay')
  })

  it('fechas inválidas no refrescan', () => {
    expect(
      decideCartaRefresh(
        input({ latestRev: null, renderedAt: Number.NaN, seenAt: null, now: T0 + 13 * HOUR }),
      ),
    ).toBe('stay')
    expect(decideCartaRefresh(input({ latestRev: null, now: Number.NaN }))).toBe('stay')
  })

  it('respeta otra edad máxima, y una inválida vuelve a las 12 h', () => {
    expect(decideCartaRefresh(input({ latestRev: null, maxAgeMs: HOUR, now: T0 + 2 * HOUR }))).toBe(
      'refresh',
    )
    for (const maxAgeMs of [0, -5, Number.NaN]) {
      expect(decideCartaRefresh(input({ latestRev: null, maxAgeMs, now: T0 + 2 * HOUR }))).toBe(
        'stay',
      )
    }
  })
})

describe('parseMenuRev', () => {
  it('acepta enteros de 0 en adelante, como número o como texto (bigint)', () => {
    expect(parseMenuRev(0)).toBe(0)
    expect(parseMenuRev(42)).toBe(42)
    expect(parseMenuRev('42')).toBe(42)
    expect(parseMenuRev(' 7 ')).toBe(7)
  })

  it('cualquier otra cosa es null', () => {
    for (const value of [
      null,
      undefined,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      '12abc',
      '-3',
      '1e3',
      '99999999999999999999',
      {},
      [],
      true,
    ]) {
      expect(parseMenuRev(value)).toBeNull()
    }
  })
})

describe('readCartaRevAnswer — lo que contestó carta_menu_rev', () => {
  it('200 con un número es la versión', () => {
    expect(readCartaRevAnswer({ data: 12, error: null, status: 200 })).toEqual({
      kind: 'rev',
      rev: 12,
    })
    expect(readCartaRevAnswer({ data: '12', error: null, status: 200 })).toEqual({
      kind: 'rev',
      rev: 12,
    })
  })

  it('sin red o cortada por tiempo (supabase-js devuelve status 0) es «no se llegó»', () => {
    expect(
      readCartaRevAnswer({
        data: null,
        error: { message: 'TypeError: Failed to fetch' },
        status: 0,
      }),
    ).toEqual({ kind: 'unreachable' })
  })

  it('Supabase con problemas (5xx) también: recargar traería una carta vacía o un error', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(readCartaRevAnswer({ data: null, error: { message: 'x' }, status })).toEqual({
        kind: 'unreachable',
      })
    }
  })

  it('un error del servidor (4xx) es «rechazada»: ahí sí vale la red de seguridad', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(readCartaRevAnswer({ data: null, error: { code: '42501' }, status })).toEqual({
        kind: 'rejected',
      })
    }
  })

  it('una respuesta que no es una versión también es «rechazada»', () => {
    expect(readCartaRevAnswer({ data: null, error: null, status: 200 })).toEqual({
      kind: 'rejected',
    })
    expect(readCartaRevAnswer({ data: { rev: 3 }, error: null, status: 200 })).toEqual({
      kind: 'rejected',
    })
  })
})

describe('shouldCheckCarta — una sola pregunta por vuelta a la pestaña', () => {
  const gate = (over: Partial<CartaCheckGate> = {}): CartaCheckGate => ({
    now: T0,
    hidden: false,
    offline: false,
    refreshing: false,
    inFlightSince: null,
    lastAnswerAt: null,
    ...over,
  })

  it('la primera vez pregunta', () => {
    expect(shouldCheckCarta(gate())).toBe(true)
  })

  it('con la pestaña oculta, sin señal o con un refresh en camino, no', () => {
    expect(shouldCheckCarta(gate({ hidden: true }))).toBe(false)
    expect(shouldCheckCarta(gate({ offline: true }))).toBe(false)
    expect(shouldCheckCarta(gate({ refreshing: true }))).toBe(false)
  })

  it('visible + foco + pageshow juntos: después de una respuesta, 15 s sin preguntar', () => {
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 - 200 }))).toBe(false)
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 - 14_999 }))).toBe(false)
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 - 15_000 }))).toBe(true)
  })

  it('con una pregunta en vuelo no sale otra, salvo que lleve 20 s colgada', () => {
    expect(shouldCheckCarta(gate({ inFlightSince: T0 - 1_000 }))).toBe(false)
    expect(shouldCheckCarta(gate({ inFlightSince: T0 - CARTA_CHECK_STUCK_MS }))).toBe(true)
  })

  it('un intento sin señal no cuenta: cuando vuelve la señal se pregunta al toque', () => {
    // lastAnswerAt solo se marca con respuesta del servidor; el intento fallido no lo toca.
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 - 10 * MIN }))).toBe(true)
  })

  it('si el reloj del celular fue para atrás, la marca vieja no bloquea', () => {
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 + HOUR }))).toBe(true)
    expect(shouldCheckCarta(gate({ inFlightSince: T0 + HOUR }))).toBe(true)
  })

  it('respeta otros mínimos', () => {
    expect(shouldCheckCarta(gate({ lastAnswerAt: T0 - 2_000, minGapMs: 1_000 }))).toBe(true)
    expect(shouldCheckCarta(gate({ inFlightSince: T0 - 2_000, stuckMs: 1_000 }))).toBe(true)
  })
})

describe('los rubros con horario', () => {
  it('vence cuando lo vio el celular + lo que faltaba + el margen', () => {
    expect(CARTA_SCHEDULE_MARGIN_MS).toBe(5_000)
    const dueAt = cartaScheduleDueAt(20 * MIN, T0)
    expect(dueAt).toBe(T0 + 20 * MIN + CARTA_SCHEDULE_MARGIN_MS)
    expect(cartaScheduleDue(dueAt, T0 + 20 * MIN)).toBe(false)
    expect(cartaScheduleDue(dueAt, T0 + 20 * MIN + CARTA_SCHEDULE_MARGIN_MS)).toBe(true)
    // El celular estuvo guardado toda la tarde: al volver, ya pasó.
    expect(cartaScheduleDue(dueAt, T0 + 6 * HOUR)).toBe(true)
  })

  it('sin horarios (o con un dato roto) no vence nunca', () => {
    expect(cartaScheduleDueAt(null, T0)).toBeNull()
    expect(cartaScheduleDueAt(undefined, T0)).toBeNull()
    expect(cartaScheduleDueAt(Number.NaN, T0)).toBeNull()
    expect(cartaScheduleDueAt(-1, T0)).toBeNull()
    // Un cambio nunca está a más de un día: la medianoche cambia el día.
    expect(cartaScheduleDueAt(26 * HOUR, T0)).toBeNull()
    expect(cartaScheduleDue(null, T0 + 99 * HOUR)).toBe(false)
  })

  it('pasada la hora, la carta se vuelve a pedir aunque nadie la haya editado', () => {
    expect(decideCartaRefresh(input({ scheduleDue: true }))).toBe('refresh')
    // También si la versión no se pudo leer pero el servidor contestó.
    expect(decideCartaRefresh(input({ latestRev: null, scheduleDue: true }))).toBe('refresh')
    expect(decideCartaRefresh(input({ scheduleDue: false }))).toBe('stay')
  })

  it('sin señal tampoco: la recarga terminaría en una página de error', () => {
    expect(
      decideCartaRefresh(input({ latestRev: null, unreachable: true, scheduleDue: true })),
    ).toBe('stay')
  })

  it('con la hora pasada no se espera el mínimo entre preguntas', () => {
    const gate: CartaCheckGate = {
      now: T0 + 20_000,
      hidden: false,
      offline: false,
      refreshing: false,
      inFlightSince: null,
      lastAnswerAt: T0 + 15_000,
    }
    expect(shouldCheckCarta(gate)).toBe(false)
    expect(shouldCheckCarta({ ...gate, minGapMs: 0 })).toBe(true)
    // Pero sí se respeta lo demás: escondida, sin red o con un pedido en camino no se pregunta.
    expect(shouldCheckCarta({ ...gate, minGapMs: 0, hidden: true })).toBe(false)
    expect(shouldCheckCarta({ ...gate, minGapMs: 0, refreshing: true })).toBe(false)
    expect(shouldCheckCarta({ ...gate, minGapMs: 0, inFlightSince: T0 + 19_000 })).toBe(false)
  })
})
