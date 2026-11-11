import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAppUrl } from '@/lib/app-url'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TICKET_SALES_ROLES } from '@/lib/tenant/roles'
import { hasTransferAlias, listOrdersBetween } from '@/lib/ticketing/queries'
import {
  groupSalesByDay,
  previousPageEnd,
  salesPage,
  salesPageLabel,
  salesPageRange,
} from '@/lib/ticketing/sales-days'
import { SalesList, type SalesResult } from './_components/sales-list'
import { SalesTabs } from './_components/sales-tabs'

export const metadata = { title: 'Ventas online' }

// Las compras cambian solas (Mercado Pago avisa cuando quiere): nada que prerenderizar.
export const dynamic = 'force-dynamic'

/**
 * Ventas online: las compras de la cartelera, día por día, aparte de Marketing para que entre
 * también la anfitriona y confirme las transferencias (pedido del 06/11/2026). Devolver y anular
 * quedan del dueño. La película, los precios y Mercado Pago siguen en Marketing › Entradas.
 */
export default async function VentasOnlinePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ hasta?: string | string[] }>
}) {
  const { tenantSlug } = await params
  const { hasta } = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    // El dueño y la anfitriona (la RLS dice lo mismo).
    requireRole(access.role, TICKET_SALES_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const now = new Date()
  const page = salesPage(hasta, now)
  const { fromIso, toIso } = salesPageRange(page)
  const tenantId = access.tenant.id
  const [result, transferEnabled, appUrl] = await Promise.all([
    listOrdersBetween(tenantId, fromIso, toIso).then(
      ({ orders, olderCreatedAt }): SalesResult => ({
        ok: true,
        days: groupSalesByDay(orders),
        previousTo: previousPageEnd(olderCreatedAt),
      }),
      (): SalesResult => ({ ok: false }),
    ),
    hasTransferAlias(tenantId),
    getAppUrl(),
  ])

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Entradas"
        title="Ventas online"
        description="Las compras de la cartelera, día por día. Si alguien pagó por transferencia, confirmala cuando la plata esté en la cuenta: se carga su reserva y la entrada pasa a tener el QR."
      />
      <SalesTabs tenantSlug={tenantSlug} active="ventas" />

      {page.latest ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/40 px-4 py-2.5 text-sm">
          <span className="font-medium tabular-nums">{salesPageLabel(page)}</span>
          <Link
            href={`/${tenantSlug}/ventas-online`}
            className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-2 hover:underline sm:min-h-0"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver a hoy
          </Link>
        </div>
      )}

      <SalesList
        tenantSlug={tenantSlug}
        appUrl={appUrl}
        result={result}
        page={page}
        now={now}
        transferEnabled={transferEnabled}
        canManageMoney={access.role === 'owner'}
      />
    </PageShell>
  )
}
