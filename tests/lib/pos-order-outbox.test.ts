import { describe, expect, it } from 'vitest'
import { type Draft, EMPTY_DRAFT, type PricedLine } from '@/lib/pos/order/cart'
import {
  afterFailure,
  backoffDelay,
  classifySend,
  DRAFT_TTL_MS,
  ENTRY_WORD,
  entryDraftLines,
  entryOrderLines,
  entryStatus,
  entryTotalCents,
  entryUnits,
  isDisposable,
  makeEntry,
  NOTHING_STORED,
  nextSend,
  type OutboxEntry,
  restoreOrder,
  retryNow,
  STALE_AFTER_MS,
  serializeOrder,
  storageKey,
} from '@/lib/pos/order/outbox'

const NOW = Date.parse('2026-11-13T01:00:00.000Z')

const priced = (menu_item_id: string, quantity: number, unit_cents: number): PricedLine => ({
  line: {
    key: `l-${menu_item_id}`,
    menu_item_id,
    quantity,
    option_ids: ['opt-1'],
    notes: 'sin sal',
  },
  name: `Producto ${menu_item_id}`,
  unit_cents,
  total_cents: unit_cents * quantity,
  modifiers: [{ id: 'opt-1', label: 'Jugoso', delta_cents: 0 }],
  missing: false,
  sold_out: false,
})

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  ...makeEntry({
    key: 'clave-de-la-tanda',
    lines: [priced('burger', 2, 1_550_000), priced('mojito', 3, 900_000)],
    fire: true,
    course: 2,
    now: NOW,
  }),
  ...over,
})

const draft: Draft = {
  key: 'clave-del-borrador',
  lines: [{ key: 'l1', menu_item_id: 'burger', quantity: 2, option_ids: [], notes: null }],
}

describe('una tanda en la bandeja de salida', () => {
  it('guarda cómo se veía al mandarla: nombres, precios y aclaraciones', () => {
    const e = entry()
    expect(e).toMatchObject({ key: 'clave-de-la-tanda', fire: true, course: 2, attempts: 0 })
    expect(e.lines[0]).toEqual({
      menu_item_id: 'burger',
      quantity: 2,
      option_ids: ['opt-1'],
      notes: 'sin sal',
      name: 'Producto burger',
      unit_cents: 1_550_000,
      modifiers: [{ id: 'opt-1', label: 'Jugoso', delta_cents: 0 }],
    })
    expect(entryUnits(e)).toBe(5)
    expect(entryTotalCents(e)).toBe(5_800_000)
  })

  it('al servidor viaja solo lo que pide; al borrador vuelve lo mismo', () => {
    const wire = { menu_item_id: 'burger', quantity: 2, option_ids: ['opt-1'], notes: 'sin sal' }
    expect(entryOrderLines(entry())[0]).toEqual(wire)
    expect(entryDraftLines(entry())[0]).toEqual(wire)
  })
})

describe('guardar y leer', () => {
  it('cada mesa abierta tiene su propia entrada', () => {
    expect(storageKey('abc')).toBe('hub:pos:order:abc')
  })

  it('ida y vuelta: el borrador y lo que estaba por enviarse', () => {
    const raw = serializeOrder({ draft, outbox: [entry()], label: 'Mesa 12' }, NOW)
    const back = restoreOrder(raw, NOW + 5_000)
    expect(back.draft).toEqual(draft)
    expect(back.outbox).toHaveLength(1)
    expect(back.outbox[0]).toMatchObject({ key: 'clave-de-la-tanda', course: 2, fire: true })
    // Con el nombre de la mesa: si la tanda sale desde otra pantalla, se puede decir de cuál era.
    expect(back.label).toBe('Mesa 12')
    expect(restoreOrder(serializeOrder({ draft, outbox: [] }, NOW), NOW).label).toBeNull()
  })

  it('sin nada que guardar, se borra la entrada', () => {
    expect(serializeOrder({ draft: EMPTY_DRAFT, outbox: [] }, NOW)).toBeNull()
    expect(serializeOrder({ draft, outbox: [] }, NOW)).not.toBeNull()
    expect(serializeOrder({ draft: EMPTY_DRAFT, outbox: [entry()] }, NOW)).not.toBeNull()
  })

  it('lo que quedó a medias vuelve listo para intentar ya, con sus intentos contados', () => {
    const waiting = entry({ attempts: 4, lastFailure: 'network', nextAttemptAt: NOW + 30_000 })
    const back = restoreOrder(
      serializeOrder({ draft: EMPTY_DRAFT, outbox: [waiting] }, NOW),
      NOW + 1,
    )
    expect(back.outbox[0]).toMatchObject({ attempts: 4, nextAttemptAt: NOW + 1 })
  })

  it('un borrador de anoche no se ofrece; una tanda sin enviar no se descarta nunca sola', () => {
    const raw = serializeOrder({ draft, outbox: [entry()] }, NOW)
    const later = restoreOrder(raw, NOW + DRAFT_TTL_MS + 1)
    expect(later.draft).toEqual(EMPTY_DRAFT)
    expect(later.outbox).toHaveLength(1)
  })

  it('tolera lo que venga: vacío, roto, de otra versión o con datos que no cierran', () => {
    expect(restoreOrder(null, NOW)).toBe(NOTHING_STORED)
    expect(restoreOrder('', NOW)).toBe(NOTHING_STORED)
    expect(restoreOrder('{esto no es json', NOW)).toBe(NOTHING_STORED)
    expect(
      restoreOrder(JSON.stringify({ v: 99, savedAt: NOW, draft: null, outbox: [] }), NOW),
    ).toBe(NOTHING_STORED)
    const bad = JSON.stringify({
      v: 1,
      savedAt: NOW,
      draft: { key: 'clave-larga', lines: [{ key: 'l1', menu_item_id: 'x', quantity: 0 }] },
      outbox: [],
    })
    expect(restoreOrder(bad, NOW)).toBe(NOTHING_STORED)
  })

  it('lo guardado de otra mesa se limpia solo si es viejo y no quedó nada sin enviar', () => {
    const onlyDraft = serializeOrder({ draft, outbox: [] }, NOW)
    expect(isDisposable(onlyDraft, NOW + 60_000)).toBe(false)
    expect(isDisposable(onlyDraft, NOW + STALE_AFTER_MS + 1)).toBe(true)
    const unsent = serializeOrder({ draft: EMPTY_DRAFT, outbox: [entry()] }, NOW)
    expect(isDisposable(unsent, NOW + STALE_AFTER_MS * 10)).toBe(false)
    expect(isDisposable('basura', NOW)).toBe(true)
    expect(isDisposable(null, NOW)).toBe(true)
  })
})

describe('qué respuesta es «todavía no» y cuál es «así no»', () => {
  it('llegó: listo', () => {
    expect(classifySend({ ok: true })).toEqual({ kind: 'sent' })
  })

  it('la llamada no volvió (sin señal, tiempo agotado): se reintenta sola', () => {
    expect(classifySend(null)).toEqual({ kind: 'retry', failure: 'network', message: null })
  })

  it('un error pasajero del servidor o la sesión vencida: se reintenta con la misma clave', () => {
    expect(classifySend({ ok: false, code: 'unknown', message: 'No se pudo completar.' })).toEqual({
      kind: 'retry',
      failure: 'server',
      message: 'No se pudo completar.',
    })
    expect(
      classifySend({ ok: false, code: 'unauthenticated', message: 'Volvé a entrar.' }).kind,
    ).toBe('retry')
    expect(classifySend({ ok: false, message: 'sin código' }).kind).toBe('retry')
  })

  it('lo que no va a entrar nunca así vuelve al borrador con el motivo', () => {
    for (const code of [
      'item_sold_out',
      'item_not_available',
      'option_not_available',
      'session_not_open',
      'session_not_found',
      'invalid',
      'forbidden',
      'disabled',
      'order_too_long',
      'invalid_quantity',
      'too_many_options',
      'empty_order',
    ]) {
      expect(classifySend({ ok: false, code, message: 'motivo' })).toEqual({
        kind: 'reject',
        code,
        message: 'motivo',
      })
    }
  })
})

describe('reintentos', () => {
  it('espera cada vez más: 1, 2, 4, 8, 15 segundos y después cada 30', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 40].map(backoffDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
    ])
    expect(backoffDelay(0)).toBe(1_000)
  })

  it('un intento fallido cuenta, guarda el motivo y agenda el siguiente', () => {
    const once = afterFailure(entry(), { kind: 'retry', failure: 'network', message: null }, NOW)
    expect(once).toMatchObject({ attempts: 1, lastFailure: 'network', nextAttemptAt: NOW + 1_000 })
    const twice = afterFailure(
      once,
      { kind: 'retry', failure: 'server', message: 'No se pudo completar.' },
      NOW + 1_000,
    )
    expect(twice).toMatchObject({
      attempts: 2,
      lastFailure: 'server',
      lastError: 'No se pudo completar.',
      nextAttemptAt: NOW + 3_000,
    })
    // La clave no cambia nunca: es lo que hace que reintentar no duplique.
    expect(twice.key).toBe(entry().key)
    expect(twice.lines).toEqual(entry().lines)
  })

  it('salen de a una y en orden: la segunda espera a la primera', () => {
    const first = entry({ key: 'primera-tanda', nextAttemptAt: NOW + 4_000 })
    const second = entry({ key: 'segunda-tanda', nextAttemptAt: NOW })
    const state = { now: NOW, online: true, inFlight: false }
    expect(nextSend([first, second], state)).toEqual({ kind: 'wait', ms: 4_000 })
    expect(nextSend([first, second], { ...state, now: NOW + 4_000 })).toEqual({
      kind: 'send',
      entry: first,
    })
  })

  it('no manda nada sin red, con otra viajando o con la bandeja vacía', () => {
    const state = { now: NOW, online: true, inFlight: false }
    expect(nextSend([], state)).toEqual({ kind: 'idle' })
    expect(nextSend([entry()], { ...state, online: false })).toEqual({ kind: 'idle' })
    expect(nextSend([entry()], { ...state, inFlight: true })).toEqual({ kind: 'idle' })
    expect(nextSend([entry()], state).kind).toBe('send')
  })

  it('cuando vuelve la señal, la que esperaba sale ya', () => {
    const waiting = entry({ attempts: 5, nextAttemptAt: NOW + 30_000 })
    const [ready] = retryNow([waiting], NOW)
    expect(ready).toMatchObject({ attempts: 5, nextAttemptAt: NOW })
    expect(
      nextSend(retryNow([waiting], NOW), { now: NOW, online: true, inFlight: false }).kind,
    ).toBe('send')
  })
})

describe('qué dice la tanda mientras no llega', () => {
  it('enviando, sin señal o reintentando', () => {
    expect(entryStatus(entry(), true)).toBe('sending')
    expect(entryStatus(entry(), false)).toBe('offline')
    expect(entryStatus(entry({ attempts: 2, lastFailure: 'network' }), true)).toBe('offline')
    expect(entryStatus(entry({ attempts: 1, lastFailure: 'server' }), true)).toBe('retrying')
    expect(ENTRY_WORD.offline).toBe('Sin señal: se envía sola cuando vuelva')
    expect(ENTRY_WORD.sending).toBe('Enviando…')
  })
})
