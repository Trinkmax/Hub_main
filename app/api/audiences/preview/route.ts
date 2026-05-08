import { NextResponse } from 'next/server'
import { previewAudience } from '@/lib/audiences/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Endpoint para que el builder de audiences haga preview en vivo sin formData.
export async function POST(request: Request) {
  let body: { slug?: string; filters?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 })
  }
  if (!body.slug || body.filters === undefined) {
    return NextResponse.json({ ok: false, message: 'missing_fields' }, { status: 400 })
  }
  const result = await previewAudience(body.slug, body.filters)
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json(result)
}
