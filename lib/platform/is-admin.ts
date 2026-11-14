import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/tenant/current'
import { readViewAs, VIEW_AS_COOKIE } from '@/lib/tenant/view-as'

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

/**
 * Superadmin que además NO está usando «Ver como» (lib/tenant/view-as.ts). Es la pregunta de
 * las pantallas del bar («¿le abro el panel que el bar tiene apagado?»): mirando el rol de otra
 * persona, tiene que ver lo mismo que esa persona. /admin y sus actions siguen con
 * `isPlatformAdmin`, que no cambia.
 */
export const actsAsPlatformAdmin = cache(async (): Promise<boolean> => {
  if (!(await isPlatformAdmin())) return false
  const user = await getCurrentUser()
  return readViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value, user?.id) === null
})

/** Oculta la existencia de /admin a quien no sea superadmin (notFound, no 403). */
export async function requirePlatformAdmin(): Promise<void> {
  if (!(await isPlatformAdmin())) {
    const { notFound } = await import('next/navigation')
    notFound()
  }
}
