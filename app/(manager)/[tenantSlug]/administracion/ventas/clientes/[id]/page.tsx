import { HandCoins, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
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
import { SplitBar, type SplitBarSegment } from '@/components/administracion/charts/split-bar'
import {
  AdmHeader,
  AdmPage,
  HeroPanel,
  MoneyHero,
  PanelError,
  StatusPill,
  ViewPills,
} from '@/components/administracion/kit'
import { ActionButton, QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
import { Button } from '@/components/ui/button'
import { exportHref, PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import {
  getParty,
  getPartyPosition,
  getPartyStatement,
  type PartyDetail,
  type PartyStatementPage,
} from '@/lib/accounting/queries/parties'
import { listSalesMethods } from '@/lib/accounting/queries/settings'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import {
  groupOpenItems,
  partyCreditSentence,
  partySentence,
  TRANCHE_LABELS,
  type TrancheKey,
} from '../../_lib/incoming'
import { tabHref } from '../../_lib/ventas-view'
import { OpenItems } from './_components/open-items'
import { IVA_LABELS, PartyData } from './_components/party-data'

export const metadata = { title: 'Plata por cobrar' }

const VIEWS = ['pendiente', 'cuenta', 'datos'] as const
type FichaView = (typeof VIEWS)[number]

function parseView(value: string | null): FichaView {
  return (VIEWS as readonly string[]).includes(value ?? '') ? (value as FichaView) : 'pendiente'
}

/** Los mismos colores que «Plata por cobrar»: un tramo se ve y se llama igual en toda la sección. */
const TRANCHE_SWATCH: Readonly<Record<TrancheKey, string>> = {
  late: 'bg-destructive',
  week: 'bg-adm-s1',
  later: 'bg-adm-neutral',
  wallet: 'bg-adm-s4',
}

function displayName(p: Pick<PartyDetail, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

/**
 * La ficha de quien te debe (una tarjeta, una app, un cliente): «lo que te va
 * a pagar». Arriba, cuánto te debe, qué parte ya tendría que haber llegado y
 * «Ya entró» al lado. Abre en «Lo pendiente» (las ventas sin cobrar, agrupadas
 * por cuándo llegan); el estado de cuenta, que es la vista de la contadora, y
 * los datos quedan a un toque (`?ver=`).
 *
 * El estado de cuenta se pide solo cuando se mira (`?ver=cuenta`). Una
 * billetera con su caja no se cobra: se cuenta («Contar Mercado Pago»).
 */
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

  const view = parseView(firstParam(sp.ver))
  const path = `${base}/ventas/clientes/${party.id}`
  const range = resolveRange(sp, today)
  const after = firstParam(sp.despues)
  const isWalletKind = party.kind === 'payment_wallet'
  const [position, statement, treasuries, methods] = await Promise.all([
    settleQuery(getPartyPosition(tenantId, { partyId: party.id, group: 'receivables' })),
    view === 'cuenta' && range.ok
      ? settleQuery(
          getPartyStatement(tenantId, {
            partyId: party.id,
            from: range.from,
            to: range.to,
            after,
          }),
        )
      : null,
    isWalletKind ? settleQuery(listTreasuryAccounts(tenantId)) : null,
    // Para nombrar cada partida por su medio de cobro («Crédito · venta del 27/09»).
    view === 'pendiente'
      ? settleQuery(listSalesMethods(tenantId, { includeInactive: true }))
      : null,
  ])

  const name = displayName(party)
  const isCustomer = party.kind === 'customer'
  const pos = position.ok ? position.data : null
  const debtItems = pos?.debtItems ?? []
  const creditItems = pos?.creditItems ?? []
  const walletBox =
    treasuries?.ok === true
      ? (treasuries.data.find((t) => t.active && t.bankPartyId === party.id) ?? null)
      : null
  const credit = pos ? partyCreditSentence(pos, { isCustomer }) : null
  // La barra de arriba: lo que te debe, por cuándo llega (los tramos de «Plata por cobrar», sin
  // centavos y sin renglones en cero). Lo de una billetera con su caja ya está en la app: un solo
  // tramo, rayado. La antigüedad en días queda en «Estado de cuenta», que es de la contadora.
  const tranches: SplitBarSegment[] = walletBox
    ? [
        {
          key: 'wallet',
          label: TRANCHE_LABELS.wallet,
          cents: pos?.debtCents ?? 0,
          swatch: TRANCHE_SWATCH.wallet,
          hatched: true,
        },
      ]
    : groupOpenItems(debtItems, today).map((group) => ({
        key: group.key,
        label: group.title,
        cents: group.totalCents,
        swatch: TRANCHE_SWATCH[group.key],
      }))
  const picker: RangeValue = range.ok
    ? range
    : { kind: 'month', month: today.slice(0, 7), from: today, to: today, label: '' }
  const viewHref = (target: FichaView) =>
    hrefWith(path, {
      ver: target === 'pendiente' ? null : target,
      ...(target === 'cuenta' && range.ok && (sp.mes || sp.desde) ? periodParams(range) : {}),
    })

  const about = [
    party.tradeName && party.tradeName !== party.name ? party.name : null,
    party.taxId ? `CUIT ${formatCuit(party.taxId)}` : null,
    IVA_LABELS[party.ivaCondition] ?? null,
  ].filter(Boolean)

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: tabHref(base, 'clientes'), label: 'Plata por cobrar' }}
        title={name}
        badge={
          <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
            <StatusPill tone="muted">{PARTY_KIND_LABELS[party.kind] ?? 'Cliente'}</StatusPill>
            {party.active ? null : <StatusPill tone="muted">Desactivado</StatusPill>}
            <ReadOnlyBadge />
          </span>
        }
        description={about.length > 0 ? about.join(' · ') : undefined}
      />

      {pos ? (
        <HeroPanel tone="crema" className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            {pos.debtCents > 0 ? (
              <MoneyHero
                size="xl"
                cents={pos.debtCents}
                label="Te debe"
                sentence={
                  <>
                    {partySentence(pos, { today, walletName: walletBox?.name ?? null })}
                    {credit ? ` ${credit}` : ''}
                  </>
                }
              />
            ) : (
              <div className="min-w-0">
                <h2 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-balance">
                  No te debe nada
                </h2>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
                  {credit ?? 'Cuando tenga una venta sin cobrar, la vas a ver acá con su fecha.'}
                </p>
              </div>
            )}
            {canWrite && pos.debtCents > 0 ? (
              walletBox ? (
                <ActionButton
                  action="ajustar"
                  params={{ caja: walletBox.id }}
                  className="min-h-12 w-full shrink-0 gap-2 px-6 text-base font-semibold sm:w-auto"
                >
                  <Wallet className="size-4" aria-hidden />
                  Contar {walletBox.name}
                </ActionButton>
              ) : (
                <ActionButton
                  action="cobrar"
                  params={{ cliente: party.id }}
                  className="min-h-12 w-full shrink-0 gap-2 px-6 text-base font-semibold sm:w-auto"
                >
                  <HandCoins className="size-4" aria-hidden />
                  Ya entró
                </ActionButton>
              )
            ) : null}
          </div>
          {pos.debtCents > 0 && tranches.some((t) => t.cents > 0) ? (
            <SplitBar segments={tranches.filter((t) => t.cents > 0)} className="lg:max-w-[34rem]" />
          ) : null}
        </HeroPanel>
      ) : (
        <PanelError title="Te debe" message={position.ok ? '' : position.message} />
      )}

      <ViewPills
        label={`Vistas de ${name}`}
        items={[
          {
            key: 'pendiente',
            label: 'Lo pendiente',
            href: viewHref('pendiente'),
            active: view === 'pendiente',
            count: debtItems.length + creditItems.length || undefined,
            scroll: false,
          },
          {
            key: 'cuenta',
            label: 'Estado de cuenta',
            href: viewHref('cuenta'),
            active: view === 'cuenta',
            scroll: false,
          },
          {
            key: 'datos',
            label: 'Datos',
            href: viewHref('datos'),
            active: view === 'datos',
            scroll: false,
          },
        ]}
        aside={view === 'cuenta' ? <RangeFilter range={picker} today={today} /> : undefined}
      />

      {view === 'pendiente' ? (
        pos ? (
          <OpenItems
            name={name}
            partyId={party.id}
            debtItems={debtItems}
            creditItems={creditItems}
            methodNames={
              new Map(methods?.ok === true ? methods.data.map((m) => [m.id, m.name]) : [])
            }
            today={today}
            base={base}
            isCustomer={isCustomer}
            // Lo de una billetera con su caja se anota contándola, no cobrando venta por venta.
            canCollect={canWrite && walletBox === null}
          />
        ) : null
      ) : null}

      {view === 'cuenta' ? (
        <Statement
          tenantSlug={tenantSlug}
          base={base}
          path={path}
          partyId={party.id}
          name={name}
          today={today}
          range={range}
          after={after}
          statement={statement}
        />
      ) : null}

      {view === 'datos' ? (
        <PartyData party={party} isCustomer={isCustomer} base={base} canWrite={canWrite} />
      ) : null}

      <QuickActionsBar />
    </AdmPage>
  )
}

/** El estado de cuenta, tal cual: es la vista de la contadora. */
function Statement({
  tenantSlug,
  base,
  path,
  partyId,
  name,
  today,
  range,
  after,
  statement,
}: {
  tenantSlug: string
  base: string
  path: string
  partyId: string
  name: string
  today: string
  range: ReturnType<typeof resolveRange>
  after: string | null
  statement: QueryOutcome<PartyStatementPage> | null
}) {
  if (!range.ok) return <PeriodError message={range.message} />
  if (statement === null || !statement.ok) {
    return (
      <PanelError
        title="Estado de cuenta"
        message={statement && !statement.ok ? statement.message : ''}
      />
    )
  }
  const rows: StatementRow[] = statement.data.rows
    .filter((r) => r.rowKind === 'line')
    .map((r, index) => ({
      id: `${r.lineId ?? r.entryId ?? 'linea'}-${index}`,
      date: r.entryDate ?? range.from,
      voucher: r.documentLabel ?? 'Comprobante',
      href: r.documentId ? `${base}/comprobantes/${r.documentId}` : null,
      detail: r.memo,
      dueDate: r.dueDate,
      settled: r.openCents !== null && r.openCents <= 0,
      debitCents: r.increaseCents > 0 ? r.increaseCents : null,
      creditCents: r.decreaseCents > 0 ? r.decreaseCents : null,
      balanceCents: r.runningBalanceCents,
    }))
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton
          href={exportHref(tenantSlug, 'estado-de-cuenta', {
            participe: partyId,
            desde: range.from,
            hasta: range.to,
          })}
          fileName={`administracion-${tenantSlug}-estado-de-cuenta-${range.from}-${range.to}.csv`}
          className="h-11 md:pointer-fine:h-9"
        />
      </div>
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
            <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
              <Link href={hrefWith(path, { ver: 'cuenta', ...periodParams(range) })}>
                Volver al principio
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {statement.data.nextCursor ? (
            <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-9">
              <Link
                href={hrefWith(path, {
                  ver: 'cuenta',
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
    </div>
  )
}
