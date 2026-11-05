import { CornerDownRight } from 'lucide-react'
import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit'
import {
  PHONE_FIT,
  PHONE_HIDDEN,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
} from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type LibretaEntry,
  type LibretaView,
  supplierDisplayName,
  supplierShortName,
} from '../_lib/libreta'
import { comprasHref, newPurchaseHref, supplierHref } from '../_lib/links'
import { SUPPLIER_FILTERS, type SupplierFilterValue, supplierRowActions } from '../_lib/suppliers'
import { LiveSearch } from './list-filters'
import { NoAmount, ROW_ACTIONS_CELL, ROW_BUTTON, ROW_LINK, SheetControls } from './planilla-bits'
import { Segment, type SegmentItem } from './segment'
import { SupplierRowMenu } from './supplier-row-menu'
import { SuppliersMenu } from './suppliers-menu'

/**
 * Arriba de la planilla: la búsqueda (busca mientras se escribe), el filtro y el «⋯» con lo de cada
 * tanto. El filtro vive en la URL (`?filtro=`) y cada contador sale de la misma lectura que la lista
 * (`libretaView`): nunca dicen distinto. «Sin categoría» no se ofrece: se llega por «Clasificar
 * proveedores» y, si está elegido, se ve.
 */
export function LibretaToolbar({
  tenantSlug,
  counts,
  filter,
  q,
  canWrite,
  existingNames,
  exportHref,
  exportFileName,
}: {
  tenantSlug: string
  counts: LibretaView['counts']
  filter: SupplierFilterValue
  q: string
  canWrite: boolean
  /** Los nombres ya cargados (para no repetirlos al pegar una lista). */
  existingNames: readonly string[]
  exportHref: string
  exportFileName: string
}) {
  const items: SegmentItem[] = SUPPLIER_FILTERS.filter(
    (f) => !f.unclassifiedOnly || f.value === filter,
  ).map((f) => ({
    key: f.value,
    label: f.label,
    href: comprasHref(tenantSlug, 'proveedores', {
      filtro: f.value === 'todos' ? null : f.value,
      vista: f.unclassifiedOnly ? 'lista' : null,
      q: q || null,
    }),
    active: f.value === filter,
    count: f.value === 'todos' ? undefined : counts[f.value],
  }))

  return (
    <SheetControls>
      <LiveSearch placeholder="Buscar un proveedor o un CUIT" className="w-full sm:w-64" />
      <Segment label="Qué proveedores ver" items={items} />
      <div className="ml-auto flex items-center gap-2">
        <ReadOnlyBadge />
        <SuppliersMenu
          tenantSlug={tenantSlug}
          canWrite={canWrite}
          existingNames={existingNames}
          classifyHref={comprasHref(tenantSlug, 'proveedores', { filtro: 'sin-clasificar' })}
          unclassified={counts['sin-clasificar']}
          exportHref={exportHref}
          exportFileName={exportFileName}
        />
      </div>
    </SheetControls>
  )
}

/** Plata en una columna: la raya si no hay nada. */
function Money({ cents, className }: { cents: number; className?: string }) {
  if (cents === 0) return <NoAmount />
  return <span className={className}>{formatCentsShort(cents)}</span>
}

/**
 * La planilla de proveedores: Proveedor · Vencido · Esta semana · Saldo y, al pasar, [Pagar] y el ⋯.
 * Toda la fila lleva a su cuenta corriente. Saldo es lo que se le debe (la misma suma que «Le debés»
 * de arriba); lo que hay a favor no se resta hasta que se usa en un pago: se dice en su fila.
 *
 * La contadora ve las mismas filas, sin [Pagar] y sin ⋯. Sin filas no dibuja nada: el vacío lo decide
 * quien la monta.
 */
export function LibretaList({
  tenantSlug,
  view,
  canWrite,
  pickable,
  backHref,
}: {
  tenantSlug: string
  view: LibretaView
  canWrite: boolean
  /** A quiénes se les puede elegir la categoría desde el ⋯ de la fila. */
  pickable: ReadonlySet<string>
  /** A dónde vuelve «Compra» al guardar: a esta lista, como estaba. */
  backHref: string
}) {
  if (view.shown.length === 0) return null

  const row = (entry: LibretaEntry) => {
    const { row: party, state } = entry
    const name = supplierShortName(party)
    const full = supplierDisplayName(party)
    const owes = party.debtCents > 0
    const actions = supplierRowActions(party)
    return (
      <PRow
        key={party.partyId}
        className={cn('relative', !party.active && 'text-muted-foreground')}
      >
        <PTd className="max-w-[24rem] max-sm:max-w-44">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              href={supplierHref(tenantSlug, party.partyId)}
              title={full}
              className={cn(ROW_LINK, 'min-w-0 truncate')}
            >
              {full}
            </Link>
            {party.partyKind !== 'supplier' ? (
              <StatusPill tone="muted" className="h-5">
                {PARTY_KIND_LABELS[party.partyKind] ?? 'Otro'}
              </StatusPill>
            ) : null}
            {party.active ? null : (
              <StatusPill tone="muted" className="h-5">
                Inactivo
              </StatusPill>
            )}
          </span>
        </PTd>
        <PTd align="right" className={PHONE_HIDDEN}>
          <Money cents={party.overdueCents} className="text-destructive" />
        </PTd>
        <PTd align="right" className={PHONE_HIDDEN}>
          <Money cents={party.dueSoonCents} />
        </PTd>
        {/* En el celular no está la columna Vencido: el saldo vencido se dice con el color. */}
        <PTd
          align="right"
          className={cn('font-semibold', party.overdueCents > 0 && 'max-sm:text-destructive')}
        >
          {owes ? (
            formatCentsShort(party.debtCents)
          ) : party.creditCents > 0 ? (
            <span className="font-normal text-success">
              A favor {formatCentsShort(party.creditCents)}
            </span>
          ) : (
            <NoAmount />
          )}
          {owes && party.creditCents > 0 ? (
            <span className="block text-xs font-normal text-success">
              {formatCentsShort(party.creditCents)} a favor
            </span>
          ) : null}
        </PTd>
        {canWrite ? (
          <PTd className={ROW_ACTIONS_CELL}>
            <span className={cn('inline-flex items-center justify-end gap-0.5', ROW_ACTION)}>
              {owes ? (
                <ActionButton
                  action="pagar"
                  params={{ proveedor: party.partyId }}
                  variant="outline"
                  size="sm"
                  className={ROW_BUTTON}
                  aria-label={`Pagarle a ${name}`}
                >
                  Pagar
                </ActionButton>
              ) : null}
              <SupplierRowMenu
                partyId={party.partyId}
                name={name}
                buyHref={
                  actions.canBuy
                    ? newPurchaseHref(tenantSlug, { proveedor: party.partyId, volver: backHref })
                    : null
                }
                paidHref={
                  actions.canBuy
                    ? newPurchaseHref(tenantSlug, {
                        modo: 'pago',
                        proveedor: party.partyId,
                        volver: backHref,
                      })
                    : null
                }
                canPay={actions.canPay}
                hasDebt={owes}
                account={
                  pickable.has(party.partyId)
                    ? state === 'unclassified'
                      ? 'pick'
                      : 'change'
                    : null
                }
                libretaHref={supplierHref(tenantSlug, party.partyId)}
              />
            </span>
          </PTd>
        ) : null}
      </PRow>
    )
  }

  return (
    <PTable label="Proveedores" minWidth={canWrite ? 620 : 520} className={PHONE_FIT}>
      <thead>
        <tr>
          <PTh>Proveedor</PTh>
          <PTh align="right" className={PHONE_HIDDEN}>
            Vencido
          </PTh>
          <PTh align="right" className={PHONE_HIDDEN}>
            Esta semana
          </PTh>
          <PTh align="right">Saldo</PTh>
          {canWrite ? (
            <PTh>
              <span className="sr-only">Acciones</span>
            </PTh>
          ) : null}
        </tr>
      </thead>
      <tbody>{view.shown.map(row)}</tbody>
      <tfoot>
        <PTotalRow>
          <PTd>
            Total
            {view.shown.length > 1 ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums max-sm:hidden">
                {view.shown.length} proveedores
              </span>
            ) : null}
          </PTd>
          <PTd align="right" className={PHONE_HIDDEN}>
            {formatCentsShort(view.totals.overdueCents)}
          </PTd>
          <PTd align="right" className={PHONE_HIDDEN}>
            {formatCentsShort(view.totals.dueSoonCents)}
          </PTd>
          <PTd align="right">{formatCentsShort(view.totals.debtCents)}</PTd>
          {canWrite ? <PTd /> : null}
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}

/** La salida de la lista filtrada por «Sin categoría» hacia el mazo de fichas. */
export function ClassifyHint({ tenantSlug }: { tenantSlug: string }) {
  return (
    <Link
      href={comprasHref(tenantSlug, 'proveedores', { filtro: 'sin-clasificar' })}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
    >
      <CornerDownRight aria-hidden className="size-3.5" />
      Clasificarlos de a uno
    </Link>
  )
}
