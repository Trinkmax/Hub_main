import { NextResponse } from 'next/server'
import { rowsToCsv } from '@/lib/stats/csv'
import { getChurnRisk, getTopCustomersBySpent } from '@/lib/stats/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS_TOP = [
  'customer_id',
  'first_name',
  'last_name',
  'total_visits',
  'total_spent_cents',
  'avg_ticket_cents',
  'last_visit_at',
  'favorite_item',
] as const

const HEADERS_CHURN = [
  'customer_id',
  'first_name',
  'last_name',
  'phone',
  'total_visits',
  'visit_frequency_days',
  'days_since_last_visit',
  'last_visit_at',
  'total_spent_cents',
] as const

export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')
  const type = url.searchParams.get('type')
  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })
  if (type !== 'top_customers' && type !== 'churn_risk') {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  }

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])

    let csv: string
    let filename: string
    if (type === 'top_customers') {
      const rows = await getTopCustomersBySpent(access.tenant.id, 1000)
      csv = rowsToCsv(
        [...HEADERS_TOP],
        rows.map((r) => [
          r.customer_id,
          r.first_name,
          r.last_name,
          r.total_visits,
          r.total_spent_cents,
          r.avg_ticket_cents,
          r.last_visit_at ?? '',
          r.favorite_item_name ?? '',
        ]),
      )
      filename = `top-clientes-${access.tenant.slug}.csv`
    } else {
      const rows = await getChurnRisk(access.tenant.id, 1000)
      csv = rowsToCsv(
        [...HEADERS_CHURN],
        rows.map((r) => [
          r.customer_id,
          r.first_name,
          r.last_name,
          r.phone,
          r.total_visits,
          r.visit_frequency_days,
          r.days_since_last_visit,
          r.last_visit_at,
          r.total_spent_cents,
        ]),
      )
      filename = `churn-${access.tenant.slug}.csv`
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (
      e instanceof RoleRequiredError ||
      e instanceof TenantNotFoundError ||
      e instanceof UnauthenticatedError
    ) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
