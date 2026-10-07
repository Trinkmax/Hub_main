import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CommandAudience,
  commandEntries,
  visibleCommandEntries,
} from '@/components/command-palette/command-config'
import {
  pageEntryForPath,
  parseRecentIds,
  pushRecentId,
  RECENT_LIMIT,
  readRecentIds,
  recentEntries,
  recentStorageKey,
  writeRecentIds,
} from '@/components/command-palette/recent-pages'
import { getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

/**
 * «Recientes» de ⌘K: qué se guarda (ids de páginas, nunca URLs), cómo se
 * resuelve una ruta a su página y que lo guardado se vuelva a filtrar por lo
 * que la persona puede ver hoy.
 */

const SLUG = 'hub'
const features = { ...getTenantFeatures({ feature_flags: {} }), accounting: true }
const readOnly: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: false,
  admin: false,
  canSetUp: false,
}
const owner: CommandAudience = { role: 'owner', features, isPlatformAdmin: false }
const ownerEntries = visibleCommandEntries(commandEntries, owner)

describe('pageEntryForPath', () => {
  const idFor = (pathname: string) => pageEntryForPath(pathname, SLUG, ownerEntries)?.id ?? null

  it('el inicio del bar matchea solo exacto (si no, sería el prefijo de todo)', () => {
    expect(idFor('/hub')).toBe('home')
    expect(idFor('/hub/acreditar')).toBeNull()
  })

  it('una ficha resuelve a su sección por el prefijo más largo', () => {
    expect(idFor('/hub/clientes/0b5c')).toBe('people')
    expect(idFor('/hub/menu/tags')).toBe('tags')
    expect(idFor('/hub/menu')).toBe('menu')
    expect(idFor('/hub/estadisticas/como-nos-fue')).toBe('how-it-went')
  })

  it('nunca resuelve a una acción: el alta de una reserva es la página Reservas', () => {
    expect(idFor('/hub/reservas/nuevo')).toBe('reservations')
    expect(idFor('/hub/mensajeria/difusiones/nueva')).toBe('broadcasts')
  })

  it('las páginas de Administración, para quien las ve', () => {
    const accountant = visibleCommandEntries(commandEntries, {
      role: 'accountant',
      features,
      isPlatformAdmin: false,
      accounting: readOnly,
    })
    expect(pageEntryForPath('/hub/administracion/libros/mayor', SLUG, accountant)?.id).toBe(
      'acc-ledger',
    )
    expect(pageEntryForPath('/hub/administracion', SLUG, accountant)?.id).toBe('acc-home')
    // Para un dueño sin acceso no existe esa página.
    expect(pageEntryForPath('/hub/administracion', SLUG, ownerEntries)).toBeNull()
  })
})

describe('parseRecentIds / pushRecentId', () => {
  it('la más nueva primero, sin repetir y con tope', () => {
    let ids: string[] = []
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g']) ids = pushRecentId(ids, id)
    expect(ids).toEqual(['g', 'f', 'e', 'd', 'a', 'c'])
    expect(ids.length).toBe(RECENT_LIMIT + 1)
  })

  it('lo guardado roto o raro se ignora', () => {
    expect(parseRecentIds(null)).toEqual([])
    expect(parseRecentIds('no es json')).toEqual([])
    expect(parseRecentIds('{"a":1}')).toEqual([])
    expect(parseRecentIds('["a", 3, "", "a", "b"]')).toEqual(['a', 'b'])
  })
})

describe('recentEntries', () => {
  it('vuelve a filtrar por lo que se ve hoy, saca la página abierta y corta en 5', () => {
    const stored = ['people', 'acc-ledger', 'home', 'menu', 'calendar', 'stats', 'docs']
    const result = recentEntries(stored, ownerEntries, 'home').map((e) => e.id)
    // `acc-ledger` ya no se ve (dueño sin acceso) y `home` es la página abierta.
    expect(result).toEqual(['people', 'menu', 'calendar', 'stats', 'docs'])
  })

  it('ignora ids que no existen o que son acciones', () => {
    expect(
      recentEntries(['nope', 'new-customer', 'people'], ownerEntries).map((e) => e.id),
    ).toEqual(['people'])
  })
})

describe('readRecentIds / writeRecentIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('una clave por bar', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })
    writeRecentIds('hub', ['people'])
    expect(store.get(recentStorageKey('hub'))).toBe('["people"]')
    expect(readRecentIds('hub')).toEqual(['people'])
    expect(readRecentIds('otro-bar')).toEqual([])
  })

  it('con el storage bloqueado no rompe', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })
    expect(readRecentIds('hub')).toEqual([])
    expect(() => writeRecentIds('hub', ['people'])).not.toThrow()
  })
})
