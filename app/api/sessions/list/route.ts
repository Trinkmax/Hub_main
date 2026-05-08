import { NextResponse } from 'next/server'
import { listOpenSessions } from '@/lib/sessions-waiter/queries'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  if (!tenantId) return new NextResponse('tenant_id required', { status: 400 })

  // RLS protege la query: solo retorna sesiones del tenant donde el user es miembro.
  const sessions = await listOpenSessions(tenantId)
  return NextResponse.json({ sessions })
}
