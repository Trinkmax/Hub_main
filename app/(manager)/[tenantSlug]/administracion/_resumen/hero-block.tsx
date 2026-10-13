import {
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Equal,
  Landmark,
  type LucideIcon,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { BalanceArea, type BalanceAreaPoint } from '@/components/administracion/charts/balance-area'
import { dayShort } from '@/components/administracion/charts/chart-parts'
import { OTHERS_SWATCH, seriesSwatch } from '@/components/administracion/charts/palette'
import { percentShort, sharePercents } from '@/components/administracion/charts/scale'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { HeroPanel, MoneyHero } from '@/components/administracion/kit/hero'
import { LegendPill } from '@/components/administracion/kit/pill'
import {
  type BalanceTrend,
  balancePoints,
  balanceTrend,
  HOME_CASH_DAYS,
  heroState,
  homeCashRange,
  type TreasuryBar,
  treasurySegments,
} from '@/lib/accounting/home'
import type { SummaryTreasury } from '@/lib/accounting/queries/summary'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { HomeActionButton } from './home-action'
import type { HomeData } from './home-data'
import { RetryButton } from './retry-button'

export type HeroTone = 'bosque' | 'crema'

/**
 * Las clases que cambian entre el panel verde y la variante clara. Adentro del
 * verde rigen los tokens del modo oscuro (es una isla): el texto propio usa
 * los `adm-hero-*` y los fondos internos van en blanco translúcido.
 */
const INK = {
  bosque: {
    fg: 'text-adm-hero-fg',
    muted: 'text-adm-hero-muted',
    accent: 'text-adm-gold',
    aside:
      'border-t border-white/12 pt-4 lg:rounded-2xl lg:border-t-0 lg:bg-white/8 lg:p-5 lg:pt-5',
    slot: 'border-white/25',
    pill: 'border-white/12 bg-white/8 hover:bg-white/14',
    link: 'text-adm-hero-fg',
  },
  crema: {
    fg: 'text-foreground',
    muted: 'text-muted-foreground',
    accent: 'text-primary',
    aside:
      'border-t border-border/60 pt-4 lg:rounded-2xl lg:border-t-0 lg:bg-secondary/50 lg:p-5 lg:pt-5',
    slot: 'border-border',
    pill: '',
    link: 'text-foreground',
  },
} as const

type Ink = (typeof INK)[HeroTone]

const KIND_ICON: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CircleDollarSign,
  other: CircleDollarSign,
}

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em]'

/**
 * El héroe del Resumen, «la plata hoy»: el número, la oración que lo explica,
 * la barra de dónde está (una caja = un color, siempre el mismo) y, al lado,
 * cómo cambió en los últimos 30 días.
 *
 * Cuando el cero no es un dato (faltan los saldos iniciales y nada se movió, o
 * no hay cajas) no se muestra «$ 0»: el héroe dice que todavía no sabe cuánta
 * plata hay y ofrece el paso que lo resuelve.
 */
export async function HeroBlock({ data, tone }: { data: HomeData; tone: HeroTone }) {
  const [summaryResult, settingsResult, cashResult] = await Promise.all([
    data.summary,
    data.settings,
    data.cash,
  ])
  const ink = INK[tone]
  const onHero = tone === 'bosque'

  if (!summaryResult.ok) {
    return (
      <HeroPanel tone="crema" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-balance">
          No pudimos cargar el resumen.
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {summaryResult.message}
        </p>
        <RetryButton />
      </HeroPanel>
    )
  }

  const summary = summaryResult.data
  const settings = settingsResult.ok ? settingsResult.data : null
  const state = heroState(summary, settings, { canWrite: data.canWrite, base: data.base })
  const layout = 'grid gap-x-8 gap-y-4 sm:gap-y-5 lg:grid-cols-12 lg:items-stretch'

  if (state.kind === 'unknown') {
    const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')
    return (
      <HeroPanel tone={tone} className={layout}>
        <div className={cn('min-w-0', assets.length > 0 ? 'lg:col-span-7' : 'lg:col-span-12')}>
          <h2
            className={cn(
              'font-serif text-3xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-[2.6rem]',
              ink.fg,
            )}
          >
            {state.title}
          </h2>
          <p
            className={cn(
              'mt-3 max-w-prose text-sm leading-relaxed text-pretty sm:text-base',
              ink.muted,
            )}
          >
            {state.sentence}
          </p>
          {state.action ? (
            <HomeActionButton
              action={state.action}
              variant="default"
              className="mt-5 min-h-12 w-full gap-2 px-6 text-base font-semibold sm:w-auto"
            >
              {state.action.label}
              <ArrowRight className="size-4" aria-hidden />
            </HomeActionButton>
          ) : null}
        </div>
        {assets.length > 0 ? (
          <EmptySlots treasuries={assets} ink={ink} className="lg:col-span-5" />
        ) : null}
      </HeroPanel>
    )
  }

  const bar = treasurySegments(summary)
  const range = homeCashRange(data.today)
  const cashOpts = { ...range, booksStartDate: settings?.booksStartDate ?? null }
  const trend = cashResult.ok ? balanceTrend(cashResult.data.total, cashOpts) : null
  const points = cashResult.ok ? balancePoints(cashResult.data.total, cashOpts) : []

  return (
    <HeroPanel tone={tone} className={layout}>
      <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-7">
        <MoneyHero
          // Un descubierto se dice con palabras, nunca con un menos.
          label={state.overdrawn ? 'Hoy estás en descubierto por' : 'Plata disponible hoy'}
          cents={Math.abs(state.cents)}
          sentence={state.sentence}
          tone={onHero ? 'onHero' : 'default'}
          animate
        />
        <WhereItIs bar={bar} base={data.base} ink={ink} />
      </div>
      <aside
        aria-label={`Cómo cambió la plata en los últimos ${HOME_CASH_DAYS} días`}
        className={cn('min-w-0 lg:col-span-5', ink.aside)}
      >
        {trend ? (
          <Trend trend={trend} points={points} from={range.from} ink={ink} onHero={onHero} />
        ) : (
          <div className="space-y-3">
            <p className={cn('text-sm text-pretty', ink.muted)}>
              No pudimos cargar cómo cambió la plata en los últimos {HOME_CASH_DAYS} días.
            </p>
            <RetryButton />
          </div>
        )}
      </aside>
    </HeroPanel>
  )
}

/** La barra partida por caja y su leyenda: cada píldora lleva a los movimientos de esa caja. */
function WhereItIs({ bar, base, ink }: { bar: TreasuryBar; base: string; ink: Ink }) {
  if (bar.isEmpty) {
    return (
      <Link
        href={`${base}/cajas`}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0',
          ink.link,
        )}
      >
        Ver las cajas
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    )
  }

  const shares = sharePercents(bar.segments.map((s) => s.cents))
  const segments = bar.segments.map((s) => ({
    key: s.key,
    label: s.name,
    cents: s.cents,
    // El color sigue a la caja por su lugar en Ajustes, no por cuánta plata tiene hoy.
    swatch: s.slot === null ? OTHERS_SWATCH : seriesSwatch(s.slot - 1),
    href: `${base}${s.path ?? '/cajas'}`,
  }))

  return (
    <div className="space-y-3">
      <SplitBar segments={segments} height={14} showLegend={false} />
      {/* En el celular las píldoras van en una sola fila que se desliza: apiladas, tres cajas
          empujaban «Hoy te toca» fuera de la primera pantalla. */}
      <ul className="-mx-5 -my-1 flex gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {segments.map((s, i) => (
          <li key={s.key} className="shrink-0">
            <LegendPill
              swatchClassName={s.swatch}
              label={s.label}
              value={formatCentsShort(s.cents)}
              share={segments.length > 1 ? percentShort(shares[i] ?? 0, true) : undefined}
              href={s.href}
              className={ink.pill}
            />
          </li>
        ))}
      </ul>
      <Asides bar={bar} base={base} ink={ink} />
    </div>
  )
}

/**
 * Lo que no entra en la barra porque no es plata disponible: una cuenta en
 * descubierto y la tarjeta de la empresa (una deuda). La oración de arriba ya
 * dice cuánto es; acá queda el camino a los movimientos de cada una.
 */
function Asides({ bar, base, ink }: { bar: TreasuryBar; base: string; ink: Ink }) {
  const rows = [
    ...bar.overdrawn.map((t) => ({ ...t, text: `${t.name}: descubierto` })),
    ...bar.cards.map((t) => ({ ...t, text: `${t.name}: debe` })),
  ]
  if (rows.length === 0) return null
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs', ink.muted)}>
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`${base}${row.path}`}
            className="inline-flex min-h-9 items-center gap-1 rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.text}
            <span className={cn('font-medium tabular-nums', ink.fg)}>
              {formatCentsShort(row.cents)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Equal } as const

/**
 * «Hace 30 días había $ X» y la diferencia en palabras, con el saldo día por
 * día dibujado. En el celular queda en un renglón: el dibujo se guarda para
 * cuando hay lugar, así la primera acción entra en la primera pantalla.
 */
function Trend({
  trend,
  points,
  from,
  ink,
  onHero,
}: {
  trend: BalanceTrend
  points: readonly BalanceAreaPoint[]
  from: string
  ink: Ink
  onHero: boolean
}) {
  const first = points[0]?.date ?? from
  const area = (
    <div className="mt-4 hidden sm:block">
      <BalanceArea
        compact
        tone={onHero ? 'onHero' : 'default'}
        points={points}
        label="Plata disponible"
        className="h-16"
      />
      {points.some((p) => p.cents !== 0) ? (
        <div aria-hidden className={cn('mt-1.5 flex justify-between text-[11px]', ink.muted)}>
          <span>{dayShort(first)}</span>
          <span>Hoy</span>
        </div>
      ) : null}
    </div>
  )

  if (trend.kind === 'too_new') {
    return (
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className={cn(LABEL, 'hidden sm:block', ink.muted)}>Desde que arrancaste</p>
          <p className={cn('text-sm leading-relaxed text-pretty sm:mt-1.5', ink.muted)}>
            {trend.sentence}
          </p>
        </div>
        {area}
      </div>
    )
  }

  const Icon = TREND_ICON[trend.direction]
  return (
    <div className="flex h-full flex-col justify-between">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm sm:hidden">
        <Icon className={cn('size-4 shrink-0', ink.accent)} aria-hidden />
        <span className={cn('font-semibold', ink.fg)}>{trend.diffText}</span>
        <span className={ink.muted}>que hace {HOME_CASH_DAYS} días</span>
      </p>
      <div className="hidden sm:block">
        <p className={cn(LABEL, ink.muted)}>Últimos {HOME_CASH_DAYS} días</p>
        <p
          className={cn(
            'mt-1.5 flex items-center gap-2 font-serif text-2xl font-semibold leading-tight tracking-tight',
            ink.fg,
          )}
        >
          <Icon className={cn('size-5 shrink-0', ink.accent)} aria-hidden />
          {trend.diffText}
        </p>
        <p className={cn('mt-1 text-sm text-pretty', ink.muted)}>{trend.sentence}.</p>
      </div>
      {area}
    </div>
  )
}

/**
 * El héroe sin número: las cajas del bar como casilleros que esperan su monto.
 * Enseña qué va a aparecer (una por caja) sin inventar un cero.
 */
function EmptySlots({
  treasuries,
  ink,
  className,
}: {
  treasuries: readonly SummaryTreasury[]
  ink: Ink
  className?: string
}) {
  const shown = treasuries.slice(0, 4)
  const rest = treasuries.length - shown.length
  return (
    <div className={cn('min-w-0', ink.aside, className)}>
      <p className={cn(LABEL, ink.muted)}>Tus cajas</p>
      <ul className="mt-3 space-y-2">
        {shown.map((t) => {
          const Icon = KIND_ICON[t.kind]
          return (
            <li
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-dashed px-3 py-2.5',
                ink.slot,
              )}
            >
              <Icon className={cn('size-4 shrink-0', ink.muted)} aria-hidden />
              <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', ink.fg)}>
                {t.name}
              </span>
              <span className={cn('shrink-0 text-sm', ink.muted)}>¿cuánto hay?</span>
            </li>
          )
        })}
      </ul>
      {rest > 0 ? (
        <p className={cn('mt-2 text-xs', ink.muted)}>
          y {rest === 1 ? '1 caja más' : `${rest} cajas más`}
        </p>
      ) : null}
    </div>
  )
}
