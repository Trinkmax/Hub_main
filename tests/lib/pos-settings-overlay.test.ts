// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  EMPTY_OVERLAY,
  overlayBusy,
  overlayDrop,
  overlayRead,
  overlaySaving,
  overlaySettle,
  overlayStart,
  overlaySync,
} from '@/lib/pos/settings/overlay'

/**
 * Lo que la persona acaba de tocar se ve al instante, encima de lo último leído. Los relojes
 * (`savedAt`, `loadedAt`) son los del servidor: una lectura posterior al guardado ya lo trae.
 */

const KEY = 'ajuste:creditSurchargeBp'

describe('mientras guarda', () => {
  it('lo tocado se ve ya, marcado como guardando', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    expect(overlayRead(overlay, KEY, 1000)).toBe(1250)
    expect(overlaySaving(overlay, KEY)).toBe(true)
    expect(overlayBusy(overlay)).toBe(true)
  })

  it('lo que no se tocó muestra lo leído', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    expect(overlayRead(overlay, 'ajuste:transferAlias', 'hub.bar')).toBe('hub.bar')
    expect(overlaySaving(overlay, 'ajuste:transferAlias')).toBe(false)
  })

  it('un valor vacío anotado no se confunde con «no hay nada anotado»', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [['ajuste:transferAlias', null]])
    expect(overlayRead(overlay, 'ajuste:transferAlias', 'hub.bar')).toBeNull()
  })

  it('un cambio posterior sobre el mismo dato reemplaza al anterior', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlayStart(overlay, 2, [[KEY, 1500]])
    expect(overlayRead(overlay, KEY, 1000)).toBe(1500)
    // El primer pedido termina después: ya no tiene nada suyo que tocar.
    overlay = overlaySettle(overlay, 1, { savedAt: 50, loadedAt: 10 })
    expect(overlayRead(overlay, KEY, 1000)).toBe(1500)
    expect(overlaySaving(overlay, KEY)).toBe(true)
  })

  it('no toca el objeto que recibe', () => {
    const before = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlayStart(before, 2, [[KEY, 1500]])
    expect(overlayRead(before, KEY, 1000)).toBe(1250)
    expect(EMPTY_OVERLAY).toEqual({})
  })
})

describe('el servidor dijo que sí', () => {
  it('deja de estar guardando y se queda hasta que una lectura lo traiga', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlaySettle(overlay, 1, { savedAt: 200, loadedAt: 100 })
    expect(overlaySaving(overlay, KEY)).toBe(false)
    expect(overlayBusy(overlay)).toBe(false)
    // La pantalla sigue con la lectura vieja (1000): se muestra lo guardado.
    expect(overlayRead(overlay, KEY, 1000)).toBe(1250)
  })

  it('si la lectura que hay ya es posterior al guardado, la marca sobra', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlaySettle(overlay, 1, { savedAt: 200, loadedAt: 200 })
    expect(overlay).toEqual({})
  })

  it('se queda con lo que el servidor escribió de verdad', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [['sucursal:b1:name', '  Cerro ']])
    overlay = overlaySettle(overlay, 1, {
      savedAt: 200,
      loadedAt: 100,
      values: { 'sucursal:b1:name': 'Cerro' },
    })
    expect(overlayRead(overlay, 'sucursal:b1:name', 'Cero')).toBe('Cerro')
  })

  it('llega una lectura posterior: manda la base', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlaySettle(overlay, 1, { savedAt: 200, loadedAt: 100 })
    expect(overlaySync(overlay, 150)).toBe(overlay)
    expect(overlaySync(overlay, 200)).toEqual({})
  })

  it('una lectura nueva no se lleva lo que todavía se está guardando', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    expect(overlaySync(overlay, 999_999)).toBe(overlay)
  })
})

describe('el servidor dijo que no', () => {
  it('lo suyo se va y vuelve a verse lo leído', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlayDrop(overlay, 1)
    expect(overlayRead(overlay, KEY, 1000)).toBe(1000)
    expect(overlay).toEqual({})
  })

  it('lo de otro pedido no se toca', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlayStart(overlay, 2, [['ajuste:voidNeedsApproval', false]])
    overlay = overlayDrop(overlay, 1)
    expect(overlayRead(overlay, 'ajuste:voidNeedsApproval', true)).toBe(false)
    expect(overlayRead(overlay, KEY, 1000)).toBe(1000)
  })

  it('si otra persona lo cambió, se muestra cómo quedó hasta la próxima lectura', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlayDrop(overlay, 1, { at: 300, loadedAt: 100, values: { [KEY]: 800 } })
    // La pantalla tiene leído 1000, pero la verdad de ahora es 800.
    expect(overlayRead(overlay, KEY, 1000)).toBe(800)
    expect(overlaySaving(overlay, KEY)).toBe(false)
    expect(overlaySync(overlay, 300)).toEqual({})
  })

  it('si la lectura que hay ya es posterior, alcanza con lo leído', () => {
    let overlay = overlayStart(EMPTY_OVERLAY, 1, [[KEY, 1250]])
    overlay = overlayDrop(overlay, 1, { at: 300, loadedAt: 300, values: { [KEY]: 800 } })
    expect(overlay).toEqual({})
  })
})
