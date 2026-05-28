import { NextResponse } from 'next/server'
import { getSalonOccupancy, listSalonTables } from '@/lib/sessions-waiter/queries'
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

  // RLS protege ambas queries: solo retorna data del tenant donde el user es miembro.
  const [tables, occupancy] = await Promise.all([
    listSalonTables(tenantId),
    getSalonOccupancy(tenantId),
  ])
  return NextResponse.json({ tables, occupancy })
}
