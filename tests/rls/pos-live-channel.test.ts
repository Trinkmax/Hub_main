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

type JoinResult = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/** Cuánto se espera la respuesta de Realtime antes de darlo por colgado. */
const JOIN_TIMEOUT_MS = 15_000

/**
 * Intenta entrar al canal privado como lo hace la aplicación (`lib/pos/use-poke.ts`): primero le pasa al
 * socket la sesión de quien mira y después se une. Devuelve lo que contestó Realtime.
 */
async function joinPrivate(client: SupabaseClient, topic: string): Promise<JoinResult> {
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (token) await client.realtime.setAuth(token)
  const channel = client.channel(topic, { config: { private: true } })
  try {
    return await new Promise<JoinResult>((resolve) => {
      const timer = setTimeout(() => resolve('TIMED_OUT'), JOIN_TIMEOUT_MS)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          resolve(status)
        }
      })
    })
  } finally {
    await client.removeChannel(channel)
  }
}

/**
 * El canal en vivo del punto de venta (`pos:<sucursal>`) es privado: Realtime deja entrar solo a quien
 * tiene un rol en el bar de esa sucursal (política `pos_live_listen` de `realtime.messages`).
 *
 * Acá se prueba la puerta, contra el servicio de verdad: quién entra y quién se queda afuera.
 */
describeIfRls('Punto de venta — el canal en vivo es privado', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let branchA: string

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('liveChOwnerA') })
    waiterA = await createUserClient({ email: uniqueEmail('liveChWaiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('liveChOwnerB') })
    tenantA = await createTenant({
      name: 'Canal A',
      slug: uniqueSlug('canal-a'),
      ownerId: ownerA.userId,
    })
    // El otro dueño tiene su propio bar: es alguien con sesión y con rol, pero no acá.
    await createTenant({
      name: 'Canal B',
      slug: uniqueSlug('canal-b'),
      ownerId: ownerB.userId,
    })
    const service = getServiceClient()
    await service
      .from('memberships')
      .insert([{ tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' }])
    const { data, error } = await service
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('is_default', true)
      .single()
    if (error || !data) throw new Error(`default branch failed: ${error?.message}`)
    branchA = (data as { id: string }).id
  })

  afterAll(async () => {
    for (const user of [ownerA, waiterA, ownerB]) {
      if (!user) continue
      await user.client.removeAllChannels()
      await deleteUser(user.userId)
    }
  })

  it(
    'el dueño del bar entra al canal de su sucursal',
    async () => {
      expect(await joinPrivate(ownerA.client, `pos:${branchA}`)).toBe('SUBSCRIBED')
    },
    JOIN_TIMEOUT_MS + 5_000,
  )

  it(
    'el mozo también',
    async () => {
      expect(await joinPrivate(waiterA.client, `pos:${branchA}`)).toBe('SUBSCRIBED')
    },
    JOIN_TIMEOUT_MS + 5_000,
  )

  it(
    'el dueño de otro bar se queda afuera',
    async () => {
      expect(await joinPrivate(ownerB.client, `pos:${branchA}`)).toBe('CHANNEL_ERROR')
    },
    JOIN_TIMEOUT_MS + 5_000,
  )

  it(
    'sin sesión, también afuera',
    async () => {
      const anon = getAnonClient()
      try {
        expect(await joinPrivate(anon, `pos:${branchA}`)).toBe('CHANNEL_ERROR')
      } finally {
        await anon.removeAllChannels()
      }
    },
    JOIN_TIMEOUT_MS + 5_000,
  )

  it(
    'un nombre de canal que no es de una sucursal no deja entrar a nadie',
    async () => {
      expect(await joinPrivate(ownerA.client, 'pos:no-es-una-sucursal')).toBe('CHANNEL_ERROR')
      expect(await joinPrivate(ownerA.client, `otro:${branchA}`)).toBe('CHANNEL_ERROR')
    },
    2 * JOIN_TIMEOUT_MS + 5_000,
  )
})
