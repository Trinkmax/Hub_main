import { HandCoins } from 'lucide-react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { firstParam, type PageSearchParams } from '@/components/administracion/cajas-ventas/periods'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette, LegendKey } from '@/components/administracion/charts/chart-parts'
import { EmptyTeach, MoneyHero, Panel, PanelError } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { getNetByMethod } from '@/lib/accounting/queries/books'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { exportHref } from '@/lib/accounting/queries/labels'
import { listSalesMethods } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { capitalizeFirst } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  NET_SEGMENT_LABELS,
  type NetMethodInfo,
  type NetRowView,
  type NetSegmentKey,
  netRowDetail,
  netRows,
  netSentence,
  netTitle,
  netTotals,
} from '../_lib/net-view'
import type { VentasFocus } from '../_lib/ventas-view'
import { CollectionsList } from './collections-list'
import { NetByMethod } from './net-by-method'
import { PanelFocus } from './panel-focus'
import { Pager, periodWords, rangeOrError } from './ventas-views'

/**
 * «Lo que llegó»: lo que ya te depositaron y cuánto se quedó cada medio en el
 * camino. Arriba, «De cada $ 100»: un renglón por medio de cobro, del más caro
 * al más barato, con una barra de lo ya liquidado partida en lo que te llegó y
 * lo que descontaron. Abajo, la lista de cobros del período.
 *
 * Junta lo que eran «Neto por medio» y «Cobros» (los dos `?tab=` siguen
 * andando: `cobros` baja solo hasta la lista).
 */

/** El color de cada tramo, escrito entero (Tailwind no ve clases armadas por partes). */
const SEGMENT_SWATCH: Readonly<Record<NetSegmentKey, string>> = {
  arrived: 'bg-adm-s1',
  commission: 'bg-adm-s2',
  withholdings: 'bg-adm-s3',
  other: 'bg-adm-neutral',
}

const SEGMENT_ORDER: readonly NetSegmentKey[] = ['arrived', 'commission', 'withholdings', 'other']

/**
 * El dibujo: un renglón por medio, cada uno un billete de $ 100 cortado. La
 * barra es decorativa (`aria-hidden`): el dato es el renglón escrito, así no
 * hay treinta paradas de Tab. El ancho de la barra no cambia con el importe:
 * siempre es «cien».
 */
function HundredBar({
  rows,
  methods,
}: {
  rows: readonly NetRowView[]
  /** Cómo le llega la plata a cada medio, por id (para decir «entró directo a la caja»). */
  methods: ReadonlyMap<string, NetMethodInfo>
}) {
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {SEGMENT_ORDER.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <LegendKey swatch={SEGMENT_SWATCH[key]} />
            {NET_SEGMENT_LABELS[key]}
          </li>
        ))}
      </ul>
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <p className="min-w-0">
                <span className="font-medium">{row.name}</span>{' '}
                <span className="text-xs text-muted-foreground">{row.channelLabel}</span>
              </p>
              <p
                className={cn(
                  'text-sm tabular-nums text-pretty',
                  row.state === 'pending' ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                {row.line}
              </p>
            </div>
            {row.segments.length > 0 ? (
              <div
                aria-hidden
                className="rail-grow flex h-2.5 gap-0.5 overflow-hidden rounded-full"
              >
                {row.segments.map((segment) => (
                  <span
                    key={segment.key}
                    className={cn(
                      'h-full min-w-1.5 first:rounded-l-full',
                      SEGMENT_SWATCH[segment.key],
                    )}
                    style={{ width: `${Math.round(segment.percent * 100) / 100}%` }}
                  />
                ))}
              </div>
            ) : (
              <div
                aria-hidden
                className="h-2.5 rounded-full border border-dashed border-adm-neutral/80"
              />
            )}
            {row.state !== 'pending' ? (
              <p className="text-xs tabular-nums text-muted-foreground text-pretty">
                {netRowDetail(row, methods.get(row.id))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Una cifra quieta al lado del héroe: dice qué es y cuánto. */
function QuietFigure({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-xl bg-secondary/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-serif text-lg font-semibold leading-tight tracking-tight tabular-nums">
        {formatCentsShort(cents)}
      </p>
    </div>
  )
}

export async function NetView({
  tenantId,
  tenantSlug,
  base,
  today,
  sp,
  canWrite,
  focus,
}: {
  tenantId: string
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  today: string
  sp: PageSearchParams
  canWrite: boolean
  focus: VentasFocus | null
}) {
  const { range } = rangeOrError(sp, today)
  if (!range.ok) return <PeriodError message={range.message} />
  const after = firstParam(sp.despues)
  const [net, page, methods] = await Promise.all([
    settleQuery(getNetByMethod(tenantId, { from: range.from, to: range.to })),
    settleQuery(
      listDocuments(tenantId, {
        from: range.from,
        to: range.to,
        kinds: ['collection'],
        status: 'all',
        after,
      }),
    ),
    // Solo para decir cómo le llega la plata a cada medio; si falla, se dice como siempre.
    settleQuery(listSalesMethods(tenantId, { includeInactive: true })),
  ])
  const methodInfo = new Map<string, NetMethodInfo>(
    methods.ok
      ? methods.data.map((m) => [
          m.id,
          { kind: m.kind, partyName: m.partyName, treasuryName: m.treasuryName },
        ])
      : [],
  )
  const words = periodWords(range)
  const collectionsTitle = `Cobros ${words.of}`

  return (
    <div className="space-y-6">
      {net.ok ? (
        <HundredPanel
          rows={net.data}
          methods={methodInfo}
          label={range.label}
          period={words.in}
          canWrite={canWrite}
          exportHref={exportHref(tenantSlug, 'neto-por-medio', {
            desde: range.from,
            hasta: range.to,
          })}
          exportFileName={`administracion-${tenantSlug}-neto-por-medio-${range.from}-${range.to}.csv`}
        />
      ) : (
        <PanelError title="De cada $ 100" message={net.message} />
      )}

      {page.ok ? (
        <Panel
          id="cobros"
          title={collectionsTitle}
          description="Lo que ya te depositaron las tarjetas y las apps, y lo que te pagaron los clientes."
          action={
            <ExportButton
              href={exportHref(tenantSlug, 'subdiario-cobranzas', {
                desde: range.from,
                hasta: range.to,
              })}
              fileName={`administracion-${tenantSlug}-subdiario-cobranzas-${range.from}-${range.to}.csv`}
              label="Exportar subdiario de cobranzas"
              variant="ghost"
              size="sm"
              className="h-11 text-muted-foreground max-sm:hidden md:pointer-fine:h-9"
            />
          }
        >
          {page.data.rows.length === 0 ? (
            <EmptyTeach
              plain
              icon={HandCoins}
              title={`No hay cobros ${words.in}`}
              action={
                canWrite ? (
                  <ActionButton action="cobrar" className="h-11 gap-2 px-5">
                    <HandCoins className="size-4" aria-hidden />
                    Me entró plata
                  </ActionButton>
                ) : undefined
              }
            >
              {canWrite
                ? 'Cuando te deposita una tarjeta o una app, o te paga un cliente, lo anotás con «Me entró plata». Lo de Mercado Pago entra cuando contás la caja de Mercado Pago.'
                : 'Cuando una tarjeta o una app deposita, o paga un cliente, los dueños lo anotan y aparece acá. Lo de Mercado Pago entra cuando cuentan la caja de Mercado Pago.'}
            </EmptyTeach>
          ) : (
            <div className="space-y-4">
              <div className="max-sm:-mx-4">
                <CollectionsList rows={page.data.rows} base={base} />
              </div>
              <Pager
                base={base}
                tab="cobros"
                range={range}
                nextCursor={page.data.nextCursor}
                isFirst={after === null}
              />
              <div className="sm:hidden">
                <ExportButton
                  href={exportHref(tenantSlug, 'subdiario-cobranzas', {
                    desde: range.from,
                    hasta: range.to,
                  })}
                  fileName={`administracion-${tenantSlug}-subdiario-cobranzas-${range.from}-${range.to}.csv`}
                  label="Exportar subdiario de cobranzas"
                  size="sm"
                  className="h-11 w-full"
                />
              </div>
            </div>
          )}
        </Panel>
      ) : (
        <PanelError title={collectionsTitle} message={page.message} />
      )}

      {focus === 'cobros' ? <PanelFocus target="cobros" /> : null}
    </div>
  )
}

function HundredPanel({
  rows,
  methods,
  label,
  period,
  canWrite,
  exportHref: href,
  exportFileName,
}: {
  rows: Awaited<ReturnType<typeof getNetByMethod>>
  methods: ReadonlyMap<string, NetMethodInfo>
  /** «Octubre 2026». */
  label: string
  /** «en octubre». */
  period: string
  canWrite: boolean
  exportHref: string
  exportFileName: string
}) {
  const views = netRows(rows)
  if (views.length === 0) {
    return (
      <Panel title="De cada $ 100">
        <EmptyTeach
          plain
          illustration={<ChartSilhouette kind="rank" />}
          title={`Todavía no hay ventas ni cobros ${period}`}
        >
          Cuando {canWrite ? 'cargues' : 'se carguen'} cierres y {canWrite ? 'anotes' : 'se anote'}{' '}
          lo que te depositan, acá vas a ver cuánto se queda cada medio.
        </EmptyTeach>
      </Panel>
    )
  }
  const totals = netTotals(rows)
  // Si todavía no llegó nada, no se dibuja «$ 0» como número grande: lo dice el título de abajo
  // («Todavía no te liquidaron nada…») y queda a la vista lo que sigue en camino.
  const arrived = totals.creditedCents > 0
  return (
    <Panel title="De cada $ 100">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {arrived ? (
          <MoneyHero size="lg" cents={totals.creditedCents} label={`Te llegó ${period}`} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {arrived || totals.deductedCents > 0 ? (
            <QuietFigure label="Te descontaron" cents={totals.deductedCents} />
          ) : null}
          <QuietFigure label="Sigue en camino" cents={totals.pendingCents} />
        </div>
      </div>
      <div className="mt-5 border-t border-border/60 pt-5">
        <ChartFrame
          title={capitalizeFirst(netTitle(views, period))}
          sentence={netSentence(totals)}
          defaultView={canWrite ? 'chart' : 'table'}
          chart={<HundredBar rows={views} methods={methods} />}
          table={<NetByMethod rows={rows} label={label} />}
          footer={
            <ExportButton
              href={href}
              fileName={exportFileName}
              variant="ghost"
              size="sm"
              className="h-11 text-muted-foreground md:pointer-fine:h-9"
            />
          }
        />
      </div>
    </Panel>
  )
}
