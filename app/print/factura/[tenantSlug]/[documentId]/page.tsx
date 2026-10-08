import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { getInvoicePrintData } from '@/lib/arca/emit-queries'
import { invoicePrintModel } from '@/lib/arca/print'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { InvoiceSheet } from './_components/invoice-sheet'
import { PrintActions } from './_components/print-actions'

export const metadata = { title: 'Factura' }
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A4 con márgenes de 12 mm: lo que sale al imprimir o al guardar como PDF. */
const PRINT_CSS =
  '@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }'

async function access(tenantSlug: string, returnTo: string): Promise<TenantAccess> {
  try {
    // Lectura: los dueños con acceso y la contadora (RLS de lectores; sin service_role).
    return await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(returnTo)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }
}

/**
 * La factura imprimible de un comprobante emitido con CAE (diseño §3.2.6). `id`
 * es el comprobante de los libros o, para una autorizada que todavía no está en
 * los libros (o una de prueba), el comprobante de ARCA. Fuera del panel, como las
 * demás `/print/*`; «Imprimir o guardar PDF» abre el diálogo del navegador.
 */
export default async function PrintFacturaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; documentId: string }>
}) {
  const { tenantSlug, documentId } = await params
  if (!UUID_RE.test(documentId)) notFound()
  const tenantAccess = await access(tenantSlug, `/print/factura/${tenantSlug}/${documentId}`)
  const base = `/${tenantSlug}/administracion`

  const result = await settleQuery(getInvoicePrintData(tenantAccess.tenant.id, documentId))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <main className="min-h-screen bg-white px-4 py-10 text-black">
        <div className="mx-auto max-w-md space-y-3 text-center">
          <p className="font-serif text-lg font-semibold">No pudimos cargar la factura.</p>
          <p className="text-sm text-neutral-600">
            {result.ok ? 'Probá de nuevo en un rato.' : result.message}
          </p>
          <a
            href={`/print/factura/${tenantSlug}/${documentId}`}
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100"
          >
            Reintentar
          </a>
        </div>
      </main>
    )
  }

  const data = result.data
  const model = invoicePrintModel({
    environment: data.voucher.environment,
    issuer: { ...data.issuer, tradeName: tenantAccess.tenant.name },
    request: data.request,
    cae: data.cae,
    caeDue: data.caeDue,
    receiver: data.receiver,
    detail: data.detail,
  })
  const qrDataUrl = await QRCode.toDataURL(model.qrUrl, {
    width: 336,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
  const backHref = data.voucher.documentId
    ? `${base}/comprobantes/${data.voucher.documentId}`
    : `${base}/ventas?tab=facturas`

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-black print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto w-full max-w-[210mm]">
        <PrintActions
          backHref={backHref}
          backLabel={data.voucher.documentId ? 'Volver al comprobante' : 'Volver a facturas'}
        />
        <InvoiceSheet model={model} qrDataUrl={qrDataUrl} />
      </div>
    </main>
  )
}
