import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ItemsSheetImport } from './_components/items-sheet-import'

export const metadata = { title: 'Planilla de insumos · Compras' }

// Lo que se guarda acá lo usa la cocina al rato: nunca una versión cacheada.
export const dynamic = 'force-dynamic'

/**
 * Compras › Insumos › Planilla (pedido de Tomás, 09/11/2026): bajar la lista de insumos en Excel, cambiarla y
 * subirla. Leer, comparar y guardar lo hacen `lib/purchasing/sheet-actions`; el archivo sale de
 * `/api/compras/insumos/planilla`. Ver docs/features/compras.md › Planilla de insumos.
 */
export default async function PlanillaInsumosPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, PURCHASING_MANAGE_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  if (!access.isPlatformAdmin && !isFeatureEnabled(access.tenant, 'purchasing')) notFound()

  const db = await createClient()
  const { count } = await db
    .from('pur_items')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', access.tenant.id)

  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/compras/insumos`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver a Insumos
          </Link>
        }
        title="Editar con una planilla"
        description="Bajá la lista de insumos, cambiala en Excel o en Google Sheets y subila: antes de guardar te mostramos qué cambia."
      />
      <ItemsSheetImport tenantSlug={tenantSlug} itemCount={count ?? 0} />
    </PageShell>
  )
}
