import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { firstLoadableDay, firstParam } from '@/components/administracion/cajas-ventas/periods'
import { AdmHeader, AdmPage } from '@/components/administracion/kit'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import type { ArcaEmissionSetup } from '@/lib/arca/emit-form'
import { getArcaEmissionSetup } from '@/lib/arca/emit-queries'
import {
  type InvoiceArca,
  type InvoiceCustomer,
  type InvoiceSalesPoint,
  SalesInvoiceForm,
} from './_components/sales-invoice-form'

export const metadata = { title: 'Factura aparte' }

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

  const tipo = firstParam(sp.tipo)
  const header = (
    <AdmHeader
      back={{ href: `${base}/ventas?tab=facturas`, label: 'Facturas' }}
      title={
        tipo === 'nc' ? 'Nota de crédito' : tipo === 'nd' ? 'Nota de débito' : 'Factura aparte'
      }
      badge={<ReadOnlyBadge />}
      description="Para lo que se factura fuera del cierre del día: un evento, un catering, un sponsoreo."
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se cargan las facturas que se hacen aparte del cierre. Con Contabilidad las ves en Ventas › Facturas."
          href={`${base}/ventas?tab=facturas`}
          linkLabel="Ir a Facturas"
        />
      </AdmPage>
    )
  }

  const tenantId = access.tenant.id
  const [catalog, ctx, firstOpenDate, arcaSetup] = await Promise.all([
    loadPostingCatalog(tenantId),
    loadPostingContext(tenantId),
    loadFirstOpenDate(tenantId),
    // La emisión con ARCA: si falla la lectura, la factura se carga como siempre (manual).
    settleQuery(getArcaEmissionSetup(tenantId, { vatRegistered: true })),
  ])

  const customers: InvoiceCustomer[] = catalog.parties
    .filter((p) => p.kind === 'customer' && p.systemKey === null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      tradeName: p.tradeName,
      taxId: p.taxId,
      taxIdType: p.taxIdType,
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

  const finalConsumerId =
    catalog.parties.find((p) => p.systemKey === 'consumidor_final')?.id ?? null
  const vatRegistered = catalog.settings.ivaCondition === 'responsable_inscripto'
  const setup: ArcaEmissionSetup = arcaSetup.ok
    ? vatRegistered || arcaSetup.data.state !== 'on'
      ? arcaSetup.data
      : { ...arcaSetup.data, state: 'off', offReason: 'not_vat_registered' }
    : {
        state: 'unavailable',
        offReason: null,
        pointOfSale: null,
        allowedClasses: ['B'],
        defaultConcepto: 1,
        platformVouchers: [],
        attention: [],
      }
  const arca: InvoiceArca = {
    setup,
    finalConsumerId,
    pointOfSaleLabel:
      setup.pointOfSale === null
        ? null
        : (catalog.salesPoints.find((p) => p.number === setup.pointOfSale)?.label ?? null),
    loadError: arcaSetup.ok ? null : arcaSetup.message,
  }

  const cliente = firstParam(sp.cliente)
  const relacionada = firstParam(sp.relacionada)
  const prefill = {
    docKind: docKindOf(tipo),
    partyId:
      cliente &&
      UUID_RE.test(cliente) &&
      (customers.some((c) => c.id === cliente) ||
        (cliente === finalConsumerId && setup.state === 'on'))
        ? cliente
        : null,
    relatedDocumentId: relacionada && UUID_RE.test(relacionada) ? relacionada : null,
  }

  return (
    <AdmPage width="comfortable">
      {header}
      <SalesInvoiceForm
        // Sin nada elegido en la URL, primero se pregunta si la venta ya está en un cierre.
        askGate={tipo === null && cliente === null && relacionada === null}
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
        arca={arca}
      />
    </AdmPage>
  )
}
