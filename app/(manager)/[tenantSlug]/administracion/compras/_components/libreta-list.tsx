import { FilePlus2 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import {
  categoryShortName,
  LedgerGroup,
  LedgerList,
  LedgerRail,
  LedgerRow,
  PillLink,
  StatusPill,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import {
  type LibretaEntry,
  type LibretaView,
  ledgerRail,
  supplierDisplayName,
  supplierShortName,
} from '../_lib/libreta'
import { comprasHref, newPurchaseHref, supplierHref } from '../_lib/links'
import { SUPPLIER_FILTERS, type SupplierFilterValue, supplierRowActions } from '../_lib/suppliers'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { DebtBar } from './debt-bar'
import { ExportButton } from './export-button'
import { LiveSearch } from './list-filters'
import { SupplierAccountButton } from './supplier-account-picker'
import { SupplierRowMenu } from './supplier-row-menu'

/**
 * La barra de la libreta: el buscador (busca mientras se escribe), los filtros
 * como píldoras con su contador (la elegida, rellena en tinta) y, calladas a la
 * derecha, «Agregar de una lista» y «Exportar saldos».
 *
 * Los filtros viven en la URL (`?filtro=`): cada píldora es un link, así la
 * lista se comparte y «atrás» funciona. El contador de cada una sale de la
 * misma lectura que la lista (`libretaView`): nunca dicen distinto.
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
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <LiveSearch
          placeholder="Buscar un proveedor o un CUIT"
          className="w-full lg:max-w-sm lg:flex-1"
        />
        <div className="flex flex-wrap items-center gap-1 lg:ml-auto">
          {canWrite ? (
            <BulkSuppliersDialog
              tenantSlug={tenantSlug}
              existingNames={existingNames}
              variant="ghost"
              className="h-11 gap-2 text-muted-foreground hover:text-foreground md:h-9"
            />
          ) : null}
          <ExportButton
            href={exportHref}
            fileName={exportFileName}
            label="Exportar saldos"
            variant="ghost"
            className="h-11 text-muted-foreground hover:text-foreground md:h-9"
          />
        </div>
      </div>
      <nav aria-label="Qué proveedores ver">
        {/* En el celular la fila desliza, con desvanecido a la derecha: se nota que sigue. */}
        <ul className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
          {SUPPLIER_FILTERS.map((f) => (
            <li key={f.value} className="shrink-0">
              <PillLink
                href={comprasHref(tenantSlug, 'proveedores', {
                  filtro: f.value === 'todos' ? null : f.value,
                  q: q || null,
                })}
                scroll={false}
                active={f.value === filter}
                // Sin pastilla cuando es cero: un «0» al lado de cada filtro es ruido.
                count={counts[f.value] > 0 ? counts[f.value] : undefined}
                className="h-11 md:pointer-fine:h-9"
              >
                {f.label}
              </PillLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/** La línea gris de un renglón: su categoría (o el botón para elegirla) y la última compra. */
function RowMeta({
  entry,
  canPick,
  compact = false,
}: {
  entry: LibretaEntry
  /** Se le puede elegir la categoría desde acá (quien carga, con el plan leído). */
  canPick: boolean
  compact?: boolean
}) {
  const { row, info, state } = entry
  const bits: ReactNode[] = []
  if (row.partyKind !== 'supplier') {
    bits.push(
      <StatusPill key="kind" tone="muted">
        {PARTY_KIND_LABELS[row.partyKind] ?? 'Otro'}
      </StatusPill>,
    )
  }
  if (!row.active) {
    bits.push(
      <StatusPill key="off" tone="muted">
        Inactivo
      </StatusPill>,
    )
  }
  if (state === 'classified' && info?.defaultAccountName) {
    bits.push(
      <span key="cat" className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary/60" />
        <span className="truncate" title={info.defaultAccountName}>
          {categoryShortName(info.defaultAccountName)}
        </span>
      </span>,
    )
  } else if (state === 'unclassified') {
    bits.push(
      canPick ? (
        <SupplierAccountButton
          key="cat"
          partyId={row.partyId}
          supplierName={supplierShortName(row)}
          hasAccount={false}
        />
      ) : (
        <span key="cat">Sin categoría</span>
      ),
    )
  }
  if (row.lastIncreaseDate) {
    bits.push(
      <span key="last" className="whitespace-nowrap tabular-nums">
        última compra {formatDayMonth(row.lastIncreaseDate)}
      </span>,
    )
  }
  if (bits.length === 0) return null
  return (
    <span
      className={
        compact
          ? 'flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs'
          : 'flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]'
      }
    >
      {bits}
    </span>
  )
}

/**
 * La libreta: UNA hoja con el margen de cuaderno. A la izquierda de la raya,
 * desde cuándo o para cuándo («vencido hace 12 días»); en el medio, quién, en
 * qué le comprás y su deuda dibujada; a la derecha, cuánto le debés y la acción
 * del momento, [Pagar].
 *
 * Tres grupos: «Les debés» (lo más vencido arriba), «Tenés a favor» y «Sin
 * deuda» (renglones angostos; los que no entran, detrás de «Ver los N que
 * faltan»). La lista no se reordena al tocar nada.
 *
 * La contadora ve los mismos renglones sin [Pagar], sin ⋯, sin «Elegir
 * categoría» y sin «Cargarle una compra»: la página se lo pasa con
 * `canWrite={false}` y con `pickable` vacío.
 *
 * Sin renglones no dibuja nada: el vacío lo decide quien la monta.
 */
export function LibretaList({
  tenantSlug,
  view,
  today,
  canWrite,
  pickable,
  backHref,
}: {
  tenantSlug: string
  view: LibretaView
  today: string
  canWrite: boolean
  /** A quiénes se les puede elegir la categoría desde el renglón. */
  pickable: ReadonlySet<string>
  /** A dónde vuelve «Cargarle una compra» al guardar: a esta lista, como estaba. */
  backHref: string
}) {
  if (view.shown.length === 0) return null

  const menuOf = (entry: LibretaEntry): ReactNode => {
    if (!canWrite) return undefined
    const { row, state } = entry
    const actions = supplierRowActions(row)
    return (
      <SupplierRowMenu
        partyId={row.partyId}
        name={supplierShortName(row)}
        buyHref={
          actions.canBuy
            ? newPurchaseHref(tenantSlug, { proveedor: row.partyId, volver: backHref })
            : null
        }
        canPay={actions.canPay}
        hasDebt={row.debtCents > 0}
        account={pickable.has(row.partyId) ? (state === 'unclassified' ? 'pick' : 'change') : null}
        libretaHref={supplierHref(tenantSlug, row.partyId)}
      />
    )
  }

  const fullRow = (entry: LibretaEntry) => {
    const { row } = entry
    const rail = ledgerRail(row, today)
    const owes = row.debtCents > 0
    const later = Math.max(0, row.debtCents - row.overdueCents - row.dueSoonCents)
    const partlyOverdue = row.overdueCents > 0 && row.overdueCents < row.debtCents
    return (
      <LedgerRow
        key={row.partyId}
        rail={rail ? <LedgerRail {...rail} /> : undefined}
        title={supplierDisplayName(row)}
        href={supplierHref(tenantSlug, row.partyId)}
        muted={!row.active}
        meta={<RowMeta entry={entry} canPick={canWrite && pickable.has(row.partyId)} />}
        bar={
          owes ? (
            <DebtBar
              overdueCents={row.overdueCents}
              soonCents={row.dueSoonCents}
              laterCents={later}
              maxCents={view.maxDebtCents}
            />
          ) : undefined
        }
        amount={
          <>
            <span className="block text-[11px] font-normal text-muted-foreground">
              {owes ? 'Le debés' : 'Tenés a favor'}
            </span>
            <Amount
              cents={owes ? row.debtCents : row.creditCents}
              decimals={0}
              className="text-base"
            />
          </>
        }
        amountNote={
          owes && (partlyOverdue || row.creditCents > 0) ? (
            <>
              {partlyOverdue ? (
                <span className="block whitespace-nowrap text-destructive">
                  {formatCentsShort(row.overdueCents)} vencido
                </span>
              ) : null}
              {row.creditCents > 0 ? (
                <span className="block whitespace-nowrap">
                  {formatCentsShort(row.creditCents)} a favor
                </span>
              ) : null}
            </>
          ) : undefined
        }
        action={
          canWrite && owes ? (
            <ActionButton
              action="pagar"
              params={{ proveedor: row.partyId }}
              variant="outline"
              className="h-11 rounded-full px-5 md:h-9"
              aria-label={`Pagarle a ${supplierShortName(row)}`}
            >
              Pagar
            </ActionButton>
          ) : undefined
        }
        menu={menuOf(entry)}
      />
    )
  }

  const denseRow = (entry: LibretaEntry) => {
    const { row } = entry
    const actions = supplierRowActions(row)
    const name = supplierShortName(row)
    return (
      <LedgerRow
        key={row.partyId}
        dense
        title={supplierDisplayName(row)}
        href={supplierHref(tenantSlug, row.partyId)}
        muted={!row.active}
        meta={<RowMeta entry={entry} canPick={canWrite && pickable.has(row.partyId)} compact />}
        action={
          canWrite && actions.canBuy ? (
            <Button
              asChild
              variant="ghost"
              className="h-11 gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground max-sm:w-11 max-sm:px-0 md:h-9"
            >
              <Link
                href={newPurchaseHref(tenantSlug, { proveedor: row.partyId, volver: backHref })}
                aria-label={`Cargarle una compra a ${name}`}
              >
                <FilePlus2 aria-hidden className="size-4" />
                {/* En el celular va solo el ícono: el nombre necesita el ancho. */}
                <span aria-hidden className="max-sm:hidden">
                  Cargarle una compra
                </span>
              </Link>
            </Button>
          ) : undefined
        }
        menu={menuOf(entry)}
      />
    )
  }

  const debtCents = view.debt.reduce((sum, e) => sum + e.row.debtCents, 0)
  const creditOnlyCents = view.credit.reduce((sum, e) => sum + e.row.creditCents, 0)
  const settledCount = view.settled.length + view.settledMore.length

  return (
    <LedgerList
      aria-label="Proveedores"
      footer={
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p>
            {/* Sin deuda entre los que se ven no se escribe un «$ 0»: se dice. */}
            {view.totals.debtCents > 0 ? (
              <>
                Total: le debés{' '}
                <strong className="font-semibold whitespace-nowrap text-foreground tabular-nums">
                  {formatCentsShort(view.totals.debtCents)}
                </strong>
              </>
            ) : (
              'A estos no les debés nada'
            )}
            {view.totals.creditCents > 0 ? (
              <span className="whitespace-nowrap">
                {' '}
                · a favor {formatCentsShort(view.totals.creditCents)}
              </span>
            ) : null}
          </p>
          <p className="text-xs">
            Mostrando {plural(view.shown.length, 'proveedor', 'proveedores')}
          </p>
        </div>
      }
    >
      <LedgerGroup title="Les debés" count={view.debt.length} aside={formatCentsShort(debtCents)}>
        {view.debt.map(fullRow)}
      </LedgerGroup>
      <LedgerGroup
        title="Tenés a favor"
        count={view.credit.length}
        aside={formatCentsShort(creditOnlyCents)}
      >
        {view.credit.map(fullRow)}
      </LedgerGroup>
      <LedgerGroup
        title="Sin deuda"
        count={settledCount}
        more={
          view.settledMore.length > 0
            ? {
                label: `Ver los ${view.settledMore.length} que faltan`,
                children: view.settledMore.map(denseRow),
              }
            : undefined
        }
      >
        {view.settled.map(denseRow)}
      </LedgerGroup>
    </LedgerList>
  )
}
