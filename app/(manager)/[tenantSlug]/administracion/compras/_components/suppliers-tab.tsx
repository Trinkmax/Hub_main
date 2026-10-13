import { CalendarClock, CircleAlert, CircleCheck, HandCoins, Truck, Wallet } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import {
  exportHref,
  listAccounts,
  listParties,
  PARTY_KIND_LABELS,
  type PartyListRow,
  settleQuery,
} from '@/lib/accounting/queries'
import {
  listPartyClassifications,
  type PartyClassification,
} from '@/lib/accounting/queries/party-classification'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { comprasHref, firstParam, newPurchaseHref, supplierHref } from '../_lib/links'
import {
  canPickAccount,
  countUnclassified,
  isVisibleSupplier,
  SUPPLIER_FILTERS,
  type SupplierAccountOption,
  type SupplierClassification,
  supplierAccountOptions,
  supplierClassification,
  supplierFilterOf,
  supplierRowActions,
  supplierTotals,
} from '../_lib/suppliers'
import { BlockError } from './block-error'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { ExportButton } from './export-button'
import { SearchFilter, SegmentFilter } from './list-filters'
import { PartyStatus } from './party-status'
import {
  SupplierAccountButton,
  SupplierAccountProvider,
  type SupplierAccountRow,
} from './supplier-account-picker'
import { SupplierRowMenu } from './supplier-row-menu'

function Dash() {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Nada</span>
    </span>
  )
}

/** «30-71876543-5» · o el tipo si no es un proveedor común («Organismo»). */
function subtitle(row: PartyListRow): string | null {
  const parts: string[] = []
  if (row.partyKind !== 'supplier') parts.push(PARTY_KIND_LABELS[row.partyKind] ?? 'Otro')
  if (row.taxId) parts.push(`CUIT ${formatCuit(row.taxId)}`)
  if (!row.active) parts.push('Inactivo')
  return parts.length > 0 ? parts.join(' · ') : null
}

function displayName(row: PartyListRow): string {
  return row.tradeName && row.tradeName !== row.partyName
    ? `${row.tradeName} (${row.partyName})`
    : row.partyName
}

/** Como se lo nombra en un aviso o en un diálogo: el de fantasía, si tiene. */
function shortName(row: PartyListRow): string {
  return row.tradeName && row.tradeName !== row.partyName ? row.tradeName : row.partyName
}

/** Una fila con su clasificación (`null` si no se pudieron leer las fichas). */
type SupplierView = {
  row: PartyListRow
  info: PartyClassification | null
  state: SupplierClassification | null
}

/**
 * La columna «Cuenta»: la cuenta habitual de la ficha o, con palabras, que
 * falta. A quien no se le compra (ARCA, sueldos) no le falta nada: una raya.
 */
function AccountName({ view }: { view: SupplierView }) {
  if (view.state === 'classified') {
    const name = view.info?.defaultAccountName
    return name ? (
      <span className="block truncate" title={name}>
        {name}
      </span>
    ) : (
      <Dash />
    )
  }
  if (view.state === 'unclassified') {
    return <span className="block text-muted-foreground">Sin clasificar</span>
  }
  return <Dash />
}

/** Con plan y permiso, la lista queda adentro del diálogo «Elegir cuenta»; si no, tal cual. */
function PickerScope({
  picker,
  children,
}: {
  picker: {
    tenantSlug: string
    accounts: SupplierAccountOption[]
    rows: SupplierAccountRow[]
  } | null
  children: ReactNode
}) {
  if (!picker) return <>{children}</>
  return (
    <SupplierAccountProvider
      tenantSlug={picker.tenantSlug}
      accounts={picker.accounts}
      rows={picker.rows}
    >
      {children}
    </SupplierAccountProvider>
  )
}

/**
 * «Proveedores» (H.7): números del grupo, buscador, segmentado, la tabla con
 * la cuenta, el saldo, el vencido, el semáforo y la última compra (tarjetas en
 * el celular) y los totales al pie. Desde el 12/10/2026 cada fila deja cargar
 * una compra, pagar y elegir la cuenta sin entrar a la ficha.
 */
export async function SuppliersTab({
  tenantId,
  tenantSlug,
  sp,
  today,
  canWrite,
}: {
  tenantId: string
  tenantSlug: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
}) {
  const q = firstParam(sp.q).slice(0, 80)
  const { value: filterValue, filter, unclassifiedOnly } = supplierFilterOf(firstParam(sp.filtro))
  // Las fichas (la cuenta de cada uno) y el plan van aparte de los saldos: si
  // fallan, la lista se ve igual, sin la columna «Cuenta» o sin «Elegir cuenta».
  const [outcome, classes, plan] = await Promise.all([
    settleQuery(listParties(tenantId, { group: 'payables', q, filter })),
    settleQuery(listPartyClassifications(tenantId, 'payables')),
    canWrite ? settleQuery(listAccounts(tenantId)) : null,
  ])

  if (!outcome.ok) return <BlockError message={outcome.message} />

  const { totals } = outcome.data
  const views: SupplierView[] = outcome.data.rows
    .filter((row) => isVisibleSupplier(row, filter))
    .map((row) => {
      const info = classes.ok ? (classes.data.get(row.partyId) ?? null) : null
      return { row, info, state: info ? supplierClassification(info) : null }
    })
    .filter((view) => !unclassifiedOnly || view.state === 'unclassified')
  const rows = views.map((view) => view.row)
  const foot = supplierTotals(rows)
  const hasQuery = q !== '' || filterValue !== 'todos'
  const exportLink = exportHref(tenantSlug, 'saldos-proveedores', { hasta: today })
  const existingNames = outcome.data.rows.map((row) => row.partyName)

  const pending = classes.ok ? countUnclassified(classes.data.values()) : 0
  const filters = SUPPLIER_FILTERS.map((f) =>
    f.unclassifiedOnly && pending > 0 ? { ...f, label: `${f.label} (${pending})` } : f,
  )

  // «Elegir cuenta» desde la fila: solo quien carga, y solo si se leyó el plan.
  const pickable: SupplierAccountRow[] = views.flatMap(({ row, info, state }) =>
    info && state && canPickAccount(state)
      ? [
          {
            partyId: row.partyId,
            name: row.partyName,
            displayName: shortName(row),
            kind: row.partyKind,
            updatedAt: info.updatedAt,
            accountId: info.defaultAccountId,
          },
        ]
      : [],
  )
  const picker =
    canWrite && plan?.ok
      ? {
          accounts: supplierAccountOptions(
            plan.data,
            new Set(pickable.flatMap((r) => (r.accountId ? [r.accountId] : []))),
          ),
          ids: new Set(pickable.map((r) => r.partyId)),
        }
      : null
  // A dónde vuelve «Cargar compra» al guardar: a esta lista, como estaba.
  const backHref = comprasHref(tenantSlug, 'proveedores', {
    filtro: filterValue === 'todos' ? null : filterValue,
    q: q || null,
  })
  /** El [⋯] de una fila, o `null` si no hay nada para hacer (o mira la contadora). */
  const menuOf = ({ row, state }: SupplierView): ReactNode => {
    if (!canWrite) return null
    const actions = supplierRowActions(row)
    const account = picker?.ids.has(row.partyId)
      ? state === 'unclassified'
        ? 'pick'
        : 'change'
      : null
    if (!actions.canBuy && !actions.canPay && account === null) return null
    return (
      <SupplierRowMenu
        partyId={row.partyId}
        name={shortName(row)}
        buyHref={
          actions.canBuy
            ? newPurchaseHref(tenantSlug, { proveedor: row.partyId, volver: backHref })
            : null
        }
        canPay={actions.canPay}
        account={account}
      />
    )
  }

  return (
    <div className="space-y-6">
      <section
        aria-label="Lo que le debés a proveedores"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          icon={Wallet}
          iconClassName="text-primary"
          label="Le debés"
          value={formatCentsShort(totals.debtCents)}
          hint={totals.debtCents > 0 ? 'Facturas sin pagar, a hoy' : 'No tenés facturas pendientes'}
        />
        <StatCard
          icon={CircleAlert}
          iconClassName={totals.overdueCents > 0 ? 'text-destructive' : 'text-muted-foreground'}
          label="Vencido"
          value={formatCentsShort(totals.overdueCents)}
          hint={totals.overdueCents > 0 ? 'Ya pasó el vencimiento' : 'Nada vencido'}
        />
        <StatCard
          icon={CalendarClock}
          iconClassName="text-warning"
          label="Vence en 7 días"
          value={formatCentsShort(totals.dueSoonCents)}
          hint="De hoy a una semana"
        />
        <StatCard
          icon={HandCoins}
          iconClassName="text-success"
          label="A favor sin aplicar"
          value={formatCentsShort(totals.creditCents)}
          hint={totals.creditCents > 0 ? 'Notas de crédito y pagos a cuenta' : 'Sin saldos a favor'}
        />
      </section>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentFilter
            options={filters}
            value={filterValue}
            param="filtro"
            defaultValue="todos"
            label="Qué proveedores ver"
          />
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            {canWrite ? (
              <BulkSuppliersDialog tenantSlug={tenantSlug} existingNames={existingNames} />
            ) : null}
            <ExportButton
              href={exportLink}
              fileName={`saldos-proveedores-${today}.csv`}
              label="Exportar saldos"
              className="h-11 md:h-9"
            />
          </div>
        </div>
        <SearchFilter placeholder="Proveedor o CUIT" />
      </div>

      {unclassifiedOnly && !classes.ok ? (
        <BlockError message={classes.message} />
      ) : rows.length === 0 ? (
        unclassifiedOnly && q === '' ? (
          <EmptyState
            icon={CircleCheck}
            title="No queda ninguno sin clasificar"
            description="Cada proveedor ya tiene su cuenta. Los que cargues de ahora en más aparecen acá hasta que se la elijas."
          />
        ) : hasQuery ? (
          <EmptyState
            icon={Truck}
            title="Sin resultados"
            description={
              q
                ? `No hay proveedores con «${q}» en esta vista. Probá con otro nombre o quitá el filtro.`
                : 'No hay proveedores en esta vista. Probá con «Todos».'
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="Todavía no hay proveedores"
            description="Se crean solos cuando cargás una factura o un gasto, o cargalos todos de una con «Cargar una lista»."
            action={
              canWrite ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild className="h-11 gap-2 md:h-9">
                    <Link href={newPurchaseHref(tenantSlug)}>Cargar factura</Link>
                  </Button>
                  <ActionButton action="gasto" variant="outline" className="h-11 md:h-9" />
                  <BulkSuppliersDialog tenantSlug={tenantSlug} existingNames={existingNames} />
                </div>
              ) : null
            }
          />
        )
      ) : (
        <PickerScope
          picker={picker ? { tenantSlug, accounts: picker.accounts, rows: pickable } : null}
        >
          {unclassifiedOnly ? (
            <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
              A estos proveedores les falta la cuenta donde van sus compras.
              {picker
                ? ' Elegísela una vez: queda en su ficha y sale sola cada vez que les cargás algo.'
                : ' Se elige en la ficha de cada uno.'}
            </p>
          ) : null}

          {/* Compu y tablet. Las columnas se muestran según el ancho de la tabla
              (@container), no de la ventana: con la barra lateral abierta en
              1280 px no entra todo y se apretaba el estado. Desde que la fila
              lleva «Cuenta» y sus acciones (12/10/2026), «A favor» baja debajo
              de «Le debés» cuando no hay lugar y «Última compra» pide más
              ancho que el del panel de hoy. */}
          <DataTableShell className="@container hidden sm:block">
            <DataTableScroll>
              <DataTableRoot>
                <caption className="sr-only">Proveedores con su cuenta y su saldo</caption>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Proveedor</DataTableHeader>
                    <DataTableHeader>Cuenta</DataTableHeader>
                    <DataTableHeader>Estado</DataTableHeader>
                    <DataTableHeader className="text-right">Le debés</DataTableHeader>
                    <DataTableHeader className="text-right">Vencido</DataTableHeader>
                    <DataTableHeader className="hidden @[72rem]:table-cell">
                      Próximo vencimiento
                    </DataTableHeader>
                    <DataTableHeader className="hidden text-right @[64rem]:table-cell">
                      A favor
                    </DataTableHeader>
                    <DataTableHeader className="hidden @[78rem]:table-cell">
                      Última compra
                    </DataTableHeader>
                    {canWrite ? (
                      <DataTableHeader className="text-right">
                        <span className="sr-only">Acciones</span>
                      </DataTableHeader>
                    ) : null}
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {views.map((view) => {
                    const { row } = view
                    const sub = subtitle(row)
                    return (
                      <tr
                        key={row.partyId}
                        className="group transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                      >
                        <DataTableCell className="max-w-[17rem]">
                          <Link
                            href={supplierHref(tenantSlug, row.partyId)}
                            title={displayName(row)}
                            className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block truncate font-medium group-hover:text-primary">
                              {displayName(row)}
                            </span>
                            {sub ? (
                              <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                                {sub}
                              </span>
                            ) : null}
                          </Link>
                        </DataTableCell>
                        <DataTableCell className="max-w-[12rem]">
                          <AccountName view={view} />
                          {view.state === 'unclassified' && picker?.ids.has(row.partyId) ? (
                            <SupplierAccountButton
                              partyId={row.partyId}
                              supplierName={shortName(row)}
                              hasAccount={false}
                            />
                          ) : null}
                        </DataTableCell>
                        <DataTableCell className="min-w-44">
                          <PartyStatus light={row.trafficLight} text={row.trafficText} />
                        </DataTableCell>
                        <DataTableCell className="text-right">
                          {row.debtCents > 0 ? (
                            <Amount cents={row.debtCents} className="font-medium" />
                          ) : (
                            <Dash />
                          )}
                          {row.creditCents > 0 ? (
                            <span className="mt-0.5 block whitespace-nowrap text-[11px] text-success @[64rem]:hidden">
                              A favor <Amount cents={row.creditCents} />
                            </span>
                          ) : null}
                        </DataTableCell>
                        <DataTableCell className="text-right">
                          {row.overdueCents > 0 ? (
                            <Amount cents={row.overdueCents} className="text-destructive" />
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                        <DataTableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground @[72rem]:table-cell">
                          {row.nextDueDate ? formatIsoDay(row.nextDueDate) : <Dash />}
                        </DataTableCell>
                        <DataTableCell className="hidden text-right @[64rem]:table-cell">
                          {row.creditCents > 0 ? (
                            <Amount cents={row.creditCents} className="text-success" />
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                        <DataTableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground @[78rem]:table-cell">
                          {row.lastIncreaseDate ? formatIsoDay(row.lastIncreaseDate) : <Dash />}
                        </DataTableCell>
                        {canWrite ? (
                          <DataTableCell className="text-right">
                            <div className="flex justify-end">{menuOf(view)}</div>
                          </DataTableCell>
                        ) : null}
                      </tr>
                    )
                  })}
                </DataTableBody>
                <tfoot className="border-t border-border bg-secondary/30 font-semibold">
                  <tr>
                    <DataTableCell colSpan={3} className="text-xs">
                      Total
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={foot.debtCents} />
                      {foot.creditCents > 0 ? (
                        <span className="mt-0.5 block whitespace-nowrap text-[11px] font-normal text-success @[64rem]:hidden">
                          A favor <Amount cents={foot.creditCents} />
                        </span>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount
                        cents={foot.overdueCents}
                        className={cn(foot.overdueCents > 0 && 'text-destructive')}
                      />
                    </DataTableCell>
                    <DataTableCell className="hidden @[72rem]:table-cell">{null}</DataTableCell>
                    <DataTableCell className="hidden text-right @[64rem]:table-cell">
                      <Amount cents={foot.creditCents} />
                    </DataTableCell>
                    <DataTableCell className="hidden @[78rem]:table-cell">{null}</DataTableCell>
                    {canWrite ? <DataTableCell>{null}</DataTableCell> : null}
                  </tr>
                </tfoot>
              </DataTableRoot>
            </DataTableScroll>
            <DataTableFooter>
              <span>
                Mostrando{' '}
                <strong className="tabular-nums text-foreground">
                  {plural(rows.length, 'proveedor', 'proveedores')}
                </strong>
              </span>
            </DataTableFooter>
          </DataTableShell>

          {/* Celular: tarjetas, con los mismos números que la tabla y la franja de
              arriba: «Le debés» son las facturas sin pagar y lo «A favor» va
              aparte (no se resta). Sin deuda ni saldo a favor, lo dice el estado.
              Abajo de cada una, su cuenta y el menú con las acciones. */}
          <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
            <ul aria-label="Proveedores con su saldo" className="divide-y divide-border/60">
              {views.map((view) => {
                const { row } = view
                const sub = subtitle(row)
                const menu = menuOf(view)
                const showsAccount = view.state === 'classified' || view.state === 'unclassified'
                const hasFooter = showsAccount || menu !== null
                return (
                  <li key={row.partyId}>
                    <Link
                      href={supplierHref(tenantSlug, row.partyId)}
                      className={cn(
                        'flex min-h-11 items-start justify-between gap-3 px-4 pt-3 outline-none focus-visible:bg-cream-tint active:bg-cream-tint',
                        hasFooter ? 'pb-2' : 'pb-3',
                      )}
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-pretty">
                          {displayName(row)}
                        </span>
                        {sub ? (
                          <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                            {sub}
                          </span>
                        ) : null}
                        <PartyStatus light={row.trafficLight} text={row.trafficText} />
                      </span>
                      {row.debtCents > 0 ? (
                        <span className="shrink-0 text-right text-sm">
                          <Amount cents={row.debtCents} balance="payable" />
                          {row.overdueCents > 0 ? (
                            <span className="mt-0.5 block text-[11px] text-destructive">
                              Vencido <Amount cents={row.overdueCents} />
                            </span>
                          ) : null}
                          {row.creditCents > 0 ? (
                            <span className="mt-0.5 block text-[11px] text-success">
                              A favor <Amount cents={row.creditCents} />
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </Link>
                    {hasFooter ? (
                      <div className="flex min-h-11 items-center gap-3 px-4 pb-2">
                        {showsAccount ? (
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
                            <span className="text-muted-foreground">Cuenta:</span>
                            <span className="min-w-0">
                              <AccountName view={view} />
                            </span>
                            {view.state === 'unclassified' && picker?.ids.has(row.partyId) ? (
                              <SupplierAccountButton
                                partyId={row.partyId}
                                supplierName={shortName(row)}
                                hasAccount={false}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {menu ? <div className="ml-auto">{menu}</div> : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <div className="flex items-start justify-between gap-3 border-t border-border/60 bg-secondary/30 px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span className="text-right">
                <Amount cents={foot.debtCents} balance="payable" />
                {foot.creditCents > 0 ? (
                  <span className="mt-0.5 block text-[11px] font-normal text-success">
                    A favor <Amount cents={foot.creditCents} />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </PickerScope>
      )}
    </div>
  )
}
