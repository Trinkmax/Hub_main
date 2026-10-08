import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getDocument, listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { BlockError } from '../_components/block-error'
import { comprasHref, firstParam, isUuidLike, newPurchaseHref, safeReturnHref } from '../_lib/links'
import { requireComprasAccess } from '../_lib/page-access'
import { loadSheetData } from '../_lib/sheet-actions'
import type { PurchaseFamily } from '../_lib/vouchers'
import { PurchaseForm, type RecurringOption, type RelatedOption } from './_components/purchase-form'

export const metadata = { title: 'Nueva factura de proveedor' }

const TITLES: Readonly<Record<PurchaseFamily, { title: string; description: ReactNode }>> = {
  factura: {
    title: 'Nueva factura de proveedor',
    // El asiento está a la derecha recién desde lg; antes va abajo, en «Ver asiento».
    description: (
      <>
        Cargá la factura como viene en el papel: el asiento se arma solo
        <span className="hidden lg:inline"> a la derecha</span>.
      </>
    ),
  },
  nc: {
    title: 'Nueva nota de crédito',
    description:
      'Lo que el proveedor te descuenta o te devuelve: queda a favor para el próximo pago.',
  },
  nd: {
    title: 'Nueva nota de débito',
    description: 'Un cargo extra del proveedor sobre una compra: suma a lo que le debés.',
  },
}

function familyOf(tipo: string): PurchaseFamily {
  return tipo === 'nc' || tipo === 'nd' ? tipo : 'factura'
}

/**
 * Comprobante de compra (H.6): factura, nota de crédito o de débito, con o
 * sin pago. La contadora ve un aviso con el link a Comprobantes.
 */
export default async function NuevaCompraPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const family = familyOf(firstParam(sp.tipo))
  const proveedor = firstParam(sp.proveedor)
  const relacionada = firstParam(sp.relacionada)
  const gastoFijo = firstParam(sp['gasto-fijo'])
  const returnHref = safeReturnHref(tenantSlug, firstParam(sp.volver))
  const { access, canWrite } = await requireComprasAccess(
    tenantSlug,
    newPurchaseHref(tenantSlug, { tipo: family }),
  )
  const copy = TITLES[family]

  const header = (
    <>
      <Link
        href={returnHref}
        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Volver
      </Link>
      <PageHeader eyebrow="Administración" title={copy.title} description={copy.description} />
    </>
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Esta pantalla es para cargar comprobantes. Con Contabilidad podés verlos en Compras › Comprobantes."
          href={comprasHref(tenantSlug, 'comprobantes')}
          linkLabel="Ir a Comprobantes"
        />
      </PageShell>
    )
  }

  const today = todayInCordoba()
  const [sheet, recurringOutcome, relatedOutcome] = await Promise.all([
    loadSheetData(tenantSlug),
    settleQuery(listRecurringExpenses(access.tenant.id, { today })),
    family === 'nc' && isUuidLike(relacionada)
      ? settleQuery(getDocument(access.tenant.id, relacionada))
      : Promise.resolve(null),
  ])

  if (!sheet.ok) {
    return (
      <PageShell width="comfortable">
        {header}
        <BlockError message={sheet.message} />
      </PageShell>
    )
  }

  const recurring: RecurringOption[] = recurringOutcome.ok
    ? recurringOutcome.data
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          name: r.name,
          partyId: r.partyId,
          accountId: r.accountId,
          voucherType: r.voucherType,
          vatRateBp: r.vatRateBp,
          amountCents: r.amountCents,
          nextDueDate: r.nextDueDate,
          pending: r.monthStatus === 'pending',
        }))
    : []

  const relatedDoc = relatedOutcome?.ok ? relatedOutcome.data : null
  const related: RelatedOption | null =
    relatedDoc && relatedDoc.status === 'posted'
      ? { documentId: relatedDoc.id, label: relatedDoc.title }
      : null
  const partyFromRelated = relatedDoc?.partyId ?? null
  const otherTaxesAccountId = sheet.data.ctx.sys.other_taxes_expense?.id ?? null

  return (
    <PageShell width="comfortable">
      {header}
      <PurchaseForm
        tenantSlug={tenantSlug}
        data={sheet.data}
        otherTaxesAccountId={otherTaxesAccountId}
        family={family}
        initialPartyId={isUuidLike(proveedor) ? proveedor : partyFromRelated}
        related={related}
        recurring={recurring}
        initialRecurringId={isUuidLike(gastoFijo) ? gastoFijo : null}
        returnHref={returnHref}
      />
    </PageShell>
  )
}
