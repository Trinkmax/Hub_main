import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/tenant/current'

/**
 * True cuando el email del usuario logueado está en platform_admins.
 * Resuelve vía la RPC SECURITY DEFINER `is_platform_admin` (la tabla solo es
 * legible por admins, pero la función responde el booleano igual). cache()'d por
 * request: layout, page y nav comparten una sola resolución.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser()
  if (!user) return false
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('is_platform_admin')
  if (error) {
    console.error('[platform.isPlatformAdmin]', error.code, error.message)
    return false
  }
  return data === true
})

/** Oculta la existencia de /admin a quien no sea superadmin (notFound, no 403). */
export async function requirePlatformAdmin(): Promise<void> {
  if (!(await isPlatformAdmin())) {
    const { notFound } = await import('next/navigation')
    notFound()
  }
}
