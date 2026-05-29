import { NextResponse } from 'next/server'
import { listStaffSessions } from '@/lib/staff-performance/queries'
import { resolveFromSearchParams } from '@/lib/staff-performance/range-from-search-params'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const userId = url.searchParams.get('user_id')
  if (!tenantId) return new NextResponse('tenant_id required', { status: 400 })
  if (!userId) return new NextResponse('user_id required', { status: 400 })

  // Verificar que el caller es owner del tenant (RLS sobre memberships filtra).
  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!membership || membership.role !== 'owner') {
    return new NextResponse('forbidden', { status: 403 })
  }

  const params = Object.fromEntries(url.searchParams.entries())
  const { range } = resolveFromSearchParams(params)
  const sessions = await listStaffSessions(tenantId, userId, range)
  return NextResponse.json({ sessions })
}
