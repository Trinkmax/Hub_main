import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listKitchenQueue, listTicketItemsForTickets } from '@/lib/tickets/queries'

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  if (!tenantId) return new NextResponse('tenant_id required', { status: 400 })

  const tickets = await listKitchenQueue(tenantId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))
  return NextResponse.json({ tickets, items })
}
