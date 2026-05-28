import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { MesaScreen } from './_components/mesa-screen'
import { WaitingForWaiter } from './_components/waiting-for-waiter'

export const metadata = { title: 'Mesa' }
export const dynamic = 'force-dynamic'

export default async function MesaPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params

  // Validamos el QR token con service client (bypass RLS — el comensal es anon).
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('id, label, tenant_id, active')
    .eq('qr_token', qrToken)
    .maybeSingle()

  if (!table?.active) notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', table.tenant_id)
    .maybeSingle()

  if (!tenant) notFound()

  // Buscamos si la mesa tiene una sesión activa. La activación la hace el mozo
  // vía RPC autenticada — el comensal nunca crea sesiones.
  const { data: activeSession } = await service
    .from('table_sessions')
    .select('id')
    .eq('physical_table_id', table.id)
    .eq('status', 'open')
    .maybeSingle()

  if (!activeSession) {
    return (
      <main className="min-h-screen bg-background">
        <WaitingForWaiter
          physicalTableId={table.id}
          tableLabel={table.label}
          tenantName={tenant.name}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <MesaScreen qrToken={qrToken} tableLabel={table.label} tenantName={tenant.name} />
    </main>
  )
}
