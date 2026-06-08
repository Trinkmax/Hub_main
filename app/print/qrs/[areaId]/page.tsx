import { notFound } from 'next/navigation'
import { getAppUrl } from '@/lib/app-url'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildQrSheet, type QrSheet } from '@/lib/tables/qr-pdf'
import { BulkPrintSheet } from './_components/bulk-print-sheet'

export const metadata = { title: 'Imprimir QRs del área' }
export const dynamic = 'force-dynamic'

export default async function PrintAreaQrsPage({
  params,
}: {
  params: Promise<{ areaId: string }>
}) {
  const { areaId } = await params

  // 1. Auth: el caller debe estar autenticado.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // 2. Resolver área → tenant (service: bypass RLS para ubicar el tenant + owner-check).
  const service = createServiceClient()
  const { data: area } = await service
    .from('floor_plan_areas')
    .select('tenant_id, name')
    .eq('id', areaId)
    .maybeSingle()
  if (!area) notFound()

  // 3. Verificar owner del tenant del área.
  const { data: membership } = await service
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', area.tenant_id)
    .maybeSingle()
  if (!membership || membership.role !== 'owner') notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', area.tenant_id)
    .maybeSingle()
  if (!tenant) notFound()

  // 4. Mesas ubicadas en el área (con su QR).
  const { data: els } = await service
    .from('floor_plan_elements')
    .select('physical_tables(label, qr_token, active)')
    .eq('area_id', areaId)
    .eq('tenant_id', area.tenant_id)
    .eq('kind', 'table')

  const tables = (
    (els ?? []) as unknown as {
      physical_tables: { label: string; qr_token: string; active: boolean } | null
    }[]
  )
    .map((e) => e.physical_tables)
    .filter((t): t is { label: string; qr_token: string; active: boolean } => !!t && t.active)

  const baseUrl = await getAppUrl()
  const sheets: QrSheet[] = await Promise.all(
    tables.map((t) =>
      buildQrSheet({
        qrToken: t.qr_token,
        tableLabel: t.label,
        tenantName: tenant.name,
        baseUrl,
      }),
    ),
  )
  sheets.sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'es'))

  return <BulkPrintSheet sheets={sheets} areaName={area.name} tenantName={tenant.name} />
}
