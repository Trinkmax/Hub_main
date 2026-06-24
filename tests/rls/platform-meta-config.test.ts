import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('platform_meta_config — sólo superadmins', () => {
  let admin: Awaited<ReturnType<typeof createUserClient>>
  let plain: Awaited<ReturnType<typeof createUserClient>>
  const adminEmail = uniqueEmail('pmc-admin')

  beforeAll(async () => {
    const service = getServiceClient()
    admin = await createUserClient({ email: adminEmail })
    plain = await createUserClient({ email: uniqueEmail('pmc-plain') })
    await service.from('platform_admins').insert({ email: adminEmail })
    // Sembrar la fila singleton vía service_role.
    await service
      .from('platform_meta_config')
      .upsert({ id: true, app_id: 'SEED' }, { onConflict: 'id' })
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('platform_admins').delete().eq('email', adminEmail)
    await service.from('platform_meta_config').delete().eq('id', true)
    await deleteUser(admin.userId)
    await deleteUser(plain.userId)
  })

  it('un usuario común NO ve la fila', async () => {
    const { data } = await plain.client
      .from('platform_meta_config')
      .select('app_id')
      .eq('id', true)
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('un usuario común NO puede escribir', async () => {
    const { error } = await plain.client
      .from('platform_meta_config')
      .upsert({ id: true, app_id: 'HACK' }, { onConflict: 'id' })
    expect(error).not.toBeNull()
  })

  it('un superadmin SÍ ve y escribe', async () => {
    const { data: seen } = await admin.client
      .from('platform_meta_config')
      .select('app_id')
      .eq('id', true)
      .maybeSingle()
    expect(seen?.app_id).toBe('SEED')
    const { error } = await admin.client
      .from('platform_meta_config')
      .update({ app_id: 'ADMIN_SET' })
      .eq('id', true)
    expect(error).toBeNull()
  })
})
