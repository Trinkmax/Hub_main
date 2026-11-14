'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireTenantAccess } from './access'
import { TenantNotFoundError, UnauthenticatedError } from './errors'
import { homePathForRole } from './roles'
import { isTenantRole } from './types'
import { encodeViewAs, VIEW_AS_COOKIE, VIEW_AS_MAX_AGE_SECONDS } from './view-as'

export type ViewAsActionResult = { ok: false; error: string }

const inputSchema = z.object({
  slug: z.string().trim().min(1).max(64),
  role: z.string().max(32),
})

/**
 * «Ver como» (lib/tenant/view-as.ts): mirar el panel con otro rol, o volver a dueño con
 * `role = 'owner'`. Solo un superadmin que es dueño del bar. No toca la base: escribe o borra
 * una cookie y lleva al inicio de ese rol.
 *
 * Si sale bien no vuelve (redirige); si no, devuelve el error para un toast.
 */
export async function setViewAs(slug: string, role: string): Promise<ViewAsActionResult> {
  const parsed = inputSchema.safeParse({ slug, role })
  if (!parsed.success || !isTenantRole(parsed.data.role)) {
    return { ok: false, error: 'Ese rol no existe.' }
  }
  const target = parsed.data.role

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(parsed.data.slug)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Se cerró tu sesión. Volvé a entrar y probá de nuevo.' }
    }
    if (error instanceof TenantNotFoundError) {
      return { ok: false, error: 'No encontramos ese bar.' }
    }
    console.error('[view-as.set]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, error: 'No pudimos cambiar de rol. Probá de nuevo.' }
  }

  if (!access.canViewAs) {
    return {
      ok: false,
      error: 'Solo un superadmin que es dueño del bar puede mirar el panel con otro rol.',
    }
  }

  const store = await cookies()
  if (target === 'owner') {
    store.delete(VIEW_AS_COOKIE)
  } else {
    store.set(VIEW_AS_COOKIE, encodeViewAs(access.user.id, target), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: VIEW_AS_MAX_AGE_SECONDS,
    })
  }

  redirect(homePathForRole(target, access.tenant.slug))
}
