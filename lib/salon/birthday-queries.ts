import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  BIRTHDAY_MARKETING_DB_SELECT,
  type BirthdayMarketingDbRow,
  monthColumn,
  toBirthdayMarketingRow,
} from './birthday-marketing-schemas'
import {
  type BirthdayMarketingRow,
  type BirthdayReservationRow,
  buildMonthBirthdayReport,
  type MonthBirthdayReport,
} from './birthdays-report'
import { cordobaDayStartUtc } from './date-presets'
import { EVENTS_REPORT_MAX_ROWS, getManagerForUser } from './queries'

const YM_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/

const BIRTHDAY_ROW_SELECT =
  'id, reservation_date, created_at, status, estimated_guests, actual_guests, scheduled_event_id'

/** `2026-09` → `2026-10`. */
function nextYM(ym: string): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * La pauta de cumpleaños de un mes, con el nombre de quien la cargó. Si la
 * lectura del nombre falla, la pauta se muestra igual y sin firma: el nombre es
 * un adorno y no vale tumbar el reporte por él (mismo criterio que la pauta de
 * eventos).
 */
export async function getBirthdayMarketing(opts: {
  tenantId: string
  ym: string
}): Promise<BirthdayMarketingRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('birthday_marketing')
    .select(BIRTHDAY_MARKETING_DB_SELECT)
    .eq('tenant_id', opts.tenantId)
    .eq('month', monthColumn(opts.ym))
    .maybeSingle()
  if (error) throw error
  const raw = data as BirthdayMarketingDbRow | null
  if (!raw) return null

  let name: string | null = null
  if (raw.updated_by) {
    try {
      name =
        (await getManagerForUser({ tenantId: opts.tenantId, userId: raw.updated_by }))
          ?.display_name ?? null
    } catch (err) {
      console.error(
        '[salon.getBirthdayMarketing.name]',
        err instanceof Error ? err.message : 'lectura fallida',
      )
    }
  }
  return toBirthdayMarketingRow(raw, name)
}

/**
 * La pestaña «Cumpleaños» de un mes. Tres lecturas en paralelo:
 *
 * - los cumples con FECHA de festejo en el mes (caídos incluidos: se cuentan
 *   aparte), para el calendario y los totales;
 * - los cumples RESERVADOS en el mes (`created_at` en el calendario del bar),
 *   para la fecha que sean: contra esto se mide la pauta (decisión del dueño);
 * - la pauta de cumpleaños del mes.
 *
 * `ym` llega validado por la page; si no, se corta acá antes de armar un rango
 * que Postgres rebotaría.
 */
export async function getMonthBirthdayReport(opts: {
  tenantId: string
  /** `YYYY-MM`. */
  ym: string
  /** Hoy en el calendario del bar. */
  today: string
}): Promise<MonthBirthdayReport> {
  if (!YM_RE.test(opts.ym)) throw new Error('invalid_ym')
  const year = Number(opts.ym.slice(0, 4))
  const month = Number(opts.ym.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const from = `${opts.ym}-01`
  const to = `${opts.ym}-${String(lastDay).padStart(2, '0')}`

  const supabase = await createClient()
  const [celebratedRes, bookedRes, marketing] = await Promise.all([
    supabase
      .from('salon_reservations')
      .select(BIRTHDAY_ROW_SELECT)
      .eq('tenant_id', opts.tenantId)
      .eq('kind', 'birthday')
      .gte('reservation_date', from)
      .lte('reservation_date', to)
      .limit(EVENTS_REPORT_MAX_ROWS),
    supabase
      .from('salon_reservations')
      .select(BIRTHDAY_ROW_SELECT)
      .eq('tenant_id', opts.tenantId)
      .eq('kind', 'birthday')
      // El mes del calendario del bar, no el de UTC: una reserva tomada el 30
      // a las 22 en Córdoba ya es del 1 en UTC.
      .gte('created_at', cordobaDayStartUtc(from))
      .lt('created_at', cordobaDayStartUtc(`${nextYM(opts.ym)}-01`))
      .limit(EVENTS_REPORT_MAX_ROWS),
    getBirthdayMarketing({ tenantId: opts.tenantId, ym: opts.ym }),
  ])
  if (celebratedRes.error) throw celebratedRes.error
  if (bookedRes.error) throw bookedRes.error

  const celebrated = (celebratedRes.data ?? []) as BirthdayReservationRow[]
  const booked = (bookedRes.data ?? []) as BirthdayReservationRow[]

  return buildMonthBirthdayReport({
    ym: opts.ym,
    today: opts.today,
    celebrated,
    bookedInMonth: booked,
    marketing,
    truncated:
      celebrated.length >= EVENTS_REPORT_MAX_ROWS || booked.length >= EVENTS_REPORT_MAX_ROWS,
  })
}
