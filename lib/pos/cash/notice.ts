import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAppUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email/send'
import { renderShiftCloseEmail } from '@/lib/email/templates/shift-close'
import { createServiceClient } from '@/lib/supabase/service'
import { pickPartners } from './partners'
import { buildShiftReport, shiftPlace, shiftShareText } from './report'
import type { Shift, ShiftSummary } from './types'

/**
 * El aviso de cierre de caja a los socios (trabajo `pos_shift_closed` de la cola).
 *
 * Corre en el despachador (`/api/cron/dispatch`), con la clave de servicio: quien cerró la caja no
 * participa. Lee el turno ya cerrado, arma el mismo resumen que ve un socio en la caja y se lo manda
 * por mail a cada socio del bar. Siempre con el bar de la fila a la vista (`tenant_id` en cada lectura).
 *
 * Si no hay proveedor de mail configurado, o el bar no tiene socios con mail, no es un error: el
 * resumen sigue en la caja. Solo se reintenta cuando no salió ningún mail por una falla del envío.
 */

const payloadSchema = z.object({ shift_id: z.uuid() })

type ShiftRow = {
  id: string
  tenant_id: string
  branch_id: string
  register_id: string
  service_day: string
  label: string | null
  status: 'open' | 'closed'
  is_practice: boolean
  opened_at: string
  opened_by_name: string
  opening_float_cents: number
  opening_expected_cents: number | null
  opening_note: string | null
  closed_at: string | null
  closed_by_name: string | null
  counted_cash_cents: number | null
  count_breakdown: Shift['count_breakdown']
  expected_cash_cents: number | null
  difference_cents: number | null
  leave_float_cents: number | null
  closing_note: string | null
  summary: ShiftSummary | null
}

/** Los mails de los socios del bar. Nunca se loguean. */
async function partnerEmails(service: SupabaseClient, tenantId: string): Promise<string[]> {
  const [{ data: tenant }, { data: owners }, { data: settings }, { data: grants }] =
    await Promise.all([
      service.from('tenants').select('feature_flags').eq('id', tenantId).maybeSingle(),
      service.from('memberships').select('user_id').eq('tenant_id', tenantId).eq('role', 'owner'),
      service.from('acc_settings').select('tenant_id').eq('tenant_id', tenantId).maybeSingle(),
      // `*`: el nivel del acceso («solo compras y pagos») llega con otra migración; si la columna no
      // está, todos los accesos son completos.
      service.from('acc_access').select('*').eq('tenant_id', tenantId).is('revoked_at', null),
    ])
  const flags = (tenant?.feature_flags ?? {}) as Record<string, unknown>
  const userIds = pickPartners({
    ownerIds: (owners ?? []).map((row) => String((row as { user_id: string }).user_id)),
    accountingOn: flags.accounting === true && settings !== null && settings !== undefined,
    grants: (grants ?? []).map((row) => {
      const grant = row as { user_id: string; scope?: string | null }
      return { userId: String(grant.user_id), scope: grant.scope ?? null }
    }),
  })
  const emails: string[] = []
  for (const userId of userIds) {
    const { data, error } = await service.auth.admin.getUserById(userId)
    if (error) {
      console.error('[pos.shift_notice] no se pudo leer un socio:', error.message)
      continue
    }
    const email = data.user?.email?.trim()
    if (email && !emails.includes(email)) emails.push(email)
  }
  return emails
}

export async function handleShiftClosedNotice(payload: unknown): Promise<void> {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw Object.assign(new Error('pos_shift_closed: falta shift_id'), { fatal: true })
  }
  const service = createServiceClient() as unknown as SupabaseClient

  const { data: row, error } = await service
    .from('pos_shifts')
    .select(
      'id, tenant_id, branch_id, register_id, service_day, label, status, is_practice, opened_at, opened_by_name, opening_float_cents, opening_expected_cents, opening_note, closed_at, closed_by_name, counted_cash_cents, count_breakdown, expected_cash_cents, difference_cents, leave_float_cents, closing_note, summary',
    )
    .eq('id', parsed.data.shift_id)
    .maybeSingle()
  if (error) throw new Error(`pos_shift_closed: ${error.message}`)
  const shiftRow = row as ShiftRow | null
  // Un turno que no existe, sigue abierto, es de práctica o no dejó resumen no se avisa.
  if (!shiftRow || shiftRow.status !== 'closed' || shiftRow.is_practice || !shiftRow.summary) return

  const tenantId = shiftRow.tenant_id
  const [{ data: tenant }, { data: branch }, { data: registers }] = await Promise.all([
    service.from('tenants').select('name, slug, timezone').eq('id', tenantId).maybeSingle(),
    service
      .from('branches')
      .select('name, slug')
      .eq('id', shiftRow.branch_id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    service
      .from('pos_registers')
      .select('id, name')
      .eq('branch_id', shiftRow.branch_id)
      .eq('tenant_id', tenantId)
      .eq('active', true),
  ])
  if (!tenant || !branch) return
  const bar = tenant as { name: string; slug: string; timezone: string | null }
  const place = branch as { name: string; slug: string }
  const registerList = (registers ?? []) as { id: string; name: string }[]

  const shift: Shift = {
    ...shiftRow,
    register: registerList.find((register) => register.id === shiftRow.register_id)?.name ?? 'Caja',
  }
  const report = buildShiftReport({
    branchName: place.name,
    shift,
    summary: shiftRow.summary,
    timeZone: bar.timezone || 'America/Argentina/Cordoba',
    registersCount: Math.max(1, registerList.length),
  })

  const emails = await partnerEmails(service, tenantId)
  if (emails.length === 0) return

  const appUrl = await getAppUrl()
  const rendered = await renderShiftCloseEmail({
    barName: bar.name,
    place: shiftPlace(place.name, shift, Math.max(1, registerList.length)),
    report,
    shiftUrl: `${appUrl}/${bar.slug}/salon/caja?sucursal=${encodeURIComponent(place.slug)}&turno=${shift.id}`,
    shareUrl: `https://wa.me/?text=${encodeURIComponent(shiftShareText(report, { bold: true }))}`,
  })

  let sent = 0
  let failed = 0
  let noProvider = false
  for (const to of emails) {
    const result = await sendEmail({ to, ...rendered, tag: 'pos_shift_closed' })
    if (result.ok) sent += 1
    else if (result.reason === 'send_failed') failed += 1
    else noProvider = true
  }
  // Sin proveedor de mail no tiene sentido reintentar: el resumen está en la caja.
  if (noProvider) return
  if (sent === 0 && failed > 0) throw new Error('pos_shift_closed: no salió ningún mail')
}
