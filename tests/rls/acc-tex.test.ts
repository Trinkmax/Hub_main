import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

/**
 * Tex (migraciones 20261105120000 y 120100): la charla es de quien la tuvo; las acciones las ve quien
 * lee Administración; un mensaje no se edita ni se borra; una charla no se borra; nada entre bares y
 * nada para anónimos. Corre contra el Supabase local del job `rls`.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

type UserCtx = Awaited<ReturnType<typeof createUserClient>>

async function createAccountingTenant(name: string, ownerId: string): Promise<string> {
  const service = getServiceClient()
  const { data, error } = await service
    .from('tenants')
    .insert({ name, slug: uniqueSlug('acc-tex'), feature_flags: { accounting: true } })
    .select('id')
    .single()
  if (error || !data) throw new Error(`create tenant failed: ${error?.message}`)
  const tenantId = (data as { id: string }).id
  const { error: memberError } = await service
    .from('memberships')
    .insert({ tenant_id: tenantId, user_id: ownerId, role: 'owner' })
  if (memberError) throw new Error(`create membership failed: ${memberError.message}`)
  // Quien crea el bar administra los accesos de Administración.
  const { error: accessError } = await service.from('acc_access').insert({
    tenant_id: tenantId,
    user_id: ownerId,
    display_name: 'Dueño de prueba',
    is_admin: true,
    source: 'platform',
  })
  if (accessError) throw new Error(`create access failed: ${accessError.message}`)
  return tenantId
}

describeIfRls('Tex', () => {
  let owner: UserCtx
  let stranger: UserCtx
  let tenantId: string
  let threadId: string
  const actionId = randomUUID()

  const asOwner = (): SupabaseClient => owner.client

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('tex-owner') })
    stranger = await createUserClient({ email: uniqueEmail('tex-otro') })
    tenantId = await createAccountingTenant('Bar de Tex', owner.userId)
    await createAccountingTenant('Otro bar', stranger.userId)
    const { data, error } = await asOwner()
      .from('acc_tex_threads')
      .insert({ tenant_id: tenantId, user_id: owner.userId, title: 'hola' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`create thread failed: ${error?.message}`)
    threadId = (data as { id: string }).id
    await asOwner()
      .from('acc_tex_messages')
      .insert({
        thread_id: threadId,
        tenant_id: tenantId,
        user_id: owner.userId,
        seq: 0,
        role: 'user',
        content: [{ type: 'text', text: 'hola' }],
      })
    await asOwner().from('acc_tex_actions').insert({
      id: actionId,
      thread_id: threadId,
      tenant_id: tenantId,
      user_id: owner.userId,
      tool_use_id: 'tu_1',
      kind: 'compra',
      payload: {},
      ticket: {},
    })
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('tenants').delete().eq('id', tenantId)
    await deleteUser(owner.userId)
    await deleteUser(stranger.userId)
  })

  it('quien charló ve su charla', async () => {
    const { data } = await asOwner().from('acc_tex_messages').select('id').eq('thread_id', threadId)
    expect(data).toHaveLength(1)
  })

  it('el mensaje guarda el JSON tal cual: el orden de las claves no cambia', async () => {
    const { data } = await asOwner()
      .from('acc_tex_messages')
      .select('content')
      .eq('thread_id', threadId)
      .single()
    expect(JSON.stringify((data as { content: unknown }).content)).toBe(
      '[{"type":"text","text":"hola"}]',
    )
  })

  it('un mensaje no se edita ni se borra', async () => {
    const update = await asOwner()
      .from('acc_tex_messages')
      .update({ seq: 9 })
      .eq('thread_id', threadId)
    expect(update.error?.code).toBe('42501')
    const remove = await asOwner().from('acc_tex_messages').delete().eq('thread_id', threadId)
    expect(remove.error?.code).toBe('42501')
  })

  it('una charla y una acción no se borran', async () => {
    const thread = await asOwner().from('acc_tex_threads').delete().eq('id', threadId)
    expect(thread.error?.code).toBe('42501')
    const action = await asOwner().from('acc_tex_actions').delete().eq('id', actionId)
    expect(action.error?.code).toBe('42501')
  })

  it('otro bar no ve nada y no puede escribir en este', async () => {
    const threads = await stranger.client.from('acc_tex_threads').select('id').eq('id', threadId)
    expect(threads.data).toEqual([])
    const messages = await stranger.client
      .from('acc_tex_messages')
      .select('id')
      .eq('thread_id', threadId)
    expect(messages.data).toEqual([])
    const actions = await stranger.client.from('acc_tex_actions').select('id').eq('id', actionId)
    expect(actions.data).toEqual([])
    const insert = await stranger.client
      .from('acc_tex_threads')
      .insert({ tenant_id: tenantId, user_id: stranger.userId })
    expect(insert.error?.code).toBe('42501')
    const update = await stranger.client
      .from('acc_tex_actions')
      .update({ status: 'done' })
      .eq('id', actionId)
      .select('id')
    expect(update.data).toEqual([])
  })

  it('nadie crea una charla a nombre de otro', async () => {
    const insert = await stranger.client
      .from('acc_tex_threads')
      .insert({ tenant_id: tenantId, user_id: owner.userId })
    expect(insert.error?.code).toBe('42501')
  })

  it('un anónimo no tiene permiso', async () => {
    const anon = getAnonClient()
    const { error } = await anon.from('acc_tex_threads').select('id').limit(1)
    expect(error?.code).toBe('42501')
  })
})
