import { Clock3, Crown, Sparkles, TrendingDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { formatDayMonth, formatPoints } from './wallet-format'

// Centerpiece de la wallet: "carnet de socio". El número hero son los PUNTOS DE
// CATEGORÍA (que definen el nivel, ventana móvil), con el anillo de progreso al
// siguiente nivel + aviso de vencimiento. Los canjeables van como chip aparte.
// Server component. El acento usa el color del nivel actual, sino --brand-accent.

type Tier = WalletData['tier']
type Expiry = WalletData['expiry']

const RING_SIZE = 176
const STROKE = 12
const RADIUS = (RING_SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function accentStyle(color: string | null): CSSProperties {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return {
    '--hero-accent': isHex ? color : 'var(--brand-accent, var(--primary))',
    '--hero-accent-fg': isHex
      ? '#ffffff'
      : 'var(--brand-accent-foreground, var(--primary-foreground))',
  } as CSSProperties
}

function ProgressRing({
  pct,
  label,
  children,
}: {
  pct: number
  label: string
  children: ReactNode
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: RING_SIZE, height: RING_SIZE }}
      role="img"
      aria-label={label}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="color-mix(in oklch, var(--hero-accent) 16%, transparent)"
          strokeWidth={STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--hero-accent)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset var(--duration-slower) var(--ease-out)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center px-6 text-center">{children}</div>
    </div>
  )
}

function ExpiryPill({ expiry }: { expiry: Expiry }) {
  if (!expiry) return null
  return (
    <div
      className="mt-4 inline-flex max-w-[30ch] items-start gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-left text-[11px] leading-tight text-foreground"
      role="status"
    >
      {expiry.wouldDrop ? (
        <TrendingDown className="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <Clock3 className="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
      )}
      <span>
        <span className="font-semibold tabular-nums">{formatPoints(expiry.points)} pts</span> vencen
        el <span className="font-semibold tabular-nums">{formatDayMonth(expiry.expiresAt)}</span>
        {expiry.wouldDrop ? ' · volvé para no bajar de nivel' : ''}
      </span>
    </div>
  )
}

function PointsRow({ balance, lifetime }: { balance: number; lifetime: number }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 text-center">
      <div className="rounded-xl border border-[--hero-accent]/25 bg-[color-mix(in_oklch,var(--hero-accent)_8%,transparent)] px-3 py-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Canjeables
        </dt>
        <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-[--hero-accent]">
          {formatPoints(balance)}
        </dd>
        <p className="text-[10px] text-muted-foreground">para canjear</p>
      </div>
      <div className="rounded-xl bg-[--cream-tint] px-3 py-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          De por vida
        </dt>
        <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {formatPoints(lifetime)}
        </dd>
        <p className="text-[10px] text-muted-foreground">acumulados</p>
      </div>
    </dl>
  )
}

export function TierHero({
  tier,
  categoryPoints,
  pointsBalance,
  lifetimePoints,
  expiry,
}: {
  tier: Tier
  categoryPoints: number
  pointsBalance: number
  lifetimePoints: number
  expiry: Expiry
}): React.JSX.Element {
  const { current, next, pointsToNext, progressPct } = tier
  const hasTiers = current !== null || next !== null

  // Caso sin niveles configurados → hero simple "Tus puntos".
  if (!hasTiers) {
    return (
      <section
        aria-label="Tus puntos"
        style={accentStyle(null)}
        className="card-hairline animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-slow)] overflow-hidden rounded-2xl border bg-card p-6 text-center shadow-md"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Tus puntos
        </p>
        <p className="mt-3 font-display text-6xl font-semibold tabular-nums leading-none text-[--hero-accent]">
          {formatPoints(pointsBalance)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">puntos canjeables</p>
        <p className="mt-4 text-xs text-muted-foreground">
          Acumulaste{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatPoints(lifetimePoints)}
          </span>{' '}
          de por vida.
        </p>
      </section>
    )
  }

  const tierName = current?.name ?? 'Sin nivel'
  const ringLabel = next
    ? `${categoryPoints} puntos de categoría. Progreso al nivel ${next.name}: ${Math.round(progressPct)} por ciento`
    : `${categoryPoints} puntos de categoría. Nivel máximo alcanzado`

  let subtitle: ReactNode
  if (next && pointsToNext !== null) {
    subtitle = (
      <>
        Te faltan{' '}
        <span className="font-semibold text-[--hero-accent] tabular-nums">
          {formatPoints(pointsToNext)} pts
        </span>{' '}
        para <span className="font-medium text-foreground">{next.name}</span>
      </>
    )
  } else {
    subtitle = <span className="font-medium text-foreground">Nivel máximo 🎉</span>
  }

  return (
    <section
      aria-label={`Nivel ${tierName}`}
      style={accentStyle(current?.color ?? null)}
      className="card-hairline animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-slow)] relative overflow-hidden rounded-2xl border bg-card p-6 shadow-md"
    >
      {/* Halo de marca detrás del anillo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-44 opacity-70"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, color-mix(in oklch, var(--hero-accent) 16%, transparent), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[--hero-accent] px-3 py-1 text-[--hero-accent-fg] shadow-sm">
          <LucideByName name={current?.badgeIcon} fallback={Crown} className="size-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wider">{tierName}</span>
        </div>

        <div className="mt-5">
          <ProgressRing pct={progressPct} label={ringLabel}>
            <span className="font-display text-5xl font-semibold tabular-nums leading-none text-foreground">
              {formatPoints(categoryPoints)}
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              pts de categoría
            </span>
          </ProgressRing>
        </div>

        <p className="mt-4 text-balance text-sm text-muted-foreground">{subtitle}</p>

        <ExpiryPill expiry={expiry} />

        {current?.perks ? (
          <p className="mt-3 inline-flex max-w-[30ch] items-start gap-1.5 text-balance text-xs text-muted-foreground">
            <Sparkles
              className="mt-0.5 size-3.5 shrink-0 text-[--hero-accent]"
              aria-hidden="true"
            />
            <span>{current.perks}</span>
          </p>
        ) : null}
      </div>

      <PointsRow balance={pointsBalance} lifetime={lifetimePoints} />
    </section>
  )
}
