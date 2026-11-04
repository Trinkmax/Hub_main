import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { RetryButton, StatusPill } from '@/components/administracion/kit'
import { Totalizer, type TotalizerItem } from '@/components/administracion/planilla/totalizer'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { PartyDetail, PartyPosition } from '@/lib/accounting/queries/parties'
import { SupplierAccountButton } from '../../../_components/supplier-account-picker'
import { comprasHref, newPurchaseHref } from '../../../_lib/links'
import {
  supplierBalanceItem,
  supplierCategoryText,
  supplierTermText,
} from '../../../_lib/supplier-ledger'
import { SupplierActions } from './supplier-actions'
import { SupplierEditButton } from './supplier-edit'

/** Un dato del totalizador que se toca para cambiarlo: se lee como el número, con su raya punteada. */
const TOUCHABLE =
  'block min-h-0 max-w-full cursor-pointer truncate rounded-sm text-left text-[length:inherit] font-semibold text-foreground underline decoration-border decoration-dotted underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 pointer-coarse:min-h-8'

/**
 * Arriba de la cuenta corriente: «‹ Proveedores», [Ficha] [Compra] [Pagar], el nombre en Fraunces y el
 * totalizador (Saldo · Plazo · Va a). El plazo y la categoría se tocan para cambiarlos (o para
 * cargarlos, si faltan); la contadora los lee como texto.
 *
 * `ficha`: se está viendo la ficha (`?tab=datos`), y el botón vuelve a la cuenta.
 */
export function SupplierHead({
  tenantSlug,
  party,
  position,
  positionError,
  canWrite,
  canPickCategory,
  baseHref,
  ficha,
  exportHref,
  exportFileName,
  openingPending = false,
}: {
  tenantSlug: string
  party: PartyDetail
  /** `null` si no se pudo leer. */
  position: PartyPosition | null
  positionError: string | null
  canWrite: boolean
  /** Se leyó el plan: la categoría se puede elegir desde acá (si no, se lee nada más). */
  canPickCategory: boolean
  /** Su cuenta corriente: a dónde vuelve una compra cargada desde acá. */
  baseHref: string
  ficha: boolean
  exportHref: string
  exportFileName: string
  /** Faltan los saldos iniciales: «al día» es solo por lo cargado. */
  openingPending?: boolean
}) {
  const shown = party.tradeName ?? party.name
  const hasTradeName = Boolean(party.tradeName && party.tradeName !== party.name)
  const hasDebt = (position?.debtCents ?? 0) > 0
  const term = supplierTermText(party.paymentTermDays)
  const category = supplierCategoryText(party.defaultAccountName)
  const pickCategory = canWrite && canPickCategory

  const balance: TotalizerItem = position
    ? supplierBalanceItem({
        debtCents: position.debtCents,
        creditCents: position.creditCents,
        overdueCents: position.aging.overdueCents,
        dueSoonCents: position.aging.totals.due_soon,
        openingPending,
      })
    : { label: 'Saldo', cents: null }

  const items: TotalizerItem[] = [
    balance,
    {
      label: 'Plazo',
      text: canWrite ? (
        <SupplierEditButton chip aria-label={`Cambiar el plazo de ${shown}`} className={TOUCHABLE}>
          {term}
        </SupplierEditButton>
      ) : (
        term
      ),
    },
    {
      label: 'Va a',
      text:
        category === null && !pickCategory ? (
          <span className="font-normal text-muted-foreground">Sin categoría</span>
        ) : pickCategory ? (
          <SupplierAccountButton
            partyId={party.id}
            supplierName={shown}
            hasAccount={category !== null}
            className={category !== null ? TOUCHABLE : undefined}
          >
            {category ?? undefined}
          </SupplierAccountButton>
        ) : (
          <span className="block truncate" title={party.defaultAccountName ?? undefined}>
            {category}
          </span>
        ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link
          href={comprasHref(tenantSlug)}
          className="-ml-1.5 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Proveedores
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <ReadOnlyBadge />
          <Button asChild variant="ghost" size="sm" className="h-10 md:pointer-fine:h-8">
            <Link href={ficha ? baseHref : `${baseHref}?tab=datos`}>
              {ficha ? 'Cuenta corriente' : 'Ficha'}
            </Link>
          </Button>
          <SupplierActions
            partyId={party.id}
            partyName={shown}
            newInvoiceHref={newPurchaseHref(tenantSlug, { proveedor: party.id, volver: baseHref })}
            paidPurchaseHref={newPurchaseHref(tenantSlug, {
              modo: 'pago',
              proveedor: party.id,
              volver: baseHref,
            })}
            newCreditNoteHref={newPurchaseHref(tenantSlug, {
              tipo: 'nc',
              proveedor: party.id,
              volver: baseHref,
            })}
            exportHref={exportHref}
            exportFileName={exportFileName}
            canPay={party.active || hasDebt}
            canBuy={party.active}
          />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
            {shown}
          </h1>
          {party.kind !== 'supplier' ? (
            <StatusPill tone="muted">{PARTY_KIND_LABELS[party.kind] ?? 'Otro'}</StatusPill>
          ) : null}
          {party.active ? null : <StatusPill tone="muted">Desactivado</StatusPill>}
        </div>
        {hasTradeName ? <p className="text-sm text-muted-foreground">{party.name}</p> : null}
      </div>

      <Totalizer items={items} />
      {position === null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <p role="alert" className="text-pretty">
            {positionError ?? 'No pudimos leer cuánto le debés.'}
          </p>
          <RetryButton />
        </div>
      ) : null}
    </>
  )
}
