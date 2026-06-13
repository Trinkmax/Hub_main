import { Crown, Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { formatPoints } from './wallet-format'

// Centerpiece de la wallet: anillo de progreso de nivel + puntos.
// Server component (sin interactividad). El acento usa el color del nivel
// actual si existe, sino cae a --brand-accent / --primary.

type Tier = WalletData['tier']

const RING_SIZE = 168
const STROKE = 12
const RADIUS = (RING_SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Estilo de acento del hero: color del nivel si es un hex válido, sino el de marca. */
function accentStyle(color: string | null): CSSProperties {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return {
    '--hero-accent': isHex ? color : 'var(--brand-accent, var(--primary))',
    '--hero-accent-fg': isHex
      ? '#ffffff'
      : 'var(--brand-accent-foreground, var(--primary-foreground))',
  } as CSSProperties
}

function ProgressRing({ pct, label }: { pct: number; label: string }) {
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
      <div className="absolute inset-0 grid place-items-center text-center">
        <span className="font-display text-4xl font-semibold tabular-nums leading-none">
          {Math.round(clamped)}
          <span className="ml-0.5 align-top text-base font-medium text-muted-foreground">%</span>
        </span>
      </div>
    </div>
  )
}

function PointsRow({ balance, lifetime }: { balance: number; lifetime: number }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 text-center">
      <div className="rounded-xl bg-[--cream-tint] px-3 py-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Canjeables
        </dt>
        <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {formatPoints(balance)}
        </dd>
      </div>
      <div className="rounded-xl bg-[--cream-tint] px-3 py-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          De por vida
        </dt>
        <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {formatPoints(lifetime)}
        </dd>
      </div>
    </dl>
  )
}

export function TierHero({
  tier,
  pointsBalance,
  lifetimePoints,
}: {
  tier: Tier
  pointsBalance: number
  lifetimePoints: number
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
    ? `Progreso al nivel ${next.name}: ${Math.round(progressPct)} por ciento`
    : 'Nivel máximo alcanzado'

  // Subtítulo según el estado del progreso.
  let subtitle: React.ReactNode
  if (next && pointsToNext !== null) {
    subtitle = current ? (
      <>
        Te faltan{' '}
        <span className="font-semibold text-[--hero-accent] tabular-nums">
          {formatPoints(pointsToNext)} pts
        </span>{' '}
        para <span className="font-medium text-foreground">{next.name}</span>
      </>
    ) : (
      <>
        En camino a <span className="font-medium text-foreground">{next.name}</span> ·{' '}
        <span className="font-semibold text-[--hero-accent] tabular-nums">
          {formatPoints(pointsToNext)} pts
        </span>
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
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-70"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, color-mix(in oklch, var(--hero-accent) 14%, transparent), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[--hero-accent] px-3 py-1 text-[--hero-accent-fg]">
          <Crown className="size-3.5" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">{tierName}</span>
        </div>

        <div className="mt-5">
          <ProgressRing pct={progressPct} label={ringLabel} />
        </div>

        <p className="mt-4 text-balance text-sm text-muted-foreground">{subtitle}</p>

        {current?.perks ? (
          <p className="mt-3 inline-flex max-w-[28ch] items-start gap-1.5 text-balance text-xs text-muted-foreground">
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
