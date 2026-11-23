import { describe, expect, it } from 'vitest'
import {
  applyAccessChange,
  isOnlyAdmin,
  levelCounts,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/access-changes'
import {
  accessFactsLine,
  downgradeCopy,
  entersWords,
  LEVEL_COPY,
  LEVEL_ORDER,
  savedLine,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/access-copy'
import {
  ACCOUNTING_SCOPES,
  canGrantOthers,
  compareAccessRows,
  DEFAULT_GRANT_SCOPE,
  scopeOf,
} from '@/lib/accounting/access-levels'
import type { AccessOverview, AccessPersonRow } from '@/lib/accounting/queries/access'

/**
 * Los niveles de acceso a Administración (pedido de los socios de HUB, 22/11/2026: «los empleados
 * solo deberían poder ver compra y pagos»; «todos los socios deben poder dar accesos»). Lo puro:
 * cómo se lee el nivel, cómo se ordena la lista, lo que la pantalla muestra al instante mientras se
 * guarda y las palabras.
 */

const STAMP = '2026-11-23T15:00:00.000+00:00'

const person = (
  over: Partial<AccessPersonRow> & Pick<AccessPersonRow, 'userId' | 'displayName'>,
): AccessPersonRow => ({
  id: `row-${over.userId}`,
  isAdmin: false,
  scope: 'full',
  source: 'grant',
  grantedByName: 'Tomás',
  grantedAt: STAMP,
  revokedAt: null,
  revokedByName: null,
  revokeReason: null,
  updatedAt: STAMP,
  ...over,
})

const overview = (over: Partial<AccessOverview> = {}): AccessOverview => {
  const active = over.active ?? [
    person({ userId: 'tomas', displayName: 'Tomás', isAdmin: true, source: 'setup' }),
    person({ userId: 'piojo', displayName: 'Luciano' }),
    person({ userId: 'encargada', displayName: 'Encargada', scope: 'purchases' }),
  ]
  return {
    revoked: [],
    ownersWithoutAccess: [
      { userId: 'mozo', name: 'Bruno' },
      { userId: 'otra', name: 'Ana' },
    ],
    accountants: [],
    ...over,
    active,
    adminCount: over.adminCount ?? active.filter((row) => row.isAdmin).length,
  }
}

describe('el nivel de un acceso', () => {
  it('hay dos, y se ofrecen de menos a más', () => {
    expect([...ACCOUNTING_SCOPES].sort()).toEqual(['full', 'purchases'])
    expect(LEVEL_ORDER).toEqual(['purchases', 'full'])
    expect(Object.keys(LEVEL_COPY).sort()).toEqual(['full', 'purchases'])
  })

  it('lo que no se reconoce (o todavía no llega de la base) es el completo, como era antes', () => {
    expect(scopeOf('purchases')).toBe('purchases')
    expect(scopeOf('full')).toBe('full')
    expect(scopeOf(undefined)).toBe('full')
    expect(scopeOf(null)).toBe('full')
    expect(scopeOf('ventas')).toBe('full')
    expect(scopeOf(1)).toBe('full')
  })

  it('al dar un acceso se propone el acotado: es lo prudente', () => {
    expect(DEFAULT_GRANT_SCOPE).toBe('purchases')
  })

  it('dar accesos pide el nivel completo', () => {
    expect(canGrantOthers('full')).toBe(true)
    expect(canGrantOthers('purchases')).toBe(false)
  })

  it('la lista va con quienes ven todo primero y por nombre; «da accesos» no mueve a nadie', () => {
    const rows = [
      { scope: 'purchases', displayName: 'Ana', isAdmin: false },
      { scope: 'full', displayName: 'Tomás', isAdmin: true },
      { scope: 'full', displayName: 'Luciano', isAdmin: false },
      { scope: 'purchases', displayName: 'Álvaro', isAdmin: false },
      { scope: 'full', displayName: 'eze', isAdmin: false },
    ] as const
    expect([...rows].sort(compareAccessRows).map((row) => row.displayName)).toEqual([
      'eze',
      'Luciano',
      'Tomás',
      'Álvaro',
      'Ana',
    ])
  })
})

describe('lo que se ve al instante, antes de que conteste el servidor', () => {
  const at = '2026-11-23T18:00:00.000Z'

  it('dar un acceso: pasa de «todavía no entran» a «entran», con su nivel', () => {
    const next = applyAccessChange(overview(), {
      type: 'set',
      userId: 'mozo',
      name: 'Bruno',
      scope: 'purchases',
      isAdmin: false,
      at,
    })
    expect(next.ownersWithoutAccess.map((m) => m.name)).toEqual(['Ana'])
    expect(next.active.map((row) => row.displayName)).toEqual([
      'Luciano',
      'Tomás',
      'Bruno',
      'Encargada',
    ])
    const bruno = next.active.find((row) => row.userId === 'mozo')
    expect(bruno).toMatchObject({
      scope: 'purchases',
      isAdmin: false,
      source: 'grant',
      grantedAt: at,
      revokedAt: null,
    })
    expect(next.adminCount).toBe(1)
  })

  it('subir de nivel lo lleva con los que ven todo; bajarlo, con los de compras y pagos', () => {
    const up = applyAccessChange(overview(), {
      type: 'set',
      userId: 'encargada',
      name: 'Encargada',
      scope: 'full',
      isAdmin: false,
      at,
    })
    expect(up.active.map((row) => `${row.displayName}:${row.scope}`)).toEqual([
      'Encargada:full',
      'Luciano:full',
      'Tomás:full',
    ])
    const down = applyAccessChange(up, {
      type: 'set',
      userId: 'piojo',
      name: 'Luciano',
      scope: 'purchases',
      isAdmin: false,
      at,
    })
    expect(down.active.map((row) => `${row.displayName}:${row.scope}`)).toEqual([
      'Encargada:full',
      'Tomás:full',
      'Luciano:purchases',
    ])
    // No toca lo que no cambió: sigue siendo la misma fila.
    expect(down.active.find((row) => row.userId === 'piojo')?.id).toBe('row-piojo')
    expect(down.active.find((row) => row.userId === 'piojo')?.grantedByName).toBe('Tomás')
  })

  it('«da accesos» se prende y se apaga sin cambiar el orden, y lleva la cuenta', () => {
    const on = applyAccessChange(overview(), {
      type: 'set',
      userId: 'piojo',
      name: 'Luciano',
      scope: 'full',
      isAdmin: true,
      at,
    })
    expect(on.adminCount).toBe(2)
    expect(on.active.map((row) => row.displayName)).toEqual(['Luciano', 'Tomás', 'Encargada'])
    const off = applyAccessChange(on, {
      type: 'set',
      userId: 'tomas',
      name: 'Tomás',
      scope: 'full',
      isAdmin: false,
      at,
    })
    expect(off.adminCount).toBe(1)
    expect(off.active.find((row) => row.userId === 'piojo')?.isAdmin).toBe(true)
  })

  it('bajar de nivel a quien daba accesos también le apaga «da accesos»', () => {
    const two = applyAccessChange(overview(), {
      type: 'set',
      userId: 'piojo',
      name: 'Luciano',
      scope: 'full',
      isAdmin: true,
      at,
    })
    // Aunque el pedido diga «sigue dando accesos», con el nivel acotado no puede.
    const down = applyAccessChange(two, {
      type: 'set',
      userId: 'piojo',
      name: 'Luciano',
      scope: 'purchases',
      isAdmin: true,
      at,
    })
    expect(down.active.find((row) => row.userId === 'piojo')).toMatchObject({
      scope: 'purchases',
      isAdmin: false,
    })
    expect(down.adminCount).toBe(1)
  })

  it('sacar un acceso: vuelve a «todavía no entran», por nombre', () => {
    const next = applyAccessChange(overview(), { type: 'revoke', userId: 'piojo' })
    expect(next.active.map((row) => row.displayName)).toEqual(['Tomás', 'Encargada'])
    expect(next.ownersWithoutAccess.map((m) => m.name)).toEqual(['Ana', 'Bruno', 'Luciano'])
    // Sacar a alguien que ya no está no cambia nada.
    const same = overview()
    expect(applyAccessChange(same, { type: 'revoke', userId: 'nadie' })).toBe(same)
  })

  it('no cambia lo que recibió (el servidor manda cuando contesta)', () => {
    const before = overview()
    const snapshot = JSON.stringify(before)
    applyAccessChange(before, {
      type: 'set',
      userId: 'mozo',
      name: 'Bruno',
      scope: 'full',
      isAdmin: true,
      at,
    })
    applyAccessChange(before, { type: 'revoke', userId: 'tomas' })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('cuenta cuántos ven todo y cuántos solo compras y pagos', () => {
    expect(levelCounts(overview().active)).toEqual({ full: 2, purchases: 1 })
    expect(levelCounts([])).toEqual({ full: 0, purchases: 0 })
  })

  it('el único que da accesos queda trabado; con dos, ninguno', () => {
    const one = overview()
    const tomas = one.active.find((row) => row.userId === 'tomas')
    const piojo = one.active.find((row) => row.userId === 'piojo')
    if (!tomas || !piojo) throw new Error('faltan filas')
    expect(isOnlyAdmin(tomas, one)).toBe(true)
    expect(isOnlyAdmin(piojo, one)).toBe(false)
    const two = applyAccessChange(one, {
      type: 'set',
      userId: 'piojo',
      name: 'Luciano',
      scope: 'full',
      isAdmin: true,
      at,
    })
    expect(two.active.some((row) => isOnlyAdmin(row, two))).toBe(false)
  })
})

describe('las palabras', () => {
  it('cada nivel dice qué ve en una línea, sin jerga', () => {
    expect(LEVEL_COPY.full.label).toBe('Completo')
    expect(LEVEL_COPY.purchases.label).toBe('Solo compras y pagos')
    for (const scope of ACCOUNTING_SCOPES) {
      const { sees, forWhom } = LEVEL_COPY[scope]
      expect(sees.length).toBeGreaterThan(20)
      expect(sees.length).toBeLessThan(140)
      expect(`${sees} ${forWhom}`).not.toMatch(/permiso|rol\b|scope|admin/i)
    }
    // Lo que el nivel acotado NO ve tiene que estar dicho.
    expect(LEVEL_COPY.purchases.sees).toContain('No ve ventas, sueldos, cajas ni libros.')
  })

  it('el titular habla de personas, no de socios: también entran empleados', () => {
    expect(entersWords(1)).toBe('persona entra')
    expect(entersWords(5)).toBe('personas entran')
    expect(entersWords(0)).toBe('personas entran')
  })

  it('abajo del titular: el reparto solo si hay alguien acotado, y los que faltan solo si faltan', () => {
    expect(accessFactsLine({ full: 4, purchases: 0, outside: 0 })).toBeNull()
    expect(accessFactsLine({ full: 3, purchases: 2, outside: 0 })).toBe(
      '3 ven todo · 2 solo compras y pagos',
    )
    expect(accessFactsLine({ full: 1, purchases: 1, outside: 1 })).toBe(
      '1 ve todo · 1 solo compras y pagos · 1 todavía no entra',
    )
    expect(accessFactsLine({ full: 6, purchases: 0, outside: 12 })).toBe('12 todavía no entran')
  })

  it('bajar de nivel avisa qué deja de ver', () => {
    const other = downgradeCopy({ name: 'Eze', self: false, isAdmin: false })
    expect(other.title).toBe('¿Eze pasa a ver solo compras y pagos?')
    for (const word of [
      'ventas',
      'cierres',
      'sueldos',
      'gastos fijos',
      'cajas',
      'resumen',
      'libros',
    ]) {
      expect(other.description).toContain(word)
    }
    expect(other.description).toContain('ya no puede anular comprobantes')
    expect(other.description).toContain('Sigue cargando compras, gastos y pagos a proveedores.')
    expect(other.description).not.toContain('deja de dar accesos')
    expect(other.action).toBe('Pasar a solo compras y pagos')

    const admin = downgradeCopy({ name: 'Eze', self: false, isAdmin: true })
    expect(admin.description).toContain('También deja de dar accesos.')

    const self = downgradeCopy({ name: 'Tomás', self: true, isAdmin: true })
    expect(self.title).toBe('¿Pasás a ver solo compras y pagos?')
    expect(self.description).toContain('esta pantalla')
    expect(self.description).toContain('otra persona que dé accesos')

    expect(downgradeCopy({ name: '  ', self: false, isAdmin: false }).title).toBe(
      '¿Esta persona pasa a ver solo compras y pagos?',
    )
  })

  it('el aviso de «listo» dice lo que cambió', () => {
    const full = { displayName: 'Luciano', scope: 'full', isAdmin: false } as const
    const admin = { ...full, isAdmin: true } as const
    const limited = { displayName: 'Encargada', scope: 'purchases', isAdmin: false } as const
    // Acceso nuevo.
    expect(savedLine(null, limited)).toBe('Listo: Encargada ya puede cargar compras y pagos.')
    expect(savedLine(null, full)).toBe('Listo: Luciano ya ve todo Administración.')
    expect(savedLine(null, admin)).toBe('Listo: Luciano ya ve todo Administración y da accesos.')
    // Cambio de nivel.
    expect(savedLine({ scope: 'purchases', isAdmin: false }, full)).toBe(
      'Listo: Luciano ahora ve todo Administración.',
    )
    expect(savedLine({ scope: 'full', isAdmin: true }, limited)).toBe(
      'Listo: Encargada ahora ve solo compras y pagos.',
    )
    // «Da accesos».
    expect(savedLine({ scope: 'full', isAdmin: false }, admin)).toBe(
      'Listo: Luciano ahora también da accesos.',
    )
    expect(savedLine({ scope: 'full', isAdmin: true }, full)).toBe(
      'Listo: Luciano ya no da accesos.',
    )
    // Nada cambió (solo el nombre) o no vino el nombre.
    expect(savedLine({ scope: 'full', isAdmin: false }, full)).toBe(
      'Listo: actualizamos el acceso de Luciano.',
    )
    expect(savedLine(null, { ...limited, displayName: '' })).toBe(
      'Listo: Esa persona ya puede cargar compras y pagos.',
    )
  })
})
