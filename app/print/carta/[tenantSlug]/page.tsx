import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { getAppUrl } from '@/lib/app-url'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CartaQrPrint } from './_components/carta-qr-print'

export const metadata = { title: 'Imprimir QR de la carta' }
export const dynamic = 'force-dynamic'

export default async function PrintCartaQrPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  // 1. Caller autenticado.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // 2. Resolver tenant por slug (service) + verificar membership del caller.
  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, name')
    .eq('slug', tenantSlug)
    .maybeSingle()
  if (!tenant) notFound()

  const { data: membership } = await service
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!membership) notFound()

  const baseUrl = await getAppUrl()
  const cartaUrl = `${baseUrl}/carta/${tenantSlug}`
  const qrDataUrl = await QRCode.toDataURL(cartaUrl, {
    width: 560,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })

  return <CartaQrPrint tenantName={tenant.name} qrDataUrl={qrDataUrl} cartaUrl={cartaUrl} />
}
