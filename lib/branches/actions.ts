'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'
import { requireTenantAccess } from '@/lib/tenant/access'
import { TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant/errors'
import {
  BRANCH_COOKIE_MAX_AGE,
  branchCookieName,
  nextBranchCookie,
  parseBranchCookie,
  serializeBranchCookie,
} from './cookie'
import { getBranchPulses } from './pulse'
import type { BranchPulses } from './pulse-line'

/** Cómo viene hoy cada sucursal de esta persona: lo pide el selector de arriba al abrirse. */
export async function fetchBranchPulses(slug: string): Promise<BranchPulses | null> {
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 80) return null
  try {
    const access = await requireTenantAccess(slug)
    if (access.branches.length < 2) return null
    return await getBranchPulses(
      access.tenant.id,
      access.branches.map((branch) => branch.id),
    )
  } catch (error) {
    if (!(error instanceof UnauthenticatedError) && !(error instanceof TenantNotFoundError)) {
      console.error(
        '[branches.fetchBranchPulses]',
        error instanceof Error ? error.message : 'unknown',
      )
    }
    return null
  }
}

/**
 * Cambiar la sucursal que se mira (el selector de arriba, la entrada, ⌘K) o en la que trabaja este dispositivo
 * (el salón). Vale para cualquier bar y cualquier rol: las reservas, los eventos y las compras se miran por sucursal
 * aunque el bar no tenga el punto de venta. Solo deja elegir sucursales que la persona ve.
 *
 * No hace `revalidatePath`: guardar una cookie desde una acción ya invalida lo que el navegador tenía guardado, y la
 * pantalla se vuelve a pedir con `router.refresh()`.
 */

const input = z.object({
  slug: z.string().min(1).max(80),
  choice: z.union([z.literal('all'), z.uuid()]),
  surface: z.enum(['view', 'device']),
})

export type SetBranchScopeResult = { ok: true } | { ok: false; message: string }

export async function setBranchScope(
  slug: string,
  choice: string,
  surface: 'view' | 'device' = 'view',
): Promise<SetBranchScopeResult> {
  const parsed = input.safeParse({ slug, choice, surface })
  if (!parsed.success) return { ok: false, message: 'Esa sucursal no existe.' }

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(parsed.data.slug)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: 'Se cerró tu sesión. Entrá de nuevo.' }
    }
    if (error instanceof TenantNotFoundError)
      return { ok: false, message: 'No tenés acceso a este bar.' }
    console.error('[branches.setBranchScope]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, message: 'No pude cambiar de sucursal. Probá de nuevo.' }
  }

  const { branches } = access
  if (parsed.data.choice === 'all') {
    if (parsed.data.surface === 'device' || branches.length < 2) {
      return { ok: false, message: 'Acá hay que elegir una sucursal.' }
    }
  } else if (!branches.some((branch) => branch.id === parsed.data.choice)) {
    return { ok: false, message: 'Esa sucursal no está entre las tuyas.' }
  }

  const store = await cookies()
  const name = branchCookieName(access.tenant.id)
  const next = nextBranchCookie(
    parseBranchCookie(store.get(name)?.value),
    parsed.data.choice,
    parsed.data.surface,
  )
  store.set(name, serializeBranchCookie(next), {
    path: '/',
    maxAge: BRANCH_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
  return { ok: true }
}
