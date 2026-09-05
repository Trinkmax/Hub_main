import { describe, expect, it } from 'vitest'
import { analyzeLandingHtml, summarizeChecks } from '@/lib/landings/checks'

/**
 * La revisión rápida es lo único que le avisa al encargado de marketing que su
 * landing va a salir rota ANTES de que mande el link. Cada caso de acá es un
 * error real que se comió alguien alguna vez.
 */

const OK_PAGE = `<!doctype html>
<html lang="es-AR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Halloween en HUB</title>
  </head>
  <body>
    <h1>Fiesta</h1>
    <img src="https://xyz.supabase.co/storage/v1/object/public/landing-media/t/1.webp" alt="">
    <a href="https://wa.me/5493511234567">Reservar</a>
    <a href="#mapa">Cómo llegar</a>
    <a href="/p/otra-promo">Otra promo</a>
  </body>
</html>`

function ids(html: string) {
  return analyzeLandingHtml(html).map((check) => check.id)
}

describe('analyzeLandingHtml', () => {
  it('una landing bien armada no tiene ni un aviso', () => {
    expect(analyzeLandingHtml(OK_PAGE)).toEqual([])
  })

  it('el código vacío es el único caso que corta la revisión', () => {
    const checks = analyzeLandingHtml('   \n  ')
    expect(checks).toHaveLength(1)
    expect(checks[0]?.id).toBe('empty')
    expect(checks[0]?.level).toBe('error')
  })

  it('detecta la falta de viewport como error (es lo que rompe en el celular)', () => {
    const html = OK_PAGE.replace(/<meta name="viewport"[^>]*>/, '')
    const checks = analyzeLandingHtml(html)
    const viewport = checks.find((check) => check.id === 'no-viewport')
    expect(viewport?.level).toBe('error')
  })

  it('detecta doctype, title y charset faltantes', () => {
    const html =
      '<html><body><meta name="viewport" content="width=device-width"><p>Hola</p></body></html>'
    expect(ids(html)).toEqual(expect.arrayContaining(['no-doctype', 'no-title', 'no-charset']))
  })

  it('marca las rutas relativas y las absolutas de nuestro dominio', () => {
    const html = `${OK_PAGE}<img src="img/hero.jpg"><link href="estilos.css"><img src="/fotos/a.png">`
    const broken = analyzeLandingHtml(html).find((check) => check.id === 'relative-refs')
    expect(broken?.level).toBe('error')
    expect(broken?.detail).toContain('img/hero.jpg')
    expect(broken?.detail).toContain('estilos.css')
    expect(broken?.detail).toContain('/fotos/a.png')
  })

  it('no confunde con rutas rotas lo que sí resuelve', () => {
    const html = `${OK_PAGE}<a href="mailto:hola@bar.com">Mail</a><a href="tel:+5493511234567">Tel</a><img src="data:image/png;base64,AAA"><script src="//cdn.jsdelivr.net/x.js"></script>`
    expect(ids(html)).not.toContain('relative-refs')
  })

  it('encuentra las rutas escritas en url() de CSS', () => {
    const html = `${OK_PAGE}<style>.hero{background:url('fondo.jpg')}</style>`
    expect(ids(html)).toContain('relative-refs')
  })

  it('avisa por recursos servidos en http://', () => {
    const html = `${OK_PAGE}<img src="http://ejemplo.com/foto.jpg">`
    expect(ids(html)).toContain('insecure-refs')
  })

  it('avisa que las APIs de storage se rompen dentro del sandbox', () => {
    const html = `${OK_PAGE}<script>const visto = localStorage.getItem('promo')</script>`
    const check = analyzeLandingHtml(html).find((c) => c.id === 'blocked-apis')
    expect(check?.level).toBe('error')
    expect(check?.title).toContain('localStorage')
  })

  it('detecta document.cookie e indexedDB además de localStorage', () => {
    expect(ids(`${OK_PAGE}<script>document.cookie</script>`)).toContain('blocked-apis')
    expect(ids(`${OK_PAGE}<script>indexedDB.open('x')</script>`)).toContain('blocked-apis')
  })

  it('avisa que Google Analytics no va a contar visitas', () => {
    const html = `${OK_PAGE}<script>gtag('config', 'G-123')</script>`
    expect(ids(html)).toContain('ga-blocked')
  })

  it('avisa cuando el HTML pesa demasiado', () => {
    const html = OK_PAGE.replace('<h1>Fiesta</h1>', `<p>${'x'.repeat(310_000)}</p>`)
    const check = analyzeLandingHtml(html).find((c) => c.id === 'heavy')
    expect(check?.level).toBe('tip')
    expect(check?.title).toMatch(/KB/)
  })

  it('ordena primero los errores y último los tips', () => {
    const html = '<html><body><script>localStorage.getItem("a")</script></body></html>'
    const levels = analyzeLandingHtml(html).map((check) => check.level)
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)))
    expect(levels[0]).toBe('error')
  })

  it('no le importan las mayúsculas de las etiquetas', () => {
    const html = `<!DOCTYPE HTML><html><head><META CHARSET="utf-8"><META NAME="viewport" CONTENT="width=device-width"><TITLE>Hola</TITLE></head><body>x</body></html>`
    expect(analyzeLandingHtml(html)).toEqual([])
  })
})

describe('summarizeChecks', () => {
  it('cuenta por nivel', () => {
    const checks = analyzeLandingHtml('<html><body><script>localStorage.x</script></body></html>')
    const summary = summarizeChecks(checks)
    expect(summary.errors).toBeGreaterThan(0)
    expect(summary.errors + summary.warnings + summary.tips).toBe(checks.length)
  })
})
