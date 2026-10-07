import { AlarmClock, ArrowLeft, CalendarDays, HandCoins, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AgingBar } from '@/components/administracion/aging-bar'
import { Amount } from '@/components/administracion/amount'
import { BlockError, PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  hrefWith,
  periodParams,
  type RangeValue,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import { TrafficStatus } from '@/components/administracion/cajas-ventas/traffic-status'
import { DueStatus } from '@/components/administracion/due-status'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { agingBuckets } from '@/lib/accounting/aging'
import { exportHref, PARTY_KIND_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import {
  getParty,
  getPartyPosition,
  getPartyStatement,
  type OpenItemRow,
  type PartyDetail,
} from '@/lib/accounting/queries/parties'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCentsShort } from '@/lib/money'

export const metadata = { title: 'Cliente o plataforma' }

const TAB_CLASS = 'data-[state=active]:bg-card data-[state=active]:shadow-sm'

const IVA_LABELS: Readonly<Record<string, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos',
}

const COMMISSION_VAT_LABELS: Readonly<Record<PartyDetail['commissionVatMode'], string>> = {
  per_settlement: 'Viene en cada liquidación',
  monthly_invoice: 'Factura una vez por mes',
  none: 'No factura',
}

function displayName(p: Pick<PartyDetail, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireAdminPage(tenantSlug, `${base}/ventas/clientes/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const party = await getParty(tenantId, id)
  if (!party) notFound()
  // Un proveedor (le debés) se mira en Compras.
  if (party.group !== 'receivables') redirect(`${base}/compras/proveedores/${party.id}`)

  const range = resolveRange(sp, today)
  const after = firstParam(sp.despues)
  const [position, statement] = await Promise.all([
    settleQuery(getPartyPosition(tenantId, { partyId: party.id, group: 'receivables' })),
    range.ok
      ? settleQuery(
          getPartyStatement(tenantId, {
            partyId: party.id,
            from: range.from,
            to: range.to,
            after,
          }),
        )
      : Promise.resolve(null),
  ])

  const name = displayName(party)
  const isCustomer = party.kind === 'customer'
  const pos = position.ok ? position.data : null
  const creditWord = isCustomer ? 'A favor' : 'Le debemos'
  const picker: RangeValue = range.ok
    ? range
    : { kind: 'month', month: today.slice(0, 7), from: today, to: today, label: '' }

  const rows: StatementRow[] =
    statement?.ok === true
      ? statement.data.rows
          .filter((r) => r.rowKind === 'line')
          .map((r, index) => ({
            id: `${r.lineId ?? r.entryId ?? 'linea'}-${index}`,
            date: r.entryDate ?? picker.from,
            voucher: r.documentLabel ?? 'Comprobante',
            href: r.documentId ? `${base}/comprobantes/${r.documentId}` : null,
            detail: r.memo,
            dueDate: r.dueDate,
            settled: r.openCents !== null && r.openCents <= 0,
            debitCents: r.increaseCents > 0 ? r.increaseCents : null,
            creditCents: r.decreaseCents > 0 ? r.decreaseCents : null,
            balanceCents: r.runningBalanceCents,
          }))
      : []
  const debtItems = pos?.debtItems ?? []
  const creditItems = pos?.creditItems ?? []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        href={`${base}/ventas?tab=clientes`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a clientes y plataformas
      </Link>

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">{name}</h1>
              <Badge variant="outline">{PARTY_KIND_LABELS[party.kind] ?? 'Cliente'}</Badge>
              {party.active ? null : <Badge variant="muted">Desactivado</Badge>}
              <ReadOnlyBadge className="ml-0" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {party.tradeName && party.tradeName !== party.name ? <span>{party.name}</span> : null}
              {party.taxId ? (
                <span className="tabular-nums">CUIT {formatCuit(party.taxId)}</span>
              ) : null}
              <span>{IVA_LABELS[party.ivaCondition] ?? 'Sin datos'}</span>
            </div>
            {pos ? (
              <TrafficStatus light={pos.traffic.light} text={pos.traffic.text} className="mt-2" />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <ActionButton
              action="cobrar"
              params={{ cliente: party.id }}
              size="sm"
              className="h-11 gap-2 md:h-8"
            >
              <HandCoins className="size-3.5" aria-hidden />
              Registrar un cobro
            </ActionButton>
          </div>
        </div>
      </div>

      {pos ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={HandCoins}
              iconClassName="text-primary"
              label="Te debe"
              value={formatCentsShort(pos.debtCents)}
              hint={
                debtItems.length > 0
                  ? `${debtItems.length} ${debtItems.length === 1 ? 'venta pendiente' : 'ventas pendientes'}`
                  : 'Sin deuda'
              }
            />
            <StatCard
              icon={AlarmClock}
              iconClassName={pos.aging.overdueCents > 0 ? 'text-destructive' : 'text-success'}
              label="Atrasado"
              value={formatCentsShort(pos.aging.overdueCents)}
              hint={
                pos.aging.oldestDueDate
                  ? `Desde el ${formatIsoDay(pos.aging.oldestDueDate)}`
                  : 'Nada atrasado'
              }
            />
            <StatCard
              icon={CalendarDays}
              iconClassName="text-info"
              label={isCustomer ? 'Próximo vencimiento' : 'Próxima acreditación'}
              value={pos.aging.nextDueDate ? formatIsoDay(pos.aging.nextDueDate) : '—'}
            />
            <StatCard
              icon={Undo2}
              iconClassName="text-warning"
              label={creditWord}
              value={formatCentsShort(pos.creditCents)}
              hint={
                pos.creditCents > 0
                  ? isCustomer
                    ? 'Anticipos o notas de crédito sin usar'
                    : 'Se descuenta en la próxima liquidación'
                  : undefined
              }
            />
          </div>
          {pos.debtCents > 0 ? (
            <div className="card-hairline rounded-xl border bg-card p-5">
              <AgingBar
                title="Te debe"
                buckets={agingBuckets(
                  debtItems.map((i) => ({ dueDate: i.dueDate, openCents: i.openCents })),
                  today,
                )}
              />
            </div>
          ) : null}
        </>
      ) : (
        <BlockError message={position.ok ? '' : position.message} />
      )}

      <Tabs defaultValue="estado">
        <TabsList className="bg-secondary/40">
          <TabsTrigger value="estado" className={TAB_CLASS}>
            Estado de cuenta
          </TabsTrigger>
          <TabsTrigger value="pendiente" className={`gap-1.5 ${TAB_CLASS}`}>
            Pendiente
            {debtItems.length + creditItems.length > 0 ? (
              <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {debtItems.length + creditItems.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="datos" className={TAB_CLASS}>
            Datos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="estado" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RangeFilter range={picker} today={today} />
            {range.ok ? (
              <ExportButton
                href={exportHref(tenantSlug, 'estado-de-cuenta', {
                  participe: party.id,
                  desde: range.from,
                  hasta: range.to,
                })}
                fileName={`administracion-${tenantSlug}-estado-de-cuenta-${range.from}-${range.to}.csv`}
                className="h-11 md:h-9"
              />
            ) : null}
          </div>
          {!range.ok ? (
            <PeriodError message={range.message} />
          ) : statement === null || !statement.ok ? (
            <BlockError message={statement && !statement.ok ? statement.message : ''} />
          ) : (
            <>
              <StatementTable
                rows={rows}
                caption={`Estado de cuenta de ${name}, ${range.label}`}
                balanceMode="receivable"
                columnLabels={{ debit: 'Ventas', credit: 'Cobros' }}
                showDue
                today={today}
                opening={
                  after === null && statement.data.openingCents !== null
                    ? { balanceCents: statement.data.openingCents }
                    : null
                }
                closing={
                  statement.data.nextCursor === null
                    ? {
                        label: `Saldo al ${formatIsoDay(range.to)}`,
                        balanceCents: rows.at(-1)?.balanceCents ?? statement.data.openingCents ?? 0,
                      }
                    : null
                }
                emptyText="No hubo ventas ni cobros en este período."
                footnote={
                  statement.data.totalRows > rows.length
                    ? `Mostrando ${rows.length} de ${statement.data.totalRows} movimientos del período.`
                    : undefined
                }
              />
              {statement.data.nextCursor || after !== null ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {after !== null ? (
                    <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
                      <Link
                        href={hrefWith(`${base}/ventas/clientes/${party.id}`, periodParams(range))}
                      >
                        Volver al principio
                      </Link>
                    </Button>
                  ) : (
                    <span />
                  )}
                  {statement.data.nextCursor ? (
                    <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
                      <Link
                        href={hrefWith(`${base}/ventas/clientes/${party.id}`, {
                          ...periodParams(range),
                          despues: statement.data.nextCursor,
                        })}
                      >
                        Ver los siguientes
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="pendiente" className="mt-4 space-y-4">
          {!pos ? null : debtItems.length === 0 && creditItems.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="No hay nada pendiente"
              description={`${name} no te debe nada y no tiene saldos a favor.`}
            />
          ) : (
            <>
              {debtItems.length > 0 ? (
                <OpenItemsTable
                  title={isCustomer ? 'Ventas sin cobrar' : 'Por acreditar'}
                  items={debtItems}
                  today={today}
                  base={base}
                  partyId={party.id}
                  canCollect={canWrite}
                />
              ) : null}
              {creditItems.length > 0 ? (
                <OpenItemsTable
                  title={isCustomer ? 'Saldos a favor del cliente' : 'Lo que le debemos'}
                  items={creditItems}
                  today={today}
                  base={base}
                  partyId={party.id}
                  canCollect={false}
                />
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="datos" className="mt-4">
          <div className="card-hairline grid gap-x-6 gap-y-3 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2">
            <DataLine label="Razón social" value={party.name} />
            <DataLine label="CUIT" value={party.taxId ? formatCuit(party.taxId) : 'Sin cargar'} />
            <DataLine
              label="Condición frente al IVA"
              value={IVA_LABELS[party.ivaCondition] ?? 'Sin datos'}
            />
            <DataLine
              label={isCustomer ? 'Plazo para pagar' : 'Se acredita en'}
              value={
                party.paymentTermDays > 0
                  ? `${party.paymentTermDays} ${party.paymentTermDays === 1 ? 'día' : 'días'}`
                  : 'Al contado'
              }
            />
            <DataLine label="Cuenta" value={party.receivableAccountName ?? '—'} />
            {isCustomer ? null : (
              <>
                <DataLine
                  label="Factura de la comisión"
                  value={COMMISSION_VAT_LABELS[party.commissionVatMode]}
                />
                <DataLine
                  label="Comisión"
                  value={party.commissionBp !== null ? vatRateLabel(party.commissionBp) : '—'}
                />
                <DataLine
                  label="Retención de IIBB"
                  value={
                    party.iibbWithholdingBp !== null ? vatRateLabel(party.iibbWithholdingBp) : '—'
                  }
                />
                <DataLine
                  label="Retención de IVA"
                  value={
                    party.vatWithholdingBp !== null ? vatRateLabel(party.vatWithholdingBp) : '—'
                  }
                />
                <DataLine
                  label="Retención de Ganancias"
                  value={
                    party.incomeTaxWithholdingBp !== null
                      ? vatRateLabel(party.incomeTaxWithholdingBp)
                      : '—'
                  }
                />
                <DataLine
                  label="SIRCUPA"
                  value={party.sircupaBp !== null ? vatRateLabel(party.sircupaBp) : '—'}
                />
              </>
            )}
            {party.notes ? <DataLine label="Notas" value={party.notes} /> : null}
            {canWrite ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Las tasas sirven para precargar los descuentos al registrar un cobro. Se cambian en{' '}
                <Link
                  href={`${base}/ajustes?tab=participes`}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Ajustes › Partícipes
                </Link>
                .
              </p>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 sm:block sm:border-0 sm:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium sm:mt-0.5 sm:block sm:text-left">{value}</span>
    </div>
  )
}

/** Las partidas abiertas: comprobante, fecha, vencimiento y lo que falta; [Cobrar] en cada una. */
function OpenItemsTable({
  title,
  items,
  today,
  base,
  partyId,
  canCollect,
}: {
  title: string
  items: readonly OpenItemRow[]
  today: string
  base: string
  partyId: string
  canCollect: boolean
}) {
  return (
    <DataTableShell>
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="font-serif text-base font-semibold tracking-tight">{title}</h2>
      </header>
      <DataTableScroll>
        <DataTableRoot>
          <caption className="sr-only">{title}</caption>
          <DataTableHead>
            <tr>
              <DataTableHeader className="w-28">Fecha</DataTableHeader>
              <DataTableHeader>Comprobante</DataTableHeader>
              <DataTableHeader>Vence</DataTableHeader>
              <DataTableHeader className="text-right">Pendiente</DataTableHeader>
              {canCollect ? (
                <DataTableHeader className="w-0">
                  <span className="sr-only">Acciones</span>
                </DataTableHeader>
              ) : null}
            </tr>
          </DataTableHead>
          <DataTableBody>
            {items.map((item) => (
              <tr key={item.lineId} className="hover:bg-cream-tint">
                <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatIsoDay(item.entryDate)}
                </DataTableCell>
                <DataTableCell className="font-medium">
                  <Link
                    href={`${base}/comprobantes/${item.documentId}`}
                    className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.documentLabel}
                  </Link>
                  {item.memo ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.memo}
                    </span>
                  ) : null}
                </DataTableCell>
                <DataTableCell>
                  {item.dueDate ? (
                    <DueStatus dueDate={item.dueDate} today={today} group="receivables" showDate />
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={item.openCents} />
                </DataTableCell>
                {canCollect ? (
                  <DataTableCell>
                    <ActionButton
                      action="cobrar"
                      params={{ cliente: partyId, partida: item.lineId }}
                      variant="ghost"
                      size="sm"
                      aria-label={`Cobrar ${item.documentLabel}`}
                    >
                      Cobrar
                    </ActionButton>
                  </DataTableCell>
                ) : null}
              </tr>
            ))}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
    </DataTableShell>
  )
}
