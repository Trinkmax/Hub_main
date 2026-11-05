import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FotoPanel, FotoQrButton } from '@/components/administracion/foto-qr/foto-panel'
import { qrScanPlan, scanCanvasSize } from '@/components/administracion/foto-qr/read-qr'

/**
 * El panel de la foto: lo que se puede fijar sin un navegador. El circuito entero (el link, lo que baja
 * del celular, la lectura de una foto y de un PDF) se probó en Chrome de verdad: ver el informe de la
 * rama. Acá queda el orden en que se mira una imagen y lo que dibuja cada estado.
 */

const createUploadLink = vi.hoisted(() => vi.fn())
vi.mock('@/lib/accounting/actions/upload-links', () => ({ createUploadLink }))
vi.mock('@/lib/supabase/browser', () => ({ createClient: () => ({}) }))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccountingOptional: () => ({ readOnly: false }),
}))

const file = (name: string, type = 'image/jpeg', size = 2048) =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1 })

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node)
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('dónde se busca el QR en una imagen', () => {
  const plan = qrScanPlan()

  it('primero la imagen entera, en dos tamaños', () => {
    expect(plan[0]).toEqual({ x: 0, y: 0, w: 1, h: 1, side: 1600 })
    expect(plan[1]).toEqual({ x: 0, y: 0, w: 1, h: 1, side: 1000 })
  })

  it('después los recortes, con el de abajo a la izquierda adelante: ahí lo pone casi todo el mundo', () => {
    const firstCrop = plan[2]
    expect(firstCrop?.x).toBe(0)
    expect((firstCrop?.y ?? 0) + (firstCrop?.h ?? 0)).toBeCloseTo(1)
  })

  it('ningún recorte se sale de la imagen', () => {
    for (const step of plan) {
      expect(step.x).toBeGreaterThanOrEqual(0)
      expect(step.y).toBeGreaterThanOrEqual(0)
      expect(step.x + step.w).toBeLessThanOrEqual(1.000_001)
      expect(step.y + step.h).toBeLessThanOrEqual(1.000_001)
    }
  })

  it('un QR chico entra entero en algún recorte, caiga donde caiga', () => {
    // Un QR de 2,5 cm en una hoja A4 mide menos del 12 % de su ancho.
    const size = 0.12
    const crops = plan.filter((step) => step.w < 1)
    for (let x = 0; x <= 1 - size; x += 0.02) {
      for (let y = 0; y <= 1 - size; y += 0.02) {
        const inside = crops.some(
          (c) => x >= c.x && y >= c.y && x + size <= c.x + c.w && y + size <= c.y + c.h,
        )
        expect(inside, `${x.toFixed(2)}, ${y.toFixed(2)}`).toBe(true)
      }
    }
  })

  it('los recortes se leen agrandados: una foto de 1600 px da 2 px por módulo y no alcanza', () => {
    const smallest = Math.min(...plan.filter((step) => step.w < 1).map((step) => step.w))
    const size = scanCanvasSize(1600 * smallest, 1100 * smallest, 1600)
    expect(size.width / (1600 * smallest)).toBeGreaterThanOrEqual(2)
  })

  it('el lienzo no deforma ni queda en cero', () => {
    expect(scanCanvasSize(800, 400, 1600)).toEqual({ width: 1600, height: 800 })
    expect(scanCanvasSize(400, 800, 1000)).toEqual({ width: 500, height: 1000 })
    expect(scanCanvasSize(0, 0, 1000).width).toBeGreaterThanOrEqual(1)
    expect(scanCanvasSize(0, 0, 1000).height).toBeGreaterThanOrEqual(1)
  })
})

describe('el panel, sin foto', () => {
  const panel = (extra: Partial<Parameters<typeof FotoPanel>[0]> = {}) =>
    html(
      createElement(FotoPanel, {
        tenantSlug: 'hub',
        files: [],
        onFiles: () => {},
        onRead: () => {},
        ...extra,
      }),
    )

  it('dice qué hacer, y en el celular cambia el QR por «Sacar la foto»', () => {
    const out = panel()
    const read = text(out)
    expect(read).toContain('Escanealo y sacale la foto')
    expect(read).toContain('O arrastrá la foto o el PDF acá.')
    expect(read).toContain('Si es factura electrónica, se completa sola.')
    expect(read).toContain('Sacar la foto')
    expect(read).toContain('Elegir un archivo')
    expect(out).toContain('capture="environment"')
    expect(out.split('accept="image/*,application/pdf"').length - 1).toBe(2)
  })

  it('sin `onRead` no promete que se completa sola', () => {
    expect(text(panel({ onRead: undefined }))).not.toContain('se completa sola')
  })

  it('del lado del servidor no se abre ningún link', () => {
    panel()
    expect(createUploadLink).not.toHaveBeenCalled()
  })

  it('tiene nombre para el lector', () => {
    expect(panel()).toContain('aria-label="Foto del comprobante"')
  })
})

describe('el panel, con foto', () => {
  const panel = (files: File[]) =>
    html(createElement(FotoPanel, { tenantSlug: 'hub', files, onFiles: () => {} }))

  it('la foto cae y se puede cambiar o sumar otra; el QR ya no está', () => {
    const out = panel([file('factura.jpg')])
    const read = text(out)
    expect(out).toContain('adm-land')
    expect(read).toContain('Cambiar la foto')
    expect(read).toContain('Otra')
    expect(read).not.toContain('Escanealo')
  })

  it('un PDF se ve con su nombre', () => {
    expect(text(panel([file('factura.pdf', 'application/pdf')]))).toContain('factura.pdf')
  })

  it('las anteriores quedan en una lista, cada una con su ✕', () => {
    const out = panel([file('uno.jpg'), file('dos.jpg')])
    expect(out).toContain('aria-label="Quitar uno.jpg"')
    expect(out).not.toContain('aria-label="Quitar dos.jpg"')
  })

  it('con cinco ya no ofrece otra: es el tope del comprobante', () => {
    const five = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.jpg`))
    expect(text(panel(five))).not.toContain('Otra')
  })
})

describe('el botón para una fila', () => {
  const button = (files: File[], label?: string) =>
    text(
      html(
        createElement(FotoQrButton, {
          tenantSlug: 'hub',
          files,
          onFiles: () => {},
          ...(label ? { label } : {}),
        }),
      ),
    )

  it('dice cuántas tiene', () => {
    expect(button([])).toBe('Foto')
    expect(button([], 'Comprobante')).toBe('Comprobante')
    expect(button([file('a.jpg')])).toBe('1 foto')
    expect(button([file('a.jpg'), file('b.jpg')])).toBe('2 fotos')
  })

  it('el diálogo se abre recién al tocarlo: hasta ahí no hay QR ni link', () => {
    const out = html(
      createElement(FotoQrButton, { tenantSlug: 'hub', files: [], onFiles: () => {} }),
    )
    expect(out).not.toContain('Escanealo')
    expect(createUploadLink).not.toHaveBeenCalled()
  })
})
