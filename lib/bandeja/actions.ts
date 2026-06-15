'use server'

import { z } from 'zod'
import { listMessages, type MessageRow } from '@/lib/bandeja/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

const loadOlderSchema = z.object({
  conversationId: z.string().uuid(),
  before: z.string().datetime({ offset: true }),
  limit: z.number().int().min(1).max(100).optional(),
})

export type LoadOlderResult = { ok: true; messages: MessageRow[] } | { ok: false; message: string }

/**
 * Server action: load messages older than `before` for a given conversation.
 * Validates tenant membership (owner / cashier / waiter).
 */
export async function loadOlderMessages(
  slug: string,
  conversationId: string,
  before: string,
  limit = 50,
): Promise<LoadOlderResult> {
  const parsed = loadOlderSchema.safeParse({ conversationId, before, limit })
  if (!parsed.success) return { ok: false, message: 'Parámetros inválidos.' }

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
    const messages = await listMessages(access.tenant.id, parsed.data.conversationId, {
      before: parsed.data.before,
      limit: parsed.data.limit ?? 50,
    })
    return { ok: true, messages }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, message: 'Sin permisos.' }
    }
    throw error
  }
}
