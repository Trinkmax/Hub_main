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
import { OTHERS_SWATCH } from '@/components/administracion/charts/palette'
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
  type TreasuryTone,
  type TreasuryToneKind,
  treasurySegments,
} from '@/lib/accounting/home'
import type { SummaryTreasury } from '@/lib/accounting/queries/summary'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { homeErrorText } from './block-states'
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
      'border-t border-white/12 pt-3 @min-[52rem]:rounded-2xl @min-[52rem]:border-t-0 @min-[52rem]:bg-white/8 @min-[52rem]:p-5',
    slot: 'border-white/25',
    pill: 'border-white/12 bg-white/8 hover:bg-white/14',
    row: 'hover:bg-white/8',
    link: 'text-adm-hero-fg',
  },
  crema: {
    fg: 'text-foreground',
    muted: 'text-muted-foreground',
    accent: 'text-primary',
    aside:
      'border-t border-border/60 pt-3 @min-[52rem]:rounded-2xl @min-[52rem]:border-t-0 @min-[52rem]:bg-secondary/50 @min-[52rem]:p-5',
    slot: 'border-border',
    pill: '',
    row: 'hover:bg-secondary/60',
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
 * El color de cada caja en la barra: sale de su TIPO (banco, efectivo,
 * billetera) y, entre dos del mismo tipo, del escalón. Los tonos cambian con
 * la superficie (`--adm-k-*` en `globals.css`): sobre el héroe verde el banco
 * es crema, la tinta del héroe; sobre la variante clara, bosque. Las clases
 * van escritas enteras: Tailwind solo genera las que encuentra como texto.
 */
const TONE_SWATCH: Readonly<Record<TreasuryToneKind, readonly [string, string, string]>> = {
  bank: ['bg-(--adm-k-bank-1)', 'bg-(--adm-k-bank-2)', 'bg-(--adm-k-bank-3)'],
  cash: ['bg-(--adm-k-cash-1)', 'bg-(--adm-k-cash-2)', 'bg-(--adm-k-cash-3)'],
  wallet: ['bg-(--adm-k-wallet-1)', 'bg-(--adm-k-wallet-2)', 'bg-(--adm-k-wallet-3)'],
}

function toneSwatch(tone: TreasuryTone | null): string {
  return (tone ? TONE_SWATCH[tone.kind][tone.step - 1] : undefined) ?? OTHERS_SWATCH
}

/** Cuántas cajas entran como renglón en el celular antes de resumir el resto. */
const MAX_ROWS = 3

/**
 * El héroe mide su propio ancho (`@container`), no el de la ventana: con el
 * menú abierto en una notebook chica el número y los 30 días no entran lado a
 * lado, y ahí van uno arriba del otro como en el celular.
 */
const LAYOUT =
  'grid gap-x-8 gap-y-4 @min-[40rem]:gap-y-5 @min-[52rem]:grid-cols-12 @min-[52rem]:items-stretch'

/**
 * El héroe del Resumen, «la plata hoy»: el número, la oración que lo explica,
 * la barra de dónde está (el color de cada caja sale de su tipo: banco,
 * efectivo, billetera) y, al lado, cómo cambió en los últimos 30 días.
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
          {homeErrorText(summaryResult.message)}
        </p>
        <RetryButton />
      </HeroPanel>
    )
  }

  const summary = summaryResult.data
  const settings = settingsResult.ok ? settingsResult.data : null
  const state = heroState(summary, settings, { canWrite: data.canWrite, base: data.base })

  if (state.kind === 'unknown') {
    const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')
    return (
      <div className="@container">
        <HeroPanel tone={tone} className={LAYOUT}>
          <div
            className={cn(
              'min-w-0',
              assets.length > 0 ? '@min-[52rem]:col-span-7' : '@min-[52rem]:col-span-12',
            )}
          >
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
            <EmptySlots treasuries={assets} ink={ink} className="@min-[52rem]:col-span-5" />
          ) : null}
        </HeroPanel>
      </div>
    )
  }

  const bar = treasurySegments(summary)
  const range = homeCashRange(data.today)
  const cashOpts = { ...range, booksStartDate: settings?.booksStartDate ?? null }
  const trend = cashResult.ok ? balanceTrend(cashResult.data.total, cashOpts) : null
  const points = cashResult.ok ? balancePoints(cashResult.data.total, cashOpts) : []

  return (
    <div className="@container">
      <HeroPanel tone={tone} className={LAYOUT}>
        <div className="min-w-0 space-y-4 @min-[40rem]:space-y-5 @min-[52rem]:col-span-7">
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
          className={cn('min-w-0 @min-[52rem]:col-span-5', ink.aside)}
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
    </div>
  )
}

/** La barra partida por caja y su leyenda: cada caja lleva a sus movimientos. */
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
  const segments = bar.segments.map((s, i) => ({
    key: s.key,
    label: s.name,
    cents: s.cents,
    // El color sigue al tipo de caja, no a cuánta plata tiene hoy.
    swatch: toneSwatch(s.tone),
    href: `${base}${s.path ?? '/cajas'}`,
    share: bar.segments.length > 1 ? percentShort(shares[i] ?? 0, true) : null,
  }))

  // En el celular entran tres renglones: van las tres cajas con más plata, en el
  // orden de siempre, y el resto se suma en un renglón que lleva a Cajas.
  const top = new Set(
    [...segments]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, MAX_ROWS)
      .map((s) => s.key),
  )
  const rows = segments.filter((s) => top.has(s.key))
  const rest = segments.filter((s) => !top.has(s.key))
  const restCents = rest.reduce((sum, s) => sum + s.cents, 0)
  const rowClass = cn(
    '-mx-2 flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
    ink.row,
  )

  return (
    // `gap` y no `space-y`: de las dos leyendas siempre hay una oculta, y su margen sobraba.
    <div className="flex flex-col gap-3">
      <SplitBar segments={segments} height={14} showLegend={false} />

      {/* Angosto (el celular): un renglón por caja, con el nombre a la izquierda y la plata
          a la derecha. La fila de píldoras se cortaba contra el borde y dejaba afuera
          justo a la caja con más plata. */}
      <ul className="@min-[40rem]:hidden">
        {rows.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className={rowClass}>
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', s.swatch)} />
              <span className={cn('min-w-0 flex-1 truncate', ink.fg)}>{s.label}</span>
              <span className={cn('shrink-0 font-medium tabular-nums', ink.fg)}>
                {formatCentsShort(s.cents)}
              </span>
              {s.share ? (
                <span className={cn('w-9 shrink-0 text-right text-xs tabular-nums', ink.muted)}>
                  {s.share}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
        {rest.length > 0 ? (
          <li>
            <Link href={`${base}/cajas`} className={rowClass}>
              <span aria-hidden className="size-2.5 shrink-0" />
              <span className={cn('min-w-0 flex-1 truncate', ink.muted)}>
                {rest.length === 1 ? 'y 1 caja más' : `y ${rest.length} cajas más`}
              </span>
              <span className={cn('shrink-0 font-medium tabular-nums', ink.fg)}>
                {formatCentsShort(restCents)}
              </span>
              {segments.length > 1 ? <span aria-hidden className="w-9 shrink-0" /> : null}
            </Link>
          </li>
        ) : null}
      </ul>

      {/* Con lugar: píldoras. El porcentaje va como texto apagado al lado del importe,
          sin pastilla propia (dos números pegados en cajitas no se leen). */}
      <ul className="hidden flex-wrap gap-2 @min-[40rem]:flex">
        {segments.map((s) => (
          <li key={s.key} className="max-w-full">
            <LegendPill
              swatchClassName={s.swatch}
              label={s.label}
              value={
                <>
                  {formatCentsShort(s.cents)}
                  {s.share ? <span className="opacity-75"> · {s.share}</span> : null}
                </>
              }
              href={s.href}
              className={cn('max-w-full', ink.pill)}
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
 * día dibujado. Mientras el héroe va en una columna (el celular, una notebook
 * con el menú abierto) queda en un renglón: el dibujo se guarda para cuando
 * hay lugar, así la primera acción entra en la primera pantalla.
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
    <div className="mt-4 hidden @min-[52rem]:block">
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
          <p className={cn(LABEL, 'hidden @min-[52rem]:block', ink.muted)}>Desde que arrancaste</p>
          <p className={cn('text-sm leading-relaxed text-pretty @min-[52rem]:mt-1.5', ink.muted)}>
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
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm @min-[52rem]:hidden">
        <Icon className={cn('size-4 shrink-0', ink.accent)} aria-hidden />
        <span className={cn('font-semibold whitespace-nowrap', ink.fg)}>{trend.diffText}</span>
        <span className={ink.muted}>que hace {HOME_CASH_DAYS} días</span>
      </p>
      <div className="hidden @min-[52rem]:block">
        <p className={cn(LABEL, ink.muted)}>Últimos {HOME_CASH_DAYS} días</p>
        <p
          className={cn(
            'mt-1.5 flex items-center gap-2 font-serif text-2xl font-semibold leading-tight tracking-tight',
            ink.fg,
          )}
        >
          <Icon className={cn('size-5 shrink-0', ink.accent)} aria-hidden />
          {/* «$ 31.409.348 más» va entero: «más» solo en un renglón no se lee. */}
          <span className="whitespace-nowrap">{trend.diffText}</span>
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
