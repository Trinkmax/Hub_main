import { NextResponse } from 'next/server'
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

  return NextResponse.json({ breakdown })
}
