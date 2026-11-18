import { notFound, redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * El QR de mesa del servicio de mesa anterior (`/m/<token>`), retirado el 18/11/2026.
 *
 * Abría una carta por mesa con auto-pedido. Esa pantalla ya no existe, pero puede quedar algún QR
 * impreso pegado en una mesa: en vez de un «no existe», quien lo escanea llega a la carta del bar,
 * que es lo que vino a buscar. El token solo sirve para saber de qué bar es la mesa.
 */
export default async function MesaQrRedirect({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params
  // Los tokens son 16 alfanuméricos; cualquier otra cosa no es un QR nuestro.
  if (!/^[A-Za-z0-9]{8,64}$/.test(qrToken)) notFound()

  // Service client: quien escanea no tiene sesión. Solo se lee a qué bar pertenece la mesa.
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('tenant_id')
    .eq('qr_token', qrToken)
    .maybeSingle()
  if (!table) notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', table.tenant_id)
    .maybeSingle()
  if (!tenant) notFound()

  redirect(`/carta/${tenant.slug}`)
}
