import { NextResponse } from 'next/server'
import { getPointsRedemptionConfig } from '@/lib/points/queries'
import { getCobroBreakdown } from '@/lib/sessions-waiter/queries'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const breakdown = await getCobroBreakdown(sessionId)
  if (!breakdown) return new NextResponse('not_found', { status: 404 })

  // Para la UI de redención: levantamos el tenant de la sesión y los balances de
  // los customers asociados (RLS sobre customers filtra por tenant).
  const { data: session } = await supabase
    .from('table_sessions')
    .select('tenant_id')
    .eq('id', sessionId)
    .maybeSingle()

  const redemptionConfig = session
    ? await getPointsRedemptionConfig(session.tenant_id)
    : { enabled: false, ratePointsToCents: 100, maxPct: 50 }

  const customerIds = breakdown.guests
    .map((g) => g.customer_id)
    .filter((id): id is string => Boolean(id))

  let customerBalances: Array<{
    customer_id: string
    first_name: string | null
    last_name: string | null
    points_balance: number
  }> = []
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from('customers')
      .select('id, first_name, last_name, points_balance')
      .in('id', customerIds)
    customerBalances = (data ?? []).map((c) => ({
      customer_id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      points_balance: c.points_balance ?? 0,
    }))
  }

  return NextResponse.json({ breakdown, redemptionConfig, customerBalances })
}
