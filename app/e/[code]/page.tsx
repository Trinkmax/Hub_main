import { notFound, redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/tenant/current'
import { TICKET_DOOR_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { orderIdFromEntryCode } from '@/lib/ticketing/entry-code'

/**
 * Adonde lleva el QR de una entrada, si lo abre la cámara del celular en vez del
 * escáner del salón. Dos públicos, una sola dirección (igual que /v/<token>):
 *
 *  · quien recibe en ese bar → a la puerta, con la entrada ya cargada.
 *  · cualquier otra persona → a la entrada del cliente.
 *
 * Service-role a propósito: no hay sesión del cliente y el id del pedido ES la
 * llave. Solo se lee a qué bar pertenece.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas de entradas, sin tipos generados todavía
type SBAny = any

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tu entrada', robots: { index: false, follow: false } }

export default async function EntryCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const orderId = orderIdFromEntryCode(code)
  if (!orderId) notFound()

  const service = createServiceClient()
  const { data } = await (service as SBAny)
    .from('ticket_orders')
    .select('tenant_id, tenant:tenants(slug)')
    .eq('id', orderId)
    .maybeSingle()
  const order = data as {
    tenant_id: string
    tenant: { slug: string } | { slug: string }[] | null
  } | null
  const tenant = Array.isArray(order?.tenant) ? order?.tenant[0] : order?.tenant
  if (!order || !tenant?.slug) notFound()

  const user = await getCurrentUser()
  if (user) {
    const { data: membership } = await service
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', order.tenant_id)
      .maybeSingle()
    const role = (membership as { role: string } | null)?.role
    if (role && TICKET_DOOR_ROLES.includes(role as TenantRole)) {
      redirect(`/${tenant.slug}/salon/puerta?code=${encodeURIComponent(code)}`)
    }
  }
  redirect(`/entradas/${tenant.slug}/mi-entrada/${orderId}`)
}
