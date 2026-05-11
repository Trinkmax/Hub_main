import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CustomerQrPrint } from './_components/customer-qr-print'

export const metadata = { title: 'Imprimir QR cliente' }
export const dynamic = 'force-dynamic'

export default async function PrintCustomerQrPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // 1. Caller autenticado
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // 2. Resolver cliente por qr_token con service (bypass RLS para inspección
  //    cross-RLS); el caller debe ser membership del tenant que sigue.
  const service = createServiceClient()
  const { data: customer } = await service
    .from('customers')
    .select('id, first_name, last_name, tenant_id')
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) notFound()

  const { data: membership } = await service
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', customer.tenant_id)
    .maybeSingle()
  if (!membership) notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', customer.tenant_id)
    .maybeSingle()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const panelUrl = `${baseUrl.replace(/\/$/, '')}/c/${token}`
  const qrDataUrl = await QRCode.toDataURL(panelUrl, {
    width: 560,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })

  return (
    <CustomerQrPrint
      tenantName={tenant?.name ?? 'Tu bar'}
      firstName={customer.first_name}
      lastName={customer.last_name}
      qrDataUrl={qrDataUrl}
      panelUrl={panelUrl}
    />
  )
}
