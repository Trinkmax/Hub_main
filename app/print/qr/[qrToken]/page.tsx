import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildQrSheet } from '@/lib/tables/qr-pdf'
import { PrintSheet } from './_components/print-sheet'

export const metadata = { title: 'Imprimir QR' }
export const dynamic = 'force-dynamic'

export default async function PrintQrPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params

  // 1. Auth: el caller debe estar autenticado.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // 2. Resolver mesa por qr_token (vía service: bypass RLS para ubicar el tenant).
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('label, tenant_id, qr_token')
    .eq('qr_token', qrToken)
    .maybeSingle()
  if (!table) notFound()

  // 3. Verificar que el user es owner del tenant de esa mesa.
  const { data: membership } = await service
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', table.tenant_id)
    .maybeSingle()
  if (!membership || membership.role !== 'owner') notFound()

  // 4. Tenant name para el sheet.
  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', table.tenant_id)
    .maybeSingle()
  if (!tenant) notFound()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const sheet = await buildQrSheet({
    qrToken: table.qr_token,
    tableLabel: table.label,
    tenantName: tenant.name,
    baseUrl,
  })

  return <PrintSheet sheet={sheet} />
}
