import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { firstLoadableDay, firstParam } from '@/components/administracion/cajas-ventas/periods'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import {
  type InvoiceCustomer,
  type InvoiceSalesPoint,
  SalesInvoiceForm,
} from './_components/sales-invoice-form'

export const metadata = { title: 'Factura de venta' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?tipo=factura|nc|nd` → el tipo de comprobante (por defecto, factura). */
function docKindOf(
  tipo: string | null,
): 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note' {
  if (tipo === 'nc') return 'sales_credit_note'
  if (tipo === 'nd') return 'sales_debit_note'
  return 'sales_invoice'
}

export default async function NuevaFacturaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireAdminPage(tenantSlug, `${base}/ventas/nueva-factura`)

  const back = (
    <Link
      href={`${base}/ventas?tab=facturas`}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" />
      Volver a facturas
    </Link>
  )
  const header = (
    <PageHeader
      eyebrow="Administración"
      title={
        <>
          Factura de venta <ReadOnlyBadge />
        </>
      }
      description="Para las ventas que se facturan aparte del cierre del día: eventos, catering, sponsoreo."
    />
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {back}
        {header}
        <ReadOnlyNotice
          description="Acá se cargan las facturas de venta sueltas. Con Contabilidad las ves en Ventas › Facturas."
          href={`${base}/ventas?tab=facturas`}
          linkLabel="Ir a Facturas"
        />
      </PageShell>
    )
  }

  const tenantId = access.tenant.id
  const [catalog, ctx, firstOpenDate] = await Promise.all([
    loadPostingCatalog(tenantId),
    loadPostingContext(tenantId),
    loadFirstOpenDate(tenantId),
  ])

  const customers: InvoiceCustomer[] = catalog.parties
    .filter((p) => p.kind === 'customer' && p.systemKey === null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      tradeName: p.tradeName,
      taxId: p.taxId,
      ivaCondition: p.ivaCondition,
      paymentTermDays: p.paymentTermDays,
      active: p.active,
    }))
  const salesPoints: InvoiceSalesPoint[] = catalog.salesPoints
    .filter((p) => p.active)
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ number: p.number, label: p.label, defaultChannel: p.defaultChannel }))
  const treasuries = catalog.treasuries
    .filter((t) => t.active && t.kind !== 'credit_card')
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      balanceCents: t.balanceCents,
      active: t.active,
    }))

  const cliente = firstParam(sp.cliente)
  const relacionada = firstParam(sp.relacionada)
  const prefill = {
    docKind: docKindOf(firstParam(sp.tipo)),
    partyId:
      cliente && UUID_RE.test(cliente) && customers.some((c) => c.id === cliente) ? cliente : null,
    relatedDocumentId: relacionada && UUID_RE.test(relacionada) ? relacionada : null,
  }

  return (
    <PageShell width="comfortable">
      {back}
      {header}
      <SalesInvoiceForm
        tenantSlug={tenantSlug}
        ctx={ctx}
        firstOpenDate={firstOpenDate}
        minDate={firstLoadableDay({
          booksStartDate: catalog.settings.booksStartDate,
          firstOpenDate,
        })}
        today={catalog.today}
        customers={customers}
        salesPoints={salesPoints}
        treasuries={treasuries}
        prefill={prefill}
      />
    </PageShell>
  )
}
