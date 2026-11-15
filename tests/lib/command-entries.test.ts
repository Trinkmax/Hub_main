import { describe, expect, it } from 'vitest'
import { commandEntries } from '@/components/command-palette/command-config'
import {
  commandEntryHref,
  foldText,
  searchCommandEntries,
  visibleCommandEntries,
} from '@/components/command-palette/command-entries'
import { getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

const NONE: AccountingAccess = {
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}
const OWNER_ACCESS: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
const HUB = getTenantFeatures({ feature_flags: { accounting: true, purchasing: true } })

describe('las entradas de ⌘K y del buscador de «Más»', () => {
  it('el dueño ve las suyas; las de Administración, solo con acceso', () => {
    const withAccess = visibleCommandEntries({
      role: 'owner',
      features: HUB,
      isPlatformAdmin: false,
      accounting: OWNER_ACCESS,
    })
    const without = visibleCommandEntries({
      role: 'owner',
      features: HUB,
      isPlatformAdmin: false,
      accounting: NONE,
    })
    expect(withAccess.some((entry) => entry.id === 'acc-new-purchase')).toBe(true)
    expect(without.some((entry) => entry.id === 'acc-new-purchase')).toBe(false)
    expect(without.some((entry) => entry.id === 'new-reservation')).toBe(true)
  })

  it('la anfitriona no ve las del dueño (fail-closed: sin roles, solo el dueño)', () => {
    const host = visibleCommandEntries({
      role: 'host',
      features: HUB,
      isPlatformAdmin: false,
      accounting: NONE,
    })
    expect(host.some((entry) => entry.id === 'new-reservation')).toBe(true)
    expect(host.some((entry) => entry.id === 'new-customer')).toBe(false)
  })

  it('busca sin acentos ni mayúsculas, con todas las palabras', () => {
    expect(foldText('Administración')).toBe('administracion')
    const results = searchCommandEntries(commandEntries, 'nueva RESERVA')
    expect(results[0]?.id).toBe('new-reservation')
    expect(searchCommandEntries(commandEntries, 'reserva zzz')).toEqual([])
    expect(searchCommandEntries(commandEntries, '   ')).toEqual([])
  })

  it('lo que empieza igual va antes que lo que solo está en las palabras clave', () => {
    const results = searchCommandEntries(commandEntries, 'club')
    const first = results[0]
    expect(first && foldText(first.label).startsWith('club')).toBe(true)
  })

  it('una hoja de Administración se abre sobre la pantalla actual si ya estás en la sección', () => {
    const entry = commandEntries.find((item) => item.accountingAction)
    if (!entry) throw new Error('no hay hojas de Administración en ⌘K')
    const inside = commandEntryHref(entry, 'hub', '/hub/administracion/compras', '?tab=pagos')
    const outside = commandEntryHref(entry, 'hub', '/hub/reservas', '')
    expect(inside.startsWith('/hub/administracion/compras?')).toBe(true)
    expect(outside.startsWith('/hub/administracion?')).toBe(true)
  })
})
