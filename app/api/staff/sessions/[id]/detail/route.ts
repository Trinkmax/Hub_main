import { NextResponse } from 'next/server'
import { getStaffSessionDetail } from '@/lib/staff-performance/queries'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  // RLS sobre table_sessions filtra por membership. Si no es miembro, no la ve.
  const { data: session } = await supabase
    .from('table_sessions')
    .select('tenant_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return new NextResponse('not_found', { status: 404 })

  // Owner-only para mantener consistencia con la tab de admin.
  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', session.tenant_id)
    .maybeSingle()
  if (!membership || membership.role !== 'owner') {
    return new NextResponse('forbidden', { status: 403 })
  }

  const detail = await getStaffSessionDetail(sessionId)
  if (!detail) return new NextResponse('not_found', { status: 404 })
  return NextResponse.json({ detail })
}
