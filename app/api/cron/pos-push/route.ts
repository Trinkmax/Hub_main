import { NextResponse } from 'next/server'
import { z } from 'zod'
import { pushNotices } from '@/lib/pos/notices/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Cada envío espera hasta 8 segundos a su servicio de push: que la plataforma no corte la llamada
// antes de que quede anotado cómo salió.
export const maxDuration = 30

const bodySchema = z.object({ ids: z.array(z.uuid()).max(200).optional() })

// La base pega acá (POST con `Authorization: Bearer ${CRON_SECRET}`) cada vez que una estación mueve lo
// de una mesa, con los avisos que acaba de escribir: `{ "ids": [...] }`. De acá salen las
// notificaciones push al teléfono de quien atiende. Sin ids (o con un cuerpo que no se entiende) se
// barren los avisos recientes que quedaron sin mandar. GET, con el mismo secreto, es esa barrida a mano
// (smoke).
async function handle(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let ids: string[] | null = null
  if (request.method === 'POST') {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (parsed.success && parsed.data.ids && parsed.data.ids.length > 0) ids = parsed.data.ids
  }

  try {
    const result = await pushNotices(ids)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron.pos-push]', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = handle
export const GET = handle
