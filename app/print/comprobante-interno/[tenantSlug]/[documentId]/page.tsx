import { notFound, redirect } from 'next/navigation'
import { internalVoucherModel } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/internal-voucher'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { getDocument } from '@/lib/accounting/queries/documents'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { PrintActions } from '../../../factura/[tenantSlug]/[documentId]/_components/print-actions'

export const metadata = { title: 'Comprobante interno' }
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
 * El comprobante interno de un movimiento sin factura, para imprimir y firmar. Silvia, reunión del
 * 29/10: «tenés que hacer un comprobante interno que justifique el pago». Fuera del panel, como las
 * demás `/print/*`. Un comprobante que tiene otro papel no se imprime desde acá.
 */
export default async function PrintComprobanteInternoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; documentId: string }>
}) {
  const { tenantSlug, documentId } = await params
  if (!UUID_RE.test(documentId)) notFound()
  const tenantAccess = await access(
    tenantSlug,
    `/print/comprobante-interno/${tenantSlug}/${documentId}`,
  )
  const ficha = `/${tenantSlug}/administracion/comprobantes/${documentId}`

  const result = await settleQuery(getDocument(tenantAccess.tenant.id, documentId))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <main className="min-h-screen bg-white px-4 py-10 text-black">
        <div className="mx-auto max-w-md space-y-3 text-center">
          <p className="font-serif text-lg font-semibold">No pudimos cargar el comprobante.</p>
          <p className="text-sm text-neutral-600">
            {result.ok ? 'Probá de nuevo en un rato.' : result.message}
          </p>
          <a
            href={`/print/comprobante-interno/${tenantSlug}/${documentId}`}
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
          >
            Reintentar
          </a>
        </div>
      </main>
    )
  }

  const model = internalVoucherModel(result.data)
  if (!model) notFound()

  return (
    <main className="min-h-screen bg-white px-4 py-6 text-black print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto max-w-2xl space-y-4">
        <PrintActions backHref={ficha} backLabel="Volver al comprobante" />
        <article className="rounded-md border border-neutral-300 p-6 print:border-0 print:p-0">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-300 pb-3">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">{model.title}</h1>
            <p className="text-sm text-neutral-600">{tenantAccess.tenant.name}</p>
          </header>
          {model.voided ? (
            <p className="mt-3 rounded-sm border border-neutral-400 px-2 py-1 text-center text-sm font-semibold tracking-wide uppercase">
              Anulado
            </p>
          ) : null}
          <dl className="mt-4 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            {model.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-neutral-600">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            {model.means.length > 0 ? (
              <div className="contents">
                <dt className="text-neutral-600">Forma de pago</dt>
                <dd>
                  {model.means.map((text) => (
                    <span key={text} className="block tabular-nums">
                      {text}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            {model.notes ? (
              <div className="contents">
                <dt className="text-neutral-600">Nota</dt>
                <dd className="whitespace-pre-wrap">{model.notes}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-5 flex items-baseline justify-between gap-3 border-y-[3px] border-double border-neutral-400 py-2 font-semibold tabular-nums">
            <span>Total</span>
            <span>{model.totalText}</span>
          </p>
          <div className="mt-16 grid grid-cols-2 gap-8 text-center text-xs text-neutral-600">
            <p className="border-t border-neutral-400 pt-1.5">Firma de quien recibe</p>
            <p className="border-t border-neutral-400 pt-1.5">Firma de quien entrega</p>
          </div>
        </article>
      </div>
    </main>
  )
}
