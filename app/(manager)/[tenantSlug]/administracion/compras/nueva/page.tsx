import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PanelError } from '@/components/administracion/kit'
import { SimplePage } from '@/components/administracion/planilla'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { getDocument, listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { comprasHref, firstParam, isUuidLike, newPurchaseHref, safeReturnHref } from '../_lib/links'
import { requireComprasAccess } from '../_lib/page-access'
import { loadSheetData } from '../_lib/sheet-actions'
import type { PurchaseFamily } from '../_lib/vouchers'
import { PurchaseForm, type RecurringOption, type RelatedOption } from './_components/purchase-form'

export const metadata = { title: 'Cargar una compra' }

const TITLES: Readonly<Record<PurchaseFamily, string>> = {
  factura: 'Cargar una compra',
  nc: 'Nota de crédito de un proveedor',
  nd: 'Nota de débito de un proveedor',
}

function familyOf(tipo: string): PurchaseFamily {
  return tipo === 'nc' || tipo === 'nd' ? tipo : 'factura'
}

/** Lo que se ve cuando no se puede cargar: el título y su vuelta, sin el papel. */
function Plain({
  title,
  returnHref,
  children,
}: {
  title: string
  returnHref: string
  children: ReactNode
}) {
  return (
    <SimplePage width="narrow">
      <header className="flex min-w-0 items-center gap-1.5">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 h-11 shrink-0 gap-0.5 px-2 text-muted-foreground md:h-8"
        >
          <Link href={returnHref}>
            <ChevronLeft className="size-4" aria-hidden />
            Volver
          </Link>
        </Button>
        <h1 className="min-w-0 font-serif text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
      </header>
      {children}
    </SimplePage>
  )
}

/**
 * Cargar una compra: una factura en la pantalla. Una compra, su nota de crédito o de débito, a deber o
 * pagada en el momento (`?modo=pago`). Es a donde llega un comprobante que se soltó en otra pantalla
 * (`?desde=archivo`). La contadora ve un aviso con el link a Comprobantes.
 *
 * Los proveedores que más se usan y lo que se le debe a cada uno son lecturas opcionales: si fallan,
 * vuelven vacías y la carga sigue.
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
  const volver = firstParam(sp.volver)
  const returnHref = safeReturnHref(tenantSlug, volver)
  const { access, canWrite } = await requireComprasAccess(
    tenantSlug,
    newPurchaseHref(tenantSlug, { tipo: family }),
  )
  const title = TITLES[family]

  if (!canWrite) {
    return (
      <Plain title={title} returnHref={returnHref}>
        <ReadOnlyNotice
          description="Esta pantalla es para cargar comprobantes. Con Contabilidad podés verlos en Compras › Comprobantes."
          href={comprasHref(tenantSlug, 'comprobantes')}
          linkLabel="Ir a Comprobantes"
        />
      </Plain>
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
      <Plain title={title} returnHref={returnHref}>
        <PanelError title="No pudimos abrir la carga" message={sheet.message} />
      </Plain>
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
          treasuryAccountId: r.treasuryAccountId,
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
      startPaying={firstParam(sp.modo) === 'pago'}
      // Si se vino de una pantalla a la que hay que volver (un proveedor, un gasto fijo), se vuelve.
      startAnother={volver === ''}
      takeDropped={firstParam(sp.desde) === 'archivo'}
    />
  )
}
