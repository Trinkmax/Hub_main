import { describe, expect, it } from 'vitest'
import {
  claimForTenantId,
  readActiveTenantId,
  readTenantClaims,
  roleForSlug,
} from '@/lib/tenant/claims'

// Los claims los inyecta `custom_access_token_hook` (migración 20260827120000).
// El proxy rutea por rol leyéndolos del JWT sin tocar la DB, así que el parser
// tiene que ser estricto: cualquier cosa rara → se ignora, nunca se inventa.
describe('readTenantClaims', () => {
  it('devuelve null si el claim no está (token viejo) para caer a la DB', () => {
    expect(readTenantClaims(undefined)).toBeNull()
    expect(readTenantClaims(null)).toBeNull()
    expect(readTenantClaims({})).toBeNull()
    expect(readTenantClaims({ active_tenant_id: 'x' })).toBeNull()
    expect(readTenantClaims({ tenants: 'nope' })).toBeNull()
  })

  it('devuelve [] si el claim está pero el usuario no tiene bares', () => {
    expect(readTenantClaims({ tenants: [] })).toEqual([])
  })

  it('devuelve null si el hook marcó la lista como recortada (resolver por DB)', () => {
    expect(
      readTenantClaims({
        tenants: [{ id: 't1', slug: 'hub', role: 'owner' }],
        tenants_truncated: true,
      }),
    ).toBeNull()
  })

  it('parsea memberships válidas y descarta las malformadas o con rol desconocido', () => {
    const claims = readTenantClaims({
      tenants: [
        { id: 't1', slug: 'hub', role: 'owner' },
        { id: 't2', slug: 'otro', role: 'waiter' },
        { id: 't3', slug: 'malo', role: 'superuser' },
        { id: 42, slug: 'sin-id', role: 'owner' },
        'basura',
        null,
      ],
    })
    expect(claims).toEqual([
      { id: 't1', slug: 'hub', role: 'owner' },
      { id: 't2', slug: 'otro', role: 'waiter' },
    ])
  })
})

describe('readActiveTenantId', () => {
  it('lee el uuid del bar activo o null', () => {
    expect(readActiveTenantId({ active_tenant_id: 'abc' })).toBe('abc')
    expect(readActiveTenantId({ active_tenant_id: '' })).toBeNull()
    expect(readActiveTenantId({})).toBeNull()
    expect(readActiveTenantId(undefined)).toBeNull()
  })
})

describe('roleForSlug / claimForTenantId', () => {
  const claims = readTenantClaims({
    tenants: [
      { id: 't1', slug: 'hub', role: 'owner' },
      { id: 't2', slug: 'otro', role: 'host' },
    ],
  })
  if (!claims) throw new Error('unreachable')

  it('resuelve el rol por slug', () => {
    expect(roleForSlug(claims, 'hub')).toBe('owner')
    expect(roleForSlug(claims, 'otro')).toBe('host')
    expect(roleForSlug(claims, 'ajeno')).toBeNull()
  })

  it('resuelve la membership por id de tenant', () => {
    expect(claimForTenantId(claims, 't2')).toEqual({ id: 't2', slug: 'otro', role: 'host' })
    expect(claimForTenantId(claims, 'nope')).toBeNull()
  })
})
