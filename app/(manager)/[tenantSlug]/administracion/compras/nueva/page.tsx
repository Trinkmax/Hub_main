import type { ReactNode } from 'react'
import { AdmHeader, AdmPage, PanelError } from '@/components/administracion/kit'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { getDocument, listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { comprasHref, firstParam, isUuidLike, newPurchaseHref, safeReturnHref } from '../_lib/links'
import { requireComprasAccess } from '../_lib/page-access'
import { loadSheetData } from '../_lib/sheet-actions'
import type { PurchaseFamily } from '../_lib/vouchers'
import { PurchaseForm, type RecurringOption, type RelatedOption } from './_components/purchase-form'

export const metadata = { title: 'Cargar una compra que debo' }

const TITLES: Readonly<Record<PurchaseFamily, { title: string; description: ReactNode }>> = {
  factura: {
    // Las palabras del lanzador y de la guía: acá se llega con una factura, un tique o un remito.
    title: 'Cargar una compra que debo',
    description: 'Lo que te dejó un proveedor: queda anotado en su libreta hasta que le pagues.',
  },
  nc: {
    title: 'Nota de crédito de un proveedor',
    description: 'Lo que te descuenta o te devuelve: queda a tu favor y se usa en el próximo pago.',
  },
  nd: {
    title: 'Nota de débito de un proveedor',
    description: 'Un cargo extra sobre una compra: suma a lo que le debés.',
  },
}

function familyOf(tipo: string): PurchaseFamily {
  return tipo === 'nc' || tipo === 'nd' ? tipo : 'factura'
}

/**
 * «Cargar una compra que debo»: escribir un renglón en la libreta de un
 * proveedor (una compra, o su nota de crédito o de débito), con o sin pago en
 * el momento. La contadora ve un aviso con el link a Comprobantes.
 *
 * La hoja de carga trae además los proveedores que más se usan (los chips de
 * «¿A quién le compraste?») y lo que se le debe a cada uno («Hoy le debés…»):
 * las dos lecturas son opcionales y nunca rompen (si fallan, vuelven vacías).
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
    <AdmHeader
      title={copy.title}
      description={copy.description}
      back={{ href: returnHref, label: 'Volver' }}
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Esta pantalla es para cargar comprobantes. Con Contabilidad podés verlos en Compras › Comprobantes."
          href={comprasHref(tenantSlug, 'comprobantes')}
          linkLabel="Ir a Comprobantes"
        />
      </AdmPage>
    )
  }

  const today = todayInCordoba()
  const [sheet, recurringOutcome, relatedOutcome] = await Promise.all([
    loadSheetData(tenantSlug, { suggestions: true, balances: true }),
    settleQuery(listRecurringExpenses(access.tenant.id, { today })),
    family === 'nc' && isUuidLike(relacionada)
      ? settleQuery(getDocument(access.tenant.id, relacionada))
      : Promise.resolve(null),
  ])

  if (!sheet.ok) {
    return (
      <AdmPage width="comfortable">
        {header}
        <PanelError title="No pudimos abrir la carga" message={sheet.message} />
      </AdmPage>
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
    <AdmPage width="comfortable">
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
    </AdmPage>
  )
}
