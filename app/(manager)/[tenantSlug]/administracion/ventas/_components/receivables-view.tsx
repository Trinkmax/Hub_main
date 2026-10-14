import { ArrowRight, CalendarCheck, HandCoins } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { DueStrip, DueStripTable } from '@/components/administracion/charts/due-strip'
import { SplitBar, type SplitBarSegment } from '@/components/administracion/charts/split-bar'
import {
  EmptyTeach,
  HeroPanel,
  MoneyHero,
  Panel,
  PanelError,
  PanelLink,
  RetryButton,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { exportHref } from '@/lib/accounting/queries/labels'
import { listParties, type PartyListRow } from '@/lib/accounting/queries/parties'
import { listSalesMethods, type SalesMethodRow } from '@/lib/accounting/queries/settings'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import {
  arrivalStops,
  incomingDays,
  incomingSentence,
  incomingTitle,
  receivableTranches,
  TRANCHE_LABELS,
  walletBoxes,
} from '../_lib/incoming'
import { getIncomingByDay } from '../_lib/incoming-data'
import { tabHref } from '../_lib/ventas-view'
import { ArrivalRule } from './arrival-rule'
import { FOLD_SUMMARY, FoldChevron } from './projection-panel'
import {
  parseReceivableFilter,
  type ReceivableFilter,
  ReceivablesFilters,
} from './receivables-filters'
import { ReceivablesList, SettledParties } from './receivables-list'
import { PanelSkeleton } from './skeletons'

/**
 * «Plata por cobrar»: el seguimiento de lo que te deben las tarjetas, las apps
 * y los clientes. Arriba, cuánto es y qué parte ya tendría que haber llegado,
 * con «Me entró plata» al lado; después, qué día llega cada cosa; y la lista
 * de quién te debe, con «Ya entró» en cada renglón (antes había que entrar a
 * la ficha para cobrar).
 *
 * Lo de Mercado Pago no figura como atrasado: va en su tramo («falta
 * contarla») y su botón es «Contar Mercado Pago».
 *
 * El bar que todavía no cargó ningún cierre con tarjetas ve, en vez de ceros,
 * cómo le paga hoy cada medio con sus plazos reales.
 */

/** Desde cuántos renglones el buscador queda a la vista. */
const SEARCH_FROM_ROWS = 8

type Props = {
  tenantId: string
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  today: string
  sp: PageSearchParams
  canWrite: boolean
}

function matches(row: PartyListRow, filter: ReceivableFilter, wallet: boolean): boolean {
  switch (filter) {
    case 'con-deuda':
      return row.debtCents > 0
    case 'atrasados':
      // Lo de una billetera ya está en la app: no cuenta como atrasado.
      return row.overdueCents > 0 && !wallet
    case 'a-favor':
      return row.creditCents > 0
    default:
      return true
  }
}

export async function ReceivablesView({ tenantId, tenantSlug, base, today, sp, canWrite }: Props) {
  const q = firstParam(sp.q)
  const filter = parseReceivableFilter(firstParam(sp.filtro))
  const everyone = settleQuery(listParties(tenantId, { group: 'receivables', filter: 'all' }))
  const [all, found, boxes, methods] = await Promise.all([
    everyone,
    // Con búsqueda, la lista se pide aparte: los totales de arriba son siempre los de todos.
    q ? settleQuery(listParties(tenantId, { group: 'receivables', q, filter: 'all' })) : everyone,
    settleQuery(listTreasuryAccounts(tenantId)),
    settleQuery(listSalesMethods(tenantId)),
  ])
  if (!all.ok) return <PanelError title="Plata por cobrar" message={all.message} />

  const { rows: everyRow, totals } = all.data
  const treasuries = boxes.ok ? boxes.data : []
  const wallets = walletBoxes(everyRow, treasuries)
  const tranches = receivableTranches(everyRow, new Set(wallets.keys()))
  const hasBank = treasuries.some((t) => t.active && t.kind === 'bank')
  const brandNew = totals.debtCents === 0 && totals.creditCents === 0 && !q

  const rule = <ArrivalBlock methods={methods} base={base} canWrite={canWrite} open={brandNew} />

  if (brandNew) {
    return (
      <div className="space-y-6">
        <HeroPanel tone="crema">
          <EmptyTeach
            plain
            icon={HandCoins}
            illustration={<ChartSilhouette kind="strip" />}
            title="Todavía no hay plata por cobrar"
            action={
              canWrite ? (
                <Button asChild className="min-h-12 gap-2 px-5 text-base">
                  <Link href={`${base}/ventas/cierre`}>
                    <CalendarCheck className="size-4" aria-hidden />
                    Cargar el cierre del día
                  </Link>
                </Button>
              ) : undefined
            }
          >
            Cuando {canWrite ? 'cargues' : 'se cargue'} un cierre con tarjetas, QR o apps, acá vas a
            ver cuánto te deben, quién y qué día llega.
          </EmptyTeach>
        </HeroPanel>
        {rule}
        {!hasBank && boxes.ok ? (
          <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm sm:px-5">
            <p className="text-pretty">
              No tenés un banco cargado. Si las tarjetas te depositan ahí, agregalo para anotar esa
              plata en su lugar.
            </p>
            {canWrite ? (
              <PanelLink href={`${base}/ajustes?tab=cajas`} className="mt-1">
                Agregar el banco
                <ArrowRight aria-hidden className="size-3.5" />
              </PanelLink>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const segments: SplitBarSegment[] = [
    {
      key: 'late',
      label: TRANCHE_LABELS.late,
      cents: tranches.lateCents,
      swatch: 'bg-destructive',
      href: tranches.lateCents > 0 ? tabHref(base, 'clientes', { filtro: 'atrasados' }) : undefined,
    },
    { key: 'week', label: TRANCHE_LABELS.week, cents: tranches.weekCents, swatch: 'bg-adm-s1' },
    {
      key: 'later',
      label: TRANCHE_LABELS.later,
      cents: tranches.laterCents,
      swatch: 'bg-adm-neutral',
    },
  ]
  if (tranches.walletCents > 0) {
    segments.push({
      key: 'wallet',
      label: TRANCHE_LABELS.wallet,
      cents: tranches.walletCents,
      swatch: 'bg-adm-s4',
      hatched: true,
    })
  }

  const listRows = found.ok ? found.data.rows : []
  const isWallet = (row: PartyListRow) => wallets.has(row.partyId)
  const counts: Record<ReceivableFilter, number> = {
    todos: listRows.length,
    'con-deuda': listRows.filter((r) => matches(r, 'con-deuda', isWallet(r))).length,
    atrasados: listRows.filter((r) => matches(r, 'atrasados', isWallet(r))).length,
    'a-favor': listRows.filter((r) => matches(r, 'a-favor', isWallet(r))).length,
  }
  const filtered = listRows.filter((r) => matches(r, filter, isWallet(r)))
  const open = filtered.filter((r) => r.debtCents > 0 || r.creditCents > 0)
  const settled = filtered.filter((r) => r.debtCents <= 0 && r.creditCents <= 0)
  const owing = everyRow.filter((r) => r.debtCents > 0 && !isWallet(r)).map((r) => r.partyId)

  return (
    <div className="space-y-6">
      <HeroPanel tone="crema" className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <MoneyHero
            size="xl"
            animate
            cents={totals.debtCents}
            label="Plata por cobrar"
            sentence={incomingSentence(tranches, { creditCents: totals.creditCents })}
          />
          {canWrite ? (
            <ActionButton
              action="cobrar"
              className="min-h-12 w-full shrink-0 gap-2 px-6 text-base font-semibold sm:w-auto"
            >
              <HandCoins className="size-4" aria-hidden />
              Me entró plata
            </ActionButton>
          ) : null}
        </div>
        <SplitBar segments={segments} totalLabel="Plata por cobrar" />
      </HeroPanel>

      <Suspense fallback={<PanelSkeleton tall />}>
        <IncomingDaysBlock tenantId={tenantId} owing={owing} today={today} />
      </Suspense>

      <Panel title="Quién te debe">
        {found.ok ? (
          <div className="space-y-4">
            <ReceivablesFilters
              base={base}
              active={filter}
              counts={counts}
              q={q}
              searchOpen={Boolean(q) || listRows.length > SEARCH_FROM_ROWS}
              aside={
                <ExportButton
                  href={exportHref(tenantSlug, 'saldos-clientes', { hasta: today })}
                  fileName={`administracion-${tenantSlug}-saldos-clientes-${today}.csv`}
                  variant="ghost"
                  size="sm"
                  className="h-11 text-muted-foreground md:pointer-fine:h-9"
                />
              }
            />
            {filtered.length === 0 ? (
              <p className="rounded-xl bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
                Probá con otro filtro o buscá por otro nombre o CUIT.
              </p>
            ) : (
              <>
                {/* En el celular la lista va de borde a borde del panel: con ese ancho de más, el
                    importe entra al lado del nombre y cada renglón mide un tercio menos. */}
                <div className="max-sm:-mx-4">
                  <ReceivablesList
                    rows={open}
                    wallets={wallets}
                    base={base}
                    today={today}
                    canWrite={canWrite}
                  />
                </div>
                <SettledParties rows={settled} base={base} />
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-muted-foreground text-pretty">
              {found.message}
            </p>
            <RetryButton />
          </div>
        )}
      </Panel>

      {rule}
    </div>
  )
}

/** «Cuándo llega»: lo que tiene que entrar cada día de las próximas dos semanas. */
async function IncomingDaysBlock({
  tenantId,
  owing,
  today,
}: {
  tenantId: string
  owing: readonly string[]
  today: string
}) {
  const result = await settleQuery(getIncomingByDay(tenantId, owing))
  if (!result.ok || result.data.kind === 'too_many') {
    return (
      <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm text-muted-foreground text-pretty sm:px-5">
        No pudimos armar el día por día. Abajo está cada uno con su fecha.
      </p>
    )
  }
  const incoming = incomingDays(result.data.items, today)
  if (incoming.totalCents <= 0) {
    return (
      <Panel title="Cuándo llega">
        <EmptyTeach
          plain
          illustration={<ChartSilhouette kind="bars" />}
          title="En estas dos semanas no llega nada"
        >
          Lo que ya tendría que haber llegado está arriba y en la lista de abajo.
        </EmptyTeach>
      </Panel>
    )
  }
  const days = incoming.days.map((day) => ({ ...day }))
  return (
    <Panel title="Cuándo llega">
      <ChartFrame
        title={incomingTitle(incoming, today)}
        sentence="Lo que tiene que entrar cada día de las próximas dos semanas, si todos pagan en fecha."
        chart={
          <DueStrip
            days={days}
            todayIndex={0}
            unit={['cobro', 'cobros']}
            showLegend={false}
            ariaLabel={`${incomingTitle(incoming, today)}.`}
          />
        }
        table={
          <DueStripTable
            days={days}
            unit={['cobro', 'cobros']}
            caption="Lo que te llega, por día"
          />
        }
      />
    </Panel>
  )
}

/** «¿Cuándo te paga cada medio?»: la regla de plazos del bar, con sus medios reales. */
function ArrivalBlock({
  methods,
  base,
  canWrite,
  open,
}: {
  methods: QueryOutcome<SalesMethodRow[]>
  base: string
  canWrite: boolean
  /** Abierto y con título propio: el estado vacío. */
  open: boolean
}) {
  if (!methods.ok) return null
  const stops = arrivalStops(methods.data)
  if (stops.length === 0) return null
  const change = canWrite ? (
    <PanelLink href={`${base}/ajustes?tab=medios`}>
      Cambiar los plazos
      <ArrowRight aria-hidden className="size-3.5" />
    </PanelLink>
  ) : null

  if (open) {
    return (
      <Panel
        title="Así te pagan hoy"
        description="Cada medio de cobro, con el plazo que tiene cargado."
        footer={change}
      >
        <ArrivalRule stops={stops} />
      </Panel>
    )
  }
  return (
    <Panel>
      <details className="group/fold">
        <summary className={FOLD_SUMMARY}>
          <span className="font-serif text-lg font-semibold tracking-tight">
            ¿Cuándo te paga cada medio?
          </span>
          <FoldChevron />
        </summary>
        <div className="space-y-3 pt-3">
          <ArrivalRule stops={stops} />
          {change}
        </div>
      </details>
    </Panel>
  )
}
