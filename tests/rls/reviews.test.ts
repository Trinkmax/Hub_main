import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — reviews', () => {
  let service: SupabaseClient
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let customerId: string
  let reviewId: string

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('ownerA') })
    ownerB = await createUserClient({ email: uniqueEmail('ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('bara'),
      ownerId: ownerA.userId,
    })
    await createTenant({ name: 'Bar B', slug: uniqueSlug('barb'), ownerId: ownerB.userId })

    const { data: cust } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+54935166${Date.now() % 100000}`,
        first_name: 'Leo',
        last_name: 'Test',
      })
      .select('id')
      .single()
    customerId = (cust as { id: string }).id

    // Reseña insertada por service (simula el flujo público submitReview).
    const { data: rev } = await service
      .from('reviews')
      .insert({
        tenant_id: tenantA.id,
        customer_id: customerId,
        rating: 5,
        comment: 'Genial',
        redirected_to_maps: true,
      })
      .select('id')
      .single()
    reviewId = (rev as { id: string }).id
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('un miembro del tenant lee sus reseñas; otro tenant no', () => {
    return Promise.all([
      ownerA.client
        .from('reviews')
        .select('id')
        .eq('tenant_id', tenantA.id)
        .then(({ data }) => {
          expect((data ?? []).map((r) => r.id)).toContain(reviewId)
        }),
      ownerB.client
        .from('reviews')
        .select('id')
        .eq('tenant_id', tenantA.id)
        .then(({ data }) => {
          expect(data ?? []).toEqual([])
        }),
    ])
  })

  it('authenticated NO puede insertar reseñas (solo service-role)', async () => {
    const { data, error } = await ownerA.client
      .from('reviews')
      .insert({ tenant_id: tenantA.id, customer_id: customerId, rating: 3 })
      .select('id')
    // RLS sin policy de insert → bloqueado (error o 0 filas).
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('anon no puede leer reseñas', async () => {
    const anon = getAnonClient()
    const { data } = await anon.from('reviews').select('id').eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('el owner puede borrar (moderación)', async () => {
    const { error } = await ownerA.client.from('reviews').delete().eq('id', reviewId)
    expect(error).toBeNull()
    const { data } = await service.from('reviews').select('id').eq('id', reviewId)
    expect(data ?? []).toEqual([])
  })
})
