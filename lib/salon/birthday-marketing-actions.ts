'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  BIRTHDAY_MARKETING_DB_SELECT,
  BIRTHDAY_MARKETING_UNREACHABLE,
  type BirthdayMarketingActionState,
  type BirthdayMarketingDbRow,
  birthdayMarketingFieldErrors,
  deleteBirthdayMarketingSchema,
  monthColumn,
  type SaveBirthdayMarketingInput,
  saveBirthdayMarketingSchema,
  toBirthdayMarketingDbFields,
  toBirthdayMarketingRow,
} from './birthday-marketing-schemas'
import { getManagerForUser } from './queries'

/**
 * Pauta de cumpleaños de «Cómo nos fue» (una fila por mes): guardar y borrar.
 *
 * Owner y nadie más, igual que la RLS (`bm_owner_all`) y que la page: es plata
 * del bar. Ninguna escribe a ciegas, con el mismo criterio que la pauta de
 * eventos:
 *
 * - El ALTA es un `insert` pelado. Si otro dueño cargó el mismo mes un segundo
 *   antes, el unique `bm_one_per_month` tira 23505 y se devuelve `stale`.
 * - La EDICIÓN y el BORRADO van filtrados por el `updated_at` que el dueño tenía
 *   en pantalla: si alguien la cambió en el medio, vuelven 0 filas y es `stale`.
 *
 * La nota es texto libre: no se loguea ni se audita.
 */

const COMO_NOS_FUE_PATH = (slug: string) => `/${slug}/estadisticas/como-nos-fue`

const FORBIDDEN = 'No tenés permiso para esa acción.'
const INVALID = 'Revisá los números de la pauta.'
const SAVE_STALE =
  'Otro dueño cambió esta pauta recién. Ya ves sus números: revisalos y guardá de nuevo.'
const DELETE_STALE = 'Otro dueño cambió esta pauta recién. Recargá para ver sus números.'

type Failure = Extract<BirthdayMarketingActionState, { ok: false }>
type PgError = { code?: string; message: string }

function fail(code: Failure['code'], message: string): Failure {
  return { ok: false, code, message }
}

type OwnerAuth = { ok: true; tenantId: string; userId: string } | { ok: false; state: Failure }

async function authorizeOwner(slug: unknown, op: string): Promise<OwnerAuth> {
  if (typeof slug !== 'string' || slug.length === 0) {
    return { ok: false, state: fail('forbidden', FORBIDDEN) }
  }
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { ok: true, tenantId: tenant.id, userId: user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, state: fail('forbidden', FORBIDDEN) }
    }
    console.error(`[birthday-marketing.${op}.auth]`, error instanceof Error ? error.message : error)
    return { ok: false, state: fail('error', BIRTHDAY_MARKETING_UNREACHABLE.save) }
  }
}

function writeFailure(op: string, error: PgError, fallback: string): Failure {
  if (error.code === '42501') return fail('forbidden', FORBIDDEN)
  console.error(`[birthday-marketing.${op}]`, error.code, error.message)
  return fail('error', fallback)
}

/** El nombre de quien carga. Si falla, la pauta se guarda igual y sin firma. */
async function loadManagerName(tenantId: string, userId: string): Promise<string | null> {
  try {
    return (await getManagerForUser({ tenantId, userId }))?.display_name ?? null
  } catch (error) {
    console.error(
      '[birthday-marketing.managerName]',
      error instanceof Error ? error.message : 'lectura fallida',
    )
    return null
  }
}

function auditNumbers(row: BirthdayMarketingDbRow) {
  return {
    month: row.month,
    ad_spend_usd_cents: Number(row.ad_spend_usd_cents),
    messages: row.messages === null ? null : Number(row.messages),
    reach: row.reach === null ? null : Number(row.reach),
  }
}

export async function saveBirthdayMarketing(
  slug: string,
  input: SaveBirthdayMarketingInput,
): Promise<BirthdayMarketingActionState> {
  const auth = await authorizeOwner(slug, 'save')
  if (!auth.ok) return auth.state

  const parsed = saveBirthdayMarketingSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = birthdayMarketingFieldErrors(parsed.error)
    const first = Object.values(fieldErrors)[0]
    return {
      ok: false,
      code: 'invalid',
      message: first ?? parsed.error.issues[0]?.message ?? INVALID,
      fieldErrors,
    }
  }
  const values = parsed.data
  const fields = toBirthdayMarketingDbFields(values)
  const month = monthColumn(values.ym)

  const supabase = await createClient()
  const namePromise = loadManagerName(auth.tenantId, auth.userId)
  let saved: BirthdayMarketingDbRow

  if (values.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from('birthday_marketing')
      .insert({
        tenant_id: auth.tenantId,
        month,
        ...fields,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select(BIRTHDAY_MARKETING_DB_SELECT)
      .single()
    if (error) {
      if (error.code === '23505') return fail('stale', SAVE_STALE)
      return writeFailure('save.insert', error, BIRTHDAY_MARKETING_UNREACHABLE.save)
    }
    saved = data as BirthdayMarketingDbRow
  } else {
    const { data, error } = await supabase
      .from('birthday_marketing')
      .update({ ...fields, updated_by: auth.userId })
      .eq('tenant_id', auth.tenantId)
      .eq('month', month)
      .eq('updated_at', values.expectedUpdatedAt)
      .select(BIRTHDAY_MARKETING_DB_SELECT)
      .maybeSingle()
    if (error) return writeFailure('save.update', error, BIRTHDAY_MARKETING_UNREACHABLE.save)
    // 0 filas: otro dueño la editó (cambió `updated_at`) o la borró.
    if (!data) return fail('stale', SAVE_STALE)
    saved = data as BirthdayMarketingDbRow
  }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'birthday_marketing.saved',
    entity: 'birthday_marketing',
    payload: { ...auditNumbers(saved), had_row: values.expectedUpdatedAt !== null },
  })

  revalidatePath(COMO_NOS_FUE_PATH(slug))
  return { ok: true, row: toBirthdayMarketingRow(saved, await namePromise) }
}

/** Borra la pauta de un mes, solo si sigue siendo la versión que el dueño vio. */
export async function deleteBirthdayMarketing(
  slug: string,
  ym: string,
  expectedUpdatedAt: string,
): Promise<BirthdayMarketingActionState> {
  const auth = await authorizeOwner(slug, 'delete')
  if (!auth.ok) return auth.state

  const parsed = deleteBirthdayMarketingSchema.safeParse({ ym, expectedUpdatedAt })
  if (!parsed.success) return fail('invalid', parsed.error.issues[0]?.message ?? INVALID)

  const supabase = await createClient()
  // `delete … returning`: lo que va al audit es EXACTAMENTE la fila borrada.
  const { data, error } = await supabase
    .from('birthday_marketing')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('month', monthColumn(parsed.data.ym))
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select(BIRTHDAY_MARKETING_DB_SELECT)
  if (error) return writeFailure('delete', error, BIRTHDAY_MARKETING_UNREACHABLE.delete)
  const deleted = ((data ?? []) as BirthdayMarketingDbRow[])[0]
  if (!deleted) return fail('stale', DELETE_STALE)

  // La plata borrada queda en `audit_log`: la pantalla la pierde, la historia no.
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'birthday_marketing.deleted',
    entity: 'birthday_marketing',
    payload: { ...auditNumbers(deleted), had_notes: deleted.notes !== null },
  })

  revalidatePath(COMO_NOS_FUE_PATH(slug))
  return { ok: true, row: null }
}
