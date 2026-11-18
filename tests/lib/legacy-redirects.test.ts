import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BAR_SEGMENT, LEGACY_REDIRECTS } from '@/lib/tenant/legacy-redirects'
import { RESERVED_SLUGS } from '@/lib/tenant/types'
import nextConfig from '@/next.config'

/**
 * Las direcciones viejas no pueden llevar a una pantalla que no existe ni tapar una de hoy.
 *
 * El 18/11/2026, al retirar pantallas del sistema anterior, quedaron reglas de `next.config.ts`
 * apuntando a páginas borradas (`/configuracion/puntos` → `/puntos`, `/cocina` → `/salon/cocina`…) y
 * otras que agarraban rutas públicas (`/p/marketing`, una landing, terminaba en `/p/mensajeria`).
 * Ninguna prueba lo veía. Estas sí.
 */

const APP = path.resolve(__dirname, '../../app')
const WORKSPACES = [
  path.join(APP, '(manager)', '[tenantSlug]'),
  path.join(APP, '(salon)', '[tenantSlug]'),
]

/** El archivo de pantalla que atiende `/reservas` o `/salon/escanear` (sin el bar). */
function pageFor(route: string): string | null {
  const clean = route.replace(/^\//, '')
  return (
    WORKSPACES.map((base) => path.join(base, clean, 'page.tsx')).find((file) => existsSync(file)) ??
    null
  )
}

/** ¿Hay alguna pantalla o ruta colgando de esa carpeta? (Una carpeta vacía que quedó en disco no cuenta.) */
function hasRoutesUnder(route: string): boolean {
  const clean = route.replace(/^\//, '')
  const walk = (dir: string): boolean =>
    readdirSync(dir).some((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return name.startsWith('_') ? false : walk(full)
      return name === 'page.tsx' || name === 'route.ts'
    })
  return WORKSPACES.map((base) => path.join(base, clean)).some(
    (dir) => existsSync(dir) && statSync(dir).isDirectory() && walk(dir),
  )
}

/** La parte de la regla después del bar: `/club/puntos`, `/flows/:rest*`. */
const tail = (source: string) => source.slice(`/${BAR_SEGMENT}`.length)

/** La misma lectura que hace Next del `source`, para probar qué direcciones agarra. */
function toRegExp(source: string): RegExp {
  const bar = BAR_SEGMENT.slice(':slug'.length)
  const rest = tail(source).replace('/:rest*', '(?:/.*)?')
  return new RegExp(`^/${bar}${rest}/?$`)
}

const firstMatch = (pathname: string) =>
  LEGACY_REDIRECTS.find((rule) => toRegExp(rule.source).test(pathname)) ?? null

describe('las direcciones viejas del panel', () => {
  it('next.config.ts usa esta lista', async () => {
    expect(await nextConfig.redirects?.()).toEqual(LEGACY_REDIRECTS)
  })

  it('todas arrancan por el bar y vuelven al mismo bar', () => {
    for (const rule of LEGACY_REDIRECTS) {
      expect(rule.source.startsWith(`/${BAR_SEGMENT}/`), rule.source).toBe(true)
      expect(
        rule.destination === '/:slug' || /^\/:slug[/?]/.test(rule.destination),
        rule.destination,
      ).toBe(true)
    }
  })

  it('cada destino es una pantalla que existe', () => {
    for (const rule of LEGACY_REDIRECTS) {
      const route = rule.destination
        .replace(/^\/:slug/, '')
        .replace(/\?.*$/, '')
        .replace('/:rest*', '')
      expect(pageFor(route), `${tail(rule.source)} → ${rule.destination}`).not.toBeNull()
    }
  })

  it('ninguna regla tapa una pantalla de hoy', () => {
    for (const rule of LEGACY_REDIRECTS) {
      const from = tail(rule.source)
      if (from.endsWith('/:rest*')) {
        expect(hasRoutesUnder(from.replace('/:rest*', '')), from).toBe(false)
      } else {
        expect(pageFor(from), from).toBeNull()
      }
    }
  })

  it('agarra la dirección vieja de un bar, también si su nombre empieza como un prefijo reservado', () => {
    expect(firstMatch('/hub/puntos')?.destination).toBe('/:slug/club?tab=programa')
    expect(firstMatch('/hub/acreditar')?.destination).toBe('/:slug/clientes?sumar=1')
    expect(firstMatch('/hub/salon/mesas/abc')?.destination).toBe('/:slug/salon')
    expect(firstMatch('/hub/bandeja/123')?.destination).toBe('/:slug/mensajeria/inbox/:rest*')
    expect(firstMatch('/hub/docs')?.destination).toBe('/:slug')
    // «pizzeria», «cafe» y «entradas-bar» empiezan como `p`, `c` y `entradas`: son bares igual.
    expect(firstMatch('/pizzeria/docs')).not.toBeNull()
    expect(firstMatch('/cafe/marketing')).not.toBeNull()
    expect(firstMatch('/entradas-bar/eventos')).not.toBeNull()
  })

  it('«Cerrar mesa» lleva a sumar puntos y el resto de Visitas a Clientes', () => {
    expect(firstMatch('/hub/visitas/nueva')?.destination).toBe('/:slug/clientes?sumar=1')
    expect(firstMatch('/hub/visitas')?.destination).toBe('/:slug/clientes')
    expect(firstMatch('/hub/visitas/otra')?.destination).toBe('/:slug/clientes')
  })

  it('no toca las pantallas de hoy', () => {
    for (const pathname of [
      '/hub',
      '/hub/eventos/programados',
      '/hub/club',
      '/hub/menu',
      '/hub/menu/precios',
      '/hub/salon',
      '/hub/salon/mesa/abc',
      '/hub/salon/escanear',
      '/hub/configuracion/salon',
      '/hub/mensajeria/flows',
      '/hub/clientes',
    ]) {
      expect(firstMatch(pathname), pathname).toBeNull()
    }
  })

  it('no agarra las rutas públicas ni las del sistema', () => {
    // Una landing se llama como quiera quien la sube: «eventos», «marketing», «docs»…
    for (const pathname of [
      '/p/eventos',
      '/p/marketing',
      '/p/docs',
      '/p/puntos',
      '/carta/cocina',
      '/entradas/eventos',
      '/l/marketing',
      '/c/acreditar',
      '/api/docs',
      '/onboarding',
      '/admin/docs',
    ]) {
      expect(firstMatch(pathname), pathname).toBeNull()
    }
    // …y vale para cada prefijo reservado, los de hoy y los que se sumen.
    for (const slug of RESERVED_SLUGS) {
      for (const rule of LEGACY_REDIRECTS) {
        const sample = `/${slug}${tail(rule.source).replace('/:rest*', '')}`
        expect(toRegExp(rule.source).test(sample), sample).toBe(false)
      }
    }
  })
})
