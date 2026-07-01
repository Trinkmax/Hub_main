import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Recompute masivo de puntos de categoría + nivel (hace vencer los puntos viejos).
// El scheduler real es pg_cron (refresh-category-points, diario); esta ruta es para
// trigger manual/observabilidad. Idempotente.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return new NextResponse('cron_secret_not_configured', { status: 500 })

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('refresh_all_category_points')
  if (error) {
    console.error('[cron.refreshCategoryPoints]', error.message)
    return new NextResponse(error.message, { status: 500 })
  }
  const updated = Array.isArray(data) ? (data[0]?.updated_count ?? 0) : 0
  return NextResponse.json({ ok: true, updated })
}
