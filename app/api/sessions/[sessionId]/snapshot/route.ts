import { NextResponse } from 'next/server'
import { getSessionForWaiter } from '@/lib/sessions-waiter/queries'
import { createClient } from '@/lib/supabase/server'
import { listTicketItemsForTickets, listTicketsForSession } from '@/lib/tickets/queries'

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const session = await getSessionForWaiter(sessionId)
  if (!session) return new NextResponse('not_found', { status: 404 })

  const tickets = await listTicketsForSession(sessionId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return NextResponse.json({
    tickets,
    items,
    bill_requested: session.bill_requested,
    status: session.status,
  })
}
