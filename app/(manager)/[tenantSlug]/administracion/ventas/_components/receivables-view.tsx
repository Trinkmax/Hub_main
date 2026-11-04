import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { DueStrip, DueStripTable } from '@/components/administracion/charts/due-strip'
import { PanelError, PanelLink, RetryButton } from '@/components/administracion/kit'
import { Planilla, PlanillaBar, PlanillaFoot } from '@/components/administracion/planilla'
import { Totalizer, type TotalizerItem } from '@/components/administracion/planilla/totalizer'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { exportHref } from '@/lib/accounting/queries/labels'
import { listParties, type PartyListRow } from '@/lib/accounting/queries/parties'
import { listSalesMethods, type SalesMethodRow } from '@/lib/accounting/queries/settings'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import {
  arrivalStops,
  incomingDays,
  incomingTitle,
  receivableTranches,
  TRANCHE_LABELS,
  walletBoxes,
} from '../_lib/incoming'
import { getIncomingByDay } from '../_lib/incoming-data'
import { ArrivalRule } from './arrival-rule'
import { PlanillaFold } from './fold'
import {
  parseReceivableFilter,
  type ReceivableFilter,
  ReceivablesFilters,
} from './receivables-filters'
import { ReceivablesList, SettledParties } from './receivables-list'

/**
 * «Por cobrar»: lo que te deben las tarjetas, las apps y los clientes. Arriba, cuánto es y cuánto ya
 * tendría que haber llegado; debajo, un renglón por pagador con cuándo llega y «Ya entró» (antes
 * había que entrar a la ficha para cobrar).
 *
 * Lo de Mercado Pago no figura como atrasado: va aparte («falta contarla») y su botón es «Contar
 * Mercado Pago». El día por día y los plazos de cada medio quedan plegados debajo.
 *
 * El bar que todavía no cargó ningún cierre con tarjetas ve, en vez de ceros, una oración, cómo llegar
 * a cargarlo y cómo le paga hoy cada medio.
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
  if (!all.ok) return <PanelError title="Por cobrar" message={all.message} />

  const { rows: everyRow, totals } = all.data
  const treasuries = boxes.ok ? boxes.data : []
  const wallets = walletBoxes(everyRow, treasuries)
  const tranches = receivableTranches(everyRow, new Set(wallets.keys()))
  const hasBank = treasuries.some((t) => t.active && t.kind === 'bank')
  const brandNew = totals.debtCents === 0 && totals.creditCents === 0 && !q

  if (brandNew) {
    return (
      <>
        <ReadOnlyBadge className="w-fit" />
        {/* Vacío: una oración y un botón, adentro de la misma planilla. */}
        <Planilla>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
            <p className="min-w-0 text-sm text-pretty">
              <span className="font-medium">Todavía no hay plata por cobrar.</span> Cuando{' '}
              {canWrite ? 'cargues' : 'se cargue'} un cierre con tarjetas, QR o apps, acá vas a ver
              cuánto te deben, quién y qué día llega.
            </p>
            {canWrite ? (
              <Button asChild size="sm" className="pointer-coarse:h-10">
                <Link href={`${base}/ventas/cierre`}>Cargar el cierre del día</Link>
              </Button>
            ) : null}
          </div>
        </Planilla>
        <ArrivalBlock methods={methods} base={base} canWrite={canWrite} open />
        {!hasBank && boxes.ok ? (
          <p className="px-1 text-sm text-muted-foreground text-pretty">
            No tenés un banco cargado. Si las tarjetas te depositan ahí, agregalo para anotar esa
            plata en su lugar.
            {canWrite ? (
              <PanelLink href={`${base}/ajustes?tab=cajas`} className="ml-2 sm:inline-flex">
                Agregar el banco
                <ArrowRight aria-hidden className="size-3.5" />
              </PanelLink>
            ) : null}
          </p>
        ) : null}
      </>
    )
  }

  const items: TotalizerItem[] = [
    { label: 'Te tienen que depositar', cents: totals.debtCents },
    {
      label: 'Atrasado',
      cents: tranches.lateCents > 0 ? tranches.lateCents : null,
      tone: tranches.lateCents > 0 ? 'bad' : 'default',
    },
    ...(tranches.walletCents > 0
      ? [{ label: TRANCHE_LABELS.wallet, cents: tranches.walletCents }]
      : []),
    ...(totals.creditCents > 0 ? [{ label: 'A favor', cents: totals.creditCents }] : []),
  ]

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
    <>
      <PlanillaBar>
        <ReceivablesFilters
          base={base}
          active={filter}
          counts={counts}
          q={q}
          searchOpen={Boolean(q) || listRows.length > SEARCH_FROM_ROWS}
        />
        <ReadOnlyBadge />
        {canWrite ? (
          <ActionButton action="cobrar" size="sm" className="ml-auto pointer-coarse:h-10">
            Me entró plata
          </ActionButton>
        ) : null}
      </PlanillaBar>

      <Totalizer items={items} />

      <Planilla>
        {!found.ok ? (
          <div className="flex flex-col items-start gap-3 px-3 py-3">
            <p role="alert" className="text-sm text-muted-foreground text-pretty">
              {found.message}
            </p>
            <RetryButton />
          </div>
        ) : open.length > 0 ? (
          <ReceivablesList
            rows={open}
            wallets={wallets}
            base={base}
            today={today}
            canWrite={canWrite}
          />
        ) : (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground text-pretty">
            Probá con otro filtro o buscá por otro nombre o CUIT.
          </p>
        )}
        <PlanillaFoot>
          <SettledParties rows={settled} base={base} />
          <ExportButton
            href={exportHref(tenantSlug, 'saldos-clientes', { hasta: today })}
            fileName={`administracion-${tenantSlug}-saldos-clientes-${today}.csv`}
            variant="outline"
            size="sm"
            className="ml-auto pointer-coarse:h-10"
          />
        </PlanillaFoot>
      </Planilla>

      <PlanillaFold title="Cuándo llega, día por día">
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Armando el día por día…</p>}
        >
          <IncomingDaysBlock tenantId={tenantId} owing={owing} today={today} />
        </Suspense>
      </PlanillaFold>

      <ArrivalBlock methods={methods} base={base} canWrite={canWrite} open={false} />
    </>
  )
}

/** Lo que tiene que entrar cada día de las próximas dos semanas. */
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
      <p className="text-sm text-muted-foreground text-pretty">
        No pudimos armar el día por día. Arriba está cada uno con su fecha.
      </p>
    )
  }
  const incoming = incomingDays(result.data.items, today)
  if (incoming.totalCents <= 0) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        En estas dos semanas no llega nada. Lo atrasado está en la planilla de arriba.
      </p>
    )
  }
  const days = incoming.days.map((day) => ({ ...day }))
  return (
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
        <DueStripTable days={days} unit={['cobro', 'cobros']} caption="Lo que te llega, por día" />
      }
    />
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
  /** Abierto y con otro título: el estado vacío. */
  open: boolean
}) {
  if (!methods.ok) return null
  const stops = arrivalStops(methods.data)
  if (stops.length === 0) return null
  return (
    <PlanillaFold title={open ? 'Así te pagan hoy' : '¿Cuándo te paga cada medio?'} open={open}>
      <div className="space-y-3">
        <ArrivalRule stops={stops} />
        {canWrite ? (
          <PanelLink href={`${base}/ajustes?tab=medios`}>
            Cambiar los plazos
            <ArrowRight aria-hidden className="size-3.5" />
          </PanelLink>
        ) : null}
      </div>
    </PlanillaFold>
  )
}
