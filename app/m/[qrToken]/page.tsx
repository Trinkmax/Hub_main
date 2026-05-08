import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { MesaScreen } from './_components/mesa-screen'

export const metadata = { title: 'Mesa' }
export const dynamic = 'force-dynamic'

export default async function MesaPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params

  // Validamos que el qr_token existe usando service client (bypass RLS).
  // El cliente browser hará get_session_state vía RPC anon para abrir/sumarse.
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('label, tenant_id, active')
    .eq('qr_token', qrToken)
    .maybeSingle()

  if (!table?.active) notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', table.tenant_id)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <main className="min-h-screen bg-background">
      <MesaScreen qrToken={qrToken} tableLabel={table.label} tenantName={tenant.name} />
    </main>
  )
}
