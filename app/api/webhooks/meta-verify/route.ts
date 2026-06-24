import { NextResponse } from 'next/server'
import { getMetaConfig } from '@/lib/meta/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Endpoint compartido para handshake de WhatsApp/Instagram (los dashboards
// permiten apuntar el verify a la misma URL ya que el flujo es idéntico).
export async function GET(request: Request) {
  const { webhookVerifyToken } = await getMetaConfig()
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === webhookVerifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new NextResponse('forbidden', { status: 403 })
}
