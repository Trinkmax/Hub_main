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

/**
 * El tablero estilo Monday (migración 20261115230118_marketing_tasks_board_v2):
 * dueños, Contenido (`editor`) y anfitriona (`host`) trabajan las tareas; los
 * grupos los arma el dueño; a una tarea solo se suma gente que trabaja el
 * tablero de ESE bar; un mozo no ve nada; otro bar tampoco.
 */
describeIfRls('RLS — tablero de tareas estilo Monday', () => {
  let service: SupabaseClient
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let hostA: Awaited<ReturnType<typeof createUserClient>>
  let editorA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let groupId: string
  let taskId: string

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('mtb-ownerA') })
    hostA = await createUserClient({ email: uniqueEmail('mtb-hostA') })
    editorA = await createUserClient({ email: uniqueEmail('mtb-editorA') })
    waiterA = await createUserClient({ email: uniqueEmail('mtb-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('mtb-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Tablero A',
      slug: uniqueSlug('mtba'),
      ownerId: ownerA.userId,
    })
    // El bar B solo existe para que su dueño sea «de otro bar».
    await createTenant({
      name: 'Bar Tablero B',
      slug: uniqueSlug('mtbb'),
      ownerId: ownerB.userId,
    })

    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: hostA.userId, role: 'host' },
      { tenant_id: tenantA.id, user_id: editorA.userId, role: 'editor' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    const { data: group } = await service
      .from('marketing_task_groups')
      .insert({ tenant_id: tenantA.id, name: 'Eventos', color: 'forest', position: 1 })
      .select('id')
      .single()
    groupId = (group as { id: string }).id

    const { data: task } = await service
      .from('marketing_tasks')
      .insert({
        tenant_id: tenantA.id,
        group_id: groupId,
        title: 'Diseñar el flyer de la noche de tacos',
        created_by: ownerA.userId,
      })
      .select('id')
      .single()
    taskId = (task as { id: string }).id
  })

  afterAll(async () => {
    for (const user of [ownerA, hostA, editorA, waiterA, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  })

  it('la anfitriona y Contenido ven el tablero de su bar', async () => {
    for (const user of [hostA, editorA]) {
      const tasks = await user.client.from('marketing_tasks').select('id')
      expect((tasks.data ?? []).map((row) => row.id)).toContain(taskId)
      const groups = await user.client.from('marketing_task_groups').select('id')
      expect((groups.data ?? []).map((row) => row.id)).toContain(groupId)
    }
  })

  it('un mozo del mismo bar y el dueño de otro bar no ven nada', async () => {
    for (const user of [waiterA, ownerB]) {
      for (const table of [
        'marketing_task_groups',
        'marketing_tasks',
        'marketing_task_people',
        'marketing_task_updates',
        'marketing_task_files',
      ] as const) {
        const { data } = await user.client.from(table).select('*').eq('tenant_id', tenantA.id)
        expect(data ?? [], `${table}`).toEqual([])
      }
    }
  })

  it('los grupos los arma el dueño: la anfitriona y Contenido no', async () => {
    for (const user of [hostA, editorA]) {
      const { error } = await user.client
        .from('marketing_task_groups')
        .insert({ tenant_id: tenantA.id, name: 'Intento', color: 'sky' })
        .select('id')
      expect(error).not.toBeNull()
    }
    const { error } = await ownerA.client
      .from('marketing_task_groups')
      .insert({ tenant_id: tenantA.id, name: 'Redes', color: 'violet', position: 2 })
      .select('id')
    expect(error).toBeNull()
  })

  it('Contenido crea una tarea y la anfitriona deja una actualización', async () => {
    const created = await editorA.client
      .from('marketing_tasks')
      .insert({
        tenant_id: tenantA.id,
        group_id: groupId,
        title: 'Reel del sushi',
        created_by: editorA.userId,
      })
      .select('id')
      .single()
    expect(created.error).toBeNull()

    const update = await hostA.client
      .from('marketing_task_updates')
      .insert({
        tenant_id: tenantA.id,
        task_id: taskId,
        author_id: hostA.userId,
        body: 'Te dejo las fotos',
      })
      .select('id')
      .single()
    expect(update.error).toBeNull()

    // Nadie escribe a nombre de otro.
    const forged = await hostA.client
      .from('marketing_task_updates')
      .insert({
        tenant_id: tenantA.id,
        task_id: taskId,
        author_id: ownerA.userId,
        body: 'Soy el dueño',
      })
      .select('id')
    expect(forged.error).not.toBeNull()
  })

  it('a una tarea se suma gente del tablero de ese bar, nunca un mozo', async () => {
    const host = await ownerA.client
      .from('marketing_task_people')
      .insert({ tenant_id: tenantA.id, task_id: taskId, user_id: hostA.userId, role: 'involved' })
      .select('id')
    expect(host.error).toBeNull()

    const waiter = await ownerA.client
      .from('marketing_task_people')
      .insert({ tenant_id: tenantA.id, task_id: taskId, user_id: waiterA.userId, role: 'involved' })
      .select('id')
    expect(waiter.error).not.toBeNull()

    const otherBar = await ownerA.client
      .from('marketing_task_people')
      .insert({
        tenant_id: tenantA.id,
        task_id: taskId,
        user_id: ownerB.userId,
        role: 'responsible',
      })
      .select('id')
    expect(otherBar.error).not.toBeNull()
  })

  it('nadie se adueña de una tarea ajena para borrarla (candado del 15/11/2026)', async () => {
    await hostA.client
      .from('marketing_tasks')
      .update({ created_by: hostA.userId, completed_by: hostA.userId })
      .eq('id', taskId)
    const { data: after } = await service
      .from('marketing_tasks')
      .select('created_by, completed_by')
      .eq('id', taskId)
      .single()
    expect(after?.created_by).toBe(ownerA.userId)
    expect(after?.completed_by).toBeNull()

    const sneaky = await hostA.client
      .from('marketing_tasks')
      .insert({
        tenant_id: tenantA.id,
        group_id: groupId,
        title: 'A nombre del dueño',
        created_by: ownerA.userId,
      })
      .select('created_by')
      .single()
    expect(sneaky.data?.created_by).toBe(hostA.userId)
  })

  it('borra una tarea el dueño o quien la creó', async () => {
    const byHost = await hostA.client.from('marketing_tasks').delete().eq('id', taskId).select('id')
    expect(byHost.data ?? []).toEqual([])

    const byOwner = await ownerA.client
      .from('marketing_tasks')
      .delete()
      .eq('id', taskId)
      .select('id')
    expect((byOwner.data ?? []).map((row) => row.id)).toEqual([taskId])
  })

  it('anon no llega a ninguna tabla del tablero', async () => {
    const anon = getAnonClient()
    for (const table of [
      'marketing_task_groups',
      'marketing_task_people',
      'marketing_task_updates',
      'marketing_task_files',
    ] as const) {
      const { data, error } = await anon.from(table).select('*')
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    }
  })
})
