import { describe, expect, it } from 'vitest'
import {
  OWNER_ROOMS,
  otherRooms,
  ROOM_KEYS,
  ROOMS,
  readTab,
  roomHref,
  roomOfTab,
  TAB_VALUES,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/rooms'

/**
 * Las habitaciones de Ajustes. Unos cien textos de la app mandan a «Ajustes › …» con un
 * `?tab=`: las nueve claves de siempre tienen que seguir cayendo en lo que nombran. Lo único que
 * cambia es que `participes` abre «Medios de cobro» y que, sin clave, se ve la portada.
 */

const BASE = '/hub/administracion'

describe('las claves de ?tab=', () => {
  it('son las nueve de siempre, ni una más ni una menos', () => {
    expect([...TAB_VALUES].sort()).toEqual(
      [
        'accesos',
        'arca',
        'cajas',
        'ejercicio',
        'integridad',
        'medios',
        'participes',
        'puntos-de-venta',
        'sas',
      ].sort(),
    )
  })

  it('cada clave abre su habitación', () => {
    expect(roomOfTab('sas')).toBe('sas')
    expect(roomOfTab('arca')).toBe('arca')
    expect(roomOfTab('ejercicio')).toBe('ejercicio')
    expect(roomOfTab('accesos')).toBe('accesos')
    expect(roomOfTab('medios')).toBe('medios')
    expect(roomOfTab('cajas')).toBe('cajas')
    expect(roomOfTab('puntos-de-venta')).toBe('puntos-de-venta')
    expect(roomOfTab('integridad')).toBe('integridad')
  })

  it('«participes» (la pestaña «Plataformas» de antes) abre Medios de cobro', () => {
    expect(roomOfTab('participes')).toBe('medios')
    expect(readTab('participes')).toBe('participes')
  })

  it('sin clave, con una que no existe o vacía: la portada', () => {
    expect(roomOfTab(undefined)).toBeNull()
    expect(roomOfTab(null)).toBeNull()
    expect(roomOfTab('')).toBeNull()
    expect(roomOfTab('plataformas')).toBeNull()
    expect(roomOfTab('SAS')).toBeNull()
    expect(roomOfTab([])).toBeNull()
  })

  it('si la clave viene repetida, vale la primera', () => {
    expect(roomOfTab(['cajas', 'sas'])).toBe('cajas')
    expect(roomOfTab(['nada', 'sas'])).toBeNull()
  })
})

describe('las habitaciones', () => {
  it('son ocho: las seis del dueño (con su objeto en la portada) y las dos de la contadora', () => {
    expect(ROOM_KEYS).toHaveLength(8)
    expect([...OWNER_ROOMS]).toEqual([
      'accesos',
      'cajas',
      'medios',
      'sas',
      'puntos-de-venta',
      'arca',
    ])
    expect(ROOM_KEYS.filter((k) => ROOMS[k].audience === 'accountant')).toEqual([
      'ejercicio',
      'integridad',
    ])
  })

  it('se llaman como las nombra el resto de la app', () => {
    expect(ROOM_KEYS.map((k) => ROOMS[k].title)).toEqual([
      'Accesos',
      'Cajas y cuentas',
      'Medios de cobro',
      'Datos de la SAS',
      'Puntos de venta',
      'ARCA',
      'Ejercicio',
      'Integridad',
    ])
  })

  it('cada una tiene su oración, y la clave de cada una vuelve a ella', () => {
    for (const key of ROOM_KEYS) {
      expect(ROOMS[key].description.length).toBeGreaterThan(20)
      expect(ROOMS[key].description.endsWith('.')).toBe(true)
      expect(roomOfTab(ROOMS[key].tab)).toBe(key)
    }
  })

  it('ningún texto habla de «en negro», «en blanco» ni de ganancia', () => {
    const text = ROOM_KEYS.map((k) => `${ROOMS[k].title} ${ROOMS[k].description}`).join(' ')
    expect(text).not.toMatch(/en negro|en blanco|ganancia|ganaste/i)
  })
})

describe('los links', () => {
  it('a una habitación', () => {
    expect(roomHref(BASE, 'cajas')).toBe('/hub/administracion/ajustes?tab=cajas')
    expect(roomHref(BASE, 'puntos-de-venta')).toBe(
      '/hub/administracion/ajustes?tab=puntos-de-venta',
    )
  })

  it('con ancla: las reglas contables y las pruebas de ARCA', () => {
    expect(roomHref(BASE, 'ejercicio', { hash: 'reglas' })).toBe(
      '/hub/administracion/ajustes?tab=ejercicio#reglas',
    )
    expect(roomHref(BASE, 'arca', { hash: 'homologacion' })).toBe(
      '/hub/administracion/ajustes?tab=arca#homologacion',
    )
  })

  it('la lista de CUIT conserva su clave de siempre', () => {
    expect(roomHref(BASE, 'medios', { tab: 'participes', hash: 'cuit' })).toBe(
      '/hub/administracion/ajustes?tab=participes#cuit',
    )
  })

  it('una clave que no es de esa habitación no se usa', () => {
    expect(roomHref(BASE, 'cajas', { tab: 'participes' })).toBe(
      '/hub/administracion/ajustes?tab=cajas',
    )
  })

  it('«Otros ajustes»: las otras siete, en el orden de la portada', () => {
    expect(otherRooms('medios')).toEqual([
      'accesos',
      'cajas',
      'sas',
      'puntos-de-venta',
      'arca',
      'ejercicio',
      'integridad',
    ])
    for (const key of ROOM_KEYS) expect(otherRooms(key)).not.toContain(key)
  })
})
