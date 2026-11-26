import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/** Con forma de servicio de push de verdad; en estas pruebas nadie le escribe. */
const endpoint = (tag: string) =>
  `https://fcm.googleapis.com/fcm/send/rls-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const KEYS = { p_p256dh: 'B'.repeat(87), p_auth: 'a'.repeat(22) }

/**
 * Avisos de cocina (`20261126182818_pos_estaciones_mozos_avisos`): las suscripciones push y la bandeja
 * de avisos son de cada persona. Nadie las escribe a mano: se anota y se da de baja por las funciones,
 * y las claves para firmar los envíos no las lee nadie con sesión.
 */
describeIfRls('Avisos de cocina — las suscripciones push son de cada persona', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerA2: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string }
  const phone = endpoint('celu')

  const seenBy = async (who: { client: (typeof ownerA)['client'] }, where: string) => {
    const { data, error } = await who.client
      .from('push_subscriptions')
      .select('id, user_id, tenant_id, events')
      .eq('endpoint', where)
    if (error) throw new Error(`select failed: ${error.message}`)
    return (data ?? []) as { id: string; user_id: string; tenant_id: string; events: string[] }[]
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('avisosA') })
    ownerA2 = await createUserClient({ email: uniqueEmail('avisosA2') })
    ownerB = await createUserClient({ email: uniqueEmail('avisosB') })
    tenantA = await createTenant({
      name: 'Avisos A',
      slug: uniqueSlug('avisos-a'),
      ownerId: ownerA.userId,
    })
    // Otra persona del mismo bar, y alguien con su propio bar.
    const { error } = await getServiceClient()
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: ownerA2.userId, role: 'owner' })
    if (error) throw new Error(`membership failed: ${error.message}`)
    await createTenant({
      name: 'Avisos B',
      slug: uniqueSlug('avisos-b'),
      ownerId: ownerB.userId,
    })
  })

  afterAll(async () => {
    for (const user of [ownerA, ownerA2, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  })

  it('anotar un navegador lo deja a nombre de quien lo activa, y solo esa persona lo ve', async () => {
    const { data: id, error } = await ownerA.client.rpc('push_subscribe', {
      p_tenant_id: tenantA.id,
      p_endpoint: phone,
      ...KEYS,
    })
    expect(error).toBeNull()
    expect(typeof id).toBe('string')

    const mine = await seenBy(ownerA, phone)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.user_id).toBe(ownerA.userId)
    expect(mine[0]?.tenant_id).toBe(tenantA.id)
    expect([...(mine[0]?.events ?? [])].sort()).toEqual(['preparing', 'ready'])

    // Ni un compañero del mismo bar ni alguien de otro bar.
    expect(await seenBy(ownerA2, phone)).toHaveLength(0)
    expect(await seenBy(ownerB, phone)).toHaveLength(0)
  })

  it('nadie escribe la tabla a mano', async () => {
    const insert = await ownerA.client.from('push_subscriptions').insert({
      tenant_id: tenantA.id,
      user_id: ownerA.userId,
      endpoint: endpoint('a-mano'),
      p256dh: KEYS.p_p256dh,
      auth_key: KEYS.p_auth,
    })
    expect(insert.error).not.toBeNull()

    const update = await ownerA.client
      .from('push_subscriptions')
      .update({ user_id: ownerA2.userId })
      .eq('endpoint', phone)
    expect(update.error).not.toBeNull()

    const remove = await ownerA.client.from('push_subscriptions').delete().eq('endpoint', phone)
    expect(remove.error).not.toBeNull()

    // Sigue ahí, y sigue siendo de quien lo anotó.
    expect((await seenBy(ownerA, phone))[0]?.user_id).toBe(ownerA.userId)
  })

  it('no se puede anotar un navegador en un bar ajeno, ni con una dirección que no sea https', async () => {
    const foreign = await ownerB.client.rpc('push_subscribe', {
      p_tenant_id: tenantA.id,
      p_endpoint: endpoint('ajeno'),
      ...KEYS,
    })
    expect(foreign.error?.code).toBe('42501')

    const plain = await ownerA.client.rpc('push_subscribe', {
      p_tenant_id: tenantA.id,
      p_endpoint: 'http://fcm.googleapis.com/fcm/send/sin-https',
      ...KEYS,
    })
    expect(plain.error?.code).toBe('22023')

    const odd = await ownerA.client.rpc('push_subscribe', {
      p_tenant_id: tenantA.id,
      p_endpoint: endpoint('paso-raro'),
      ...KEYS,
      p_events: ['served'],
    })
    expect(odd.error?.code).toBe('22023')
  })

  it('dar de baja: solo quien tiene el navegador a su nombre', async () => {
    const other = await ownerA2.client.rpc('push_unsubscribe', { p_endpoint: phone })
    expect(other.error).toBeNull()
    expect(other.data).toBe(false)
    expect(await seenBy(ownerA, phone)).toHaveLength(1)
  })

  it('el celular pasa de mano: queda a nombre del último que lo activó', async () => {
    const { error } = await ownerA2.client.rpc('push_subscribe', {
      p_tenant_id: tenantA.id,
      p_endpoint: phone,
      ...KEYS,
      p_events: ['ready'],
    })
    expect(error).toBeNull()

    expect(await seenBy(ownerA, phone)).toHaveLength(0)
    const now = await seenBy(ownerA2, phone)
    expect(now).toHaveLength(1)
    expect(now[0]?.events).toEqual(['ready'])

    const mine = await ownerA2.client.rpc('push_unsubscribe', { p_endpoint: phone })
    expect(mine.error).toBeNull()
    expect(mine.data).toBe(true)
    expect(await seenBy(ownerA2, phone)).toHaveLength(0)
  })

  it('las claves para firmar los envíos no las lee ni las cambia nadie con sesión', async () => {
    const read = await ownerA.client.rpc('push_vapid_keys')
    expect(read.error).not.toBeNull()
    const write = await ownerA.client.rpc('push_vapid_init', {
      p_public: 'B'.repeat(87),
      p_private: 'k'.repeat(43),
    })
    expect(write.error).not.toBeNull()
  })

  it('la bandeja de avisos se lee (la propia) pero no se escribe a mano', async () => {
    const read = await ownerA.client.from('pos_notices').select('id').limit(5)
    expect(read.error).toBeNull()
    expect(read.data ?? []).toHaveLength(0)

    const write = await ownerA.client.from('pos_notices').insert({
      tenant_id: tenantA.id,
      branch_id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      user_id: ownerA.userId,
      kind: 'ready',
    })
    expect(write.error).not.toBeNull()
  })
})
