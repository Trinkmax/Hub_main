import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTICE_PREFS,
  parseNoticePrefs,
  prefEvents,
  wantsNotice,
} from '@/lib/pos/notices/prefs'
import { itemsLabel, noticeText, noticeWhere } from '@/lib/pos/notices/text'
import { noticeEvent, type PosNotice, parseNotice } from '@/lib/pos/notices/types'

const notice = (over: Partial<PosNotice> = {}): PosNotice => ({
  id: 'n1',
  user_id: 'u1',
  session_id: 's1',
  kind: 'ready',
  station_id: 'barra',
  station_name: 'Barra',
  station_kind: 'drink',
  station_icon: '🍹',
  table_label: '12',
  alias: null,
  items: [
    { n: 'Mojito', q: 4 },
    { n: 'Stella', q: 2 },
  ],
  units: 6,
  created_at: '2026-11-27T01:00:00.000Z',
  ...over,
})

describe('cómo se dice un aviso de cocina', () => {
  it('listo: la mesa, de dónde se retira y qué es', () => {
    expect(noticeText(notice())).toMatchObject({
      title: 'Mesa 12 · para retirar',
      body: '🍹 Barra: 4 Mojito · 2 Stella',
      strong: true,
    })
  })

  it('en preparación: un aviso corto, no fuerte', () => {
    const text = noticeText(
      notice({
        kind: 'preparing',
        station_name: 'Cocina',
        station_kind: 'food',
        station_icon: '🍔',
      }),
    )
    expect(text.title).toBe('Mesa 12 · en preparación')
    expect(text.body).toBe('🍔 Cocina empezó: 4 Mojito · 2 Stella')
    expect(text.strong).toBe(false)
    expect(text.vibrate.length).toBe(1)
  })

  it('todavía no: corrige un «listo» que se volvió atrás', () => {
    const text = noticeText(notice({ kind: 'not_ready' }))
    expect(text.title).toBe('Mesa 12 · todavía no')
    expect(text.body).toContain('Barra')
    expect(text.strong).toBe(false)
  })

  it('el aviso nuevo de la misma mesa y estación reemplaza al anterior', () => {
    expect(noticeText(notice()).tag).toBe(noticeText(notice({ kind: 'preparing', id: 'n2' })).tag)
    expect(noticeText(notice()).tag).not.toBe(noticeText(notice({ station_id: 'cocina' })).tag)
    expect(noticeText(notice()).tag).not.toBe(noticeText(notice({ session_id: 's2' })).tag)
  })

  it('sin mesa manda el nombre; sin nada, «Tu pedido»', () => {
    expect(noticeWhere({ table_label: null, alias: 'Martín' })).toBe('Martín')
    expect(noticeWhere({ table_label: null, alias: null })).toBe('Tu pedido')
  })

  it('muchos productos: nombra cuatro y resume el resto en unidades', () => {
    const many = [1, 2, 3, 4, 5, 6].map((q) => ({ n: `P${q}`, q }))
    expect(itemsLabel(many)).toBe('1 P1 · 2 P2 · 3 P3 · 4 P4 · y 11 más')
    expect(itemsLabel([])).toBe('')
  })

  it('un nombre que arranca con número no se pega a la cantidad', () => {
    // «2 1/2 Pizza» se lee «dos y media»: son dos medias pizzas.
    expect(itemsLabel([{ n: '1/2 Pizza explosiva', q: 2 }])).toBe('2 × 1/2 Pizza explosiva')
    expect(
      itemsLabel([
        { n: '7up', q: 3 },
        { n: 'Mojito', q: 4 },
      ]),
    ).toBe('3 × 7up · 4 Mojito')
  })

  it('una estación sin dibujo toma el de su nombre o su tipo', () => {
    expect(noticeText(notice({ station_icon: null })).body.startsWith('🍹')).toBe(true)
    expect(
      noticeText(
        notice({ station_icon: null, station_name: 'Pizzeros', station_kind: 'food' }),
      ).body.startsWith('🍕'),
    ).toBe(true)
    expect(noticeText(notice({ items: [] })).body).toBe('🍹 Ya está en Barra.')
  })
})

describe('leer un aviso que llega de afuera', () => {
  it('toma lo que tiene forma de aviso', () => {
    const parsed = parseNotice({ ...notice(), extra: 'x' })
    expect(parsed).toMatchObject({ id: 'n1', kind: 'ready', units: 6 })
    expect(parsed?.items).toHaveLength(2)
  })

  it('lo que viene a medias se descarta: no hace sonar nada', () => {
    expect(parseNotice(null)).toBeNull()
    expect(parseNotice('aviso')).toBeNull()
    expect(parseNotice({ ...notice(), id: '' })).toBeNull()
    expect(parseNotice({ ...notice(), user_id: null })).toBeNull()
    expect(parseNotice({ ...notice(), kind: 'served' })).toBeNull()
  })

  it('los productos mal formados se saltean, el resto del aviso vale', () => {
    const parsed = parseNotice({
      ...notice(),
      items: [{ n: 'Mojito', q: 4 }, { n: 5 }, 'x'],
      units: 'seis',
    })
    expect(parsed?.items).toEqual([{ n: 'Mojito', q: 4 }])
    expect(parsed?.units).toBe(0)
  })
})

describe('de qué avisos se entera cada dispositivo', () => {
  it('de fábrica, de todos y con sonido', () => {
    expect(parseNoticePrefs(null)).toEqual(DEFAULT_NOTICE_PREFS)
    expect(parseNoticePrefs('no es json')).toEqual(DEFAULT_NOTICE_PREFS)
    expect(parseNoticePrefs('[]')).toEqual(DEFAULT_NOTICE_PREFS)
  })

  it('lo guardado manda; lo que falta queda de fábrica', () => {
    expect(parseNoticePrefs('{"preparing":false}')).toEqual({
      ready: true,
      preparing: false,
      sound: true,
    })
    expect(parseNoticePrefs('{"sound":"no"}')).toEqual(DEFAULT_NOTICE_PREFS)
  })

  it('«todavía no» va con «listo»: lo corrige', () => {
    expect(noticeEvent('not_ready')).toBe('ready')
    const onlyReady = { ready: true, preparing: false, sound: true }
    expect(wantsNotice(onlyReady, 'ready')).toBe(true)
    expect(wantsNotice(onlyReady, 'not_ready')).toBe(true)
    expect(wantsNotice(onlyReady, 'preparing')).toBe(false)
    expect(prefEvents(onlyReady)).toEqual(['ready'])
    expect(prefEvents({ ready: false, preparing: false, sound: true })).toEqual([])
  })
})
