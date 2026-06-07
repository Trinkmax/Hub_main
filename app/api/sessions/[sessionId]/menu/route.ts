import { NextResponse } from 'next/server'
import { getStaffMenuForTenant } from '@/lib/sessions-waiter/staff-menu-queries'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  // Resolver el tenant de la sesión. RLS sobre table_sessions filtra: si el user
  // no es miembro, la query devuelve null y respondemos 404 (no leakeamos qué pasó).
  const { data: session } = await supabase
    .from('table_sessions')
    .select('tenant_id, status')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return new NextResponse('not_found', { status: 404 })
  if (session.status !== 'open') {
    return NextResponse.json({ menu: [], reason: 'session_not_open' }, { status: 200 })
  }

  const menu = await getStaffMenuForTenant(session.tenant_id)
  return NextResponse.json({ menu })
}
