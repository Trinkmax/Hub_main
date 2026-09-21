import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadLandingHtml, landingFileName } from '@/lib/landings/download'

/**
 * El botón "Descargar" del editor de páginas existe para el ida y vuelta con
 * ChatGPT: lo que se baja tiene que ser EXACTAMENTE lo que hay en el panel, y
 * tiene que poder volver a entrar por "Subir .html" sin cambiar un byte.
 */

describe('landingFileName', () => {
  it('lleva el link y la hora, sin caracteres que Windows rechaza', () => {
    const name = landingFileName('sushi-libre', new Date(2026, 8, 21, 14, 38))
    expect(name).toBe('sushi-libre_2026-09-21_14.38.html')
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
  })

  it('rellena con ceros: ordenados por nombre, quedan ordenados por fecha', () => {
    expect(landingFileName('promo', new Date(2026, 0, 5, 9, 7))).toBe('promo_2026-01-05_09.07.html')
  })
})

describe('downloadLandingHtml', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function setup() {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const append = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { append } })
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:landing'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { link, append, blobs, revoke }
  }

  it('baja el texto exacto, en UTF-8 y sin BOM', async () => {
    const { link, blobs } = setup()
    const html = '<!doctype html>\n<title>Año nuevo — ñoquis 🍝</title>\r\n  <p>¡Vení!</p>'

    downloadLandingHtml(html, 'promo.html')

    expect(link.download).toBe('promo.html')
    expect(link.href).toBe('blob:landing')
    expect(link.click).toHaveBeenCalledOnce()
    expect(link.remove).toHaveBeenCalledOnce()

    const [blob] = blobs
    expect(blob?.type).toBe('text/html;charset=utf-8')
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))
    // Sin BOM adelante: el archivo es byte a byte lo que había en el editor.
    expect(bytes).toEqual(new TextEncoder().encode(html))
    expect(await blob?.text()).toBe(html)
  })

  it('no revoca la URL en el mismo tick (Safari cancelaría la descarga)', () => {
    vi.useFakeTimers()
    const { revoke } = setup()

    downloadLandingHtml('<p>hola</p>', 'a.html')
    expect(revoke).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:landing')
  })
})
