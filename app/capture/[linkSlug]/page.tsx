import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Compat: el flujo del club ahora vive dentro de la carta. Este endpoint se
 * mantiene para los QR de captura ya impresos: resuelve el tenant del link y
 * redirige a la carta con el formulario del club abierto.
 */
export default async function CapturePage({ params }: { params: Promise<{ linkSlug: string }> }) {
  const { linkSlug } = await params

  const supabase = await createClient()
  const { data: link } = await supabase
    .from('customer_capture_links')
    .select('tenant_id')
    .eq('slug', linkSlug)
    .eq('active', true)
    .maybeSingle()

  if (!link) notFound()

  const { createServiceClient } = await import('@/lib/supabase/service')
  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', link.tenant_id)
    .maybeSingle()

  if (!tenant?.slug) notFound()

  redirect(`/carta/${tenant.slug}?club=1`)
}
