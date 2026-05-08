import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseClientEnv } from '@/lib/env'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = getSupabaseClientEnv()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component context: cookies are read-only.
          // The proxy/middleware refreshes the session, so this is safe to ignore here.
        }
      },
    },
  })
}
