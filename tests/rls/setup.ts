import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''

export const RLS_TESTS_ENABLED = Boolean(SERVICE_ROLE && ANON)

export function getServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Cliente anon sin sesión iniciada — para testear RPCs públicas */
export function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Crea un usuario y devuelve un cliente con sesión iniciada */
export async function createUserClient(opts: {
  email: string
  password?: string
}): Promise<{ client: SupabaseClient; userId: string; email: string }> {
  const service = getServiceClient()
  const password = opts.password ?? 'password123!'

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: opts.email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    throw new Error(`createUser failed: ${createError?.message}`)
  }

  const client = createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: opts.email,
    password,
  })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)

  return { client, userId: created.user.id, email: opts.email }
}

export async function deleteUser(userId: string) {
  const service = getServiceClient()
  await service.auth.admin.deleteUser(userId)
}

export async function createTenant(opts: { name: string; slug: string; ownerId: string }) {
  const service = getServiceClient()
  const { data: tenant, error } = await service
    .from('tenants')
    .insert({ name: opts.name, slug: opts.slug })
    .select()
    .single()
  if (error || !tenant) throw new Error(`create tenant failed: ${error?.message}`)

  await service.from('memberships').insert({
    tenant_id: tenant.id,
    user_id: opts.ownerId,
    role: 'owner',
  })
  return tenant
}

export function uniqueEmail(prefix = 'test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hub.test`
}

export function uniqueSlug(prefix = 'bar') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 40)
}
