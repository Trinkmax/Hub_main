'use client'

import { RotateCcw, Ticket, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatPoints } from '@/app/c/[token]/_components/wallet-format'
import { WalletShell } from '@/app/c/[token]/_components/wallet-shell'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { Button } from '@/components/ui/button'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import { wouldDropTier } from '@/lib/points/category'
import { progressToNext, resolveTier, sortedActiveTiers } from '@/lib/points/tiers'
import type { WalletData } from '@/lib/wallet/queries'
import { computeRewardState } from '@/lib/wallet/reward-state'
import type { SimConfig } from '@/lib/wallet/simulator'

const DUMMY_QR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

type SimState = {
  categoryPoints: number
  pointsBalance: number
  expiryPoints: number
  pending: Array<{ id: string; name: string; imageUrl: string | null }>
}

function buildWallet(config: SimConfig, s: SimState, expiresAt: string): WalletData {
  const tiers = config.tiers
  const current = resolveTier(s.categoryPoints, tiers)
  const progress = progressToNext(s.categoryPoints, tiers)
  const sorted = sortedActiveTiers(tiers)

  const progression = sorted.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    badgeIcon: t.badge_icon,
    minCategoryPoints: t.min_category_points,
    unlocked: s.categoryPoints >= t.min_category_points,
    current: current?.id === t.id,
    pointsToReach: Math.max(0, t.min_category_points - s.categoryPoints),
    benefits: config.benefitsByTier[t.id] ?? [],
  }))

  const rewards = config.rewards.map((r) => {
    const state = computeRewardState(
      { cost_points: r.costPoints, stock: r.stock, min_tier_id: r.minTierId },
      { pointsBalance: s.pointsBalance, categoryPoints: s.categoryPoints, tiers },
    )
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      costPoints: r.costPoints,
      imageUrl: r.imageUrl,
      stock: r.stock,
      category: r.category,
      ...state,
    }
  })

  const drop =
    s.expiryPoints > 0
      ? wouldDropTier(s.categoryPoints, s.expiryPoints, tiers)
      : { drops: false, toTierName: null }

  return {
    customer: {
      id: 'sim',
      firstName: 'Vista',
      lastName: 'Previa',
      qrToken: 'simulador',
      birthdate: '1996-10-22',
      pointsBalance: s.pointsBalance,
      categoryPoints: s.categoryPoints,
      lifetimePoints: s.categoryPoints,
    },
    tenant: {
      id: config.tenant.id,
      slug: 'sim',
      name: config.tenant.name,
      logoUrl: config.tenant.logoUrl,
      brandAccent: config.tenant.brandAccent,
    },
    tier: {
      current: current
        ? {
            id: current.id,
            name: current.name,
            color: current.color,
            badgeIcon: current.badge_icon,
            perks: current.perks,
          }
        : null,
      next: progress.next
        ? {
            id: progress.next.id,
            name: progress.next.name,
            thresholdPoints: progress.next.min_category_points,
          }
        : null,
      pointsToNext: progress.pointsToNext,
      progressPct: progress.pct,
    },
    categoryWindowMonths: config.windowMonths,
    expiry:
      s.expiryPoints > 0
        ? { points: s.expiryPoints, expiresAt, wouldDrop: drop.drops, toTierName: drop.toTierName }
        : null,
    earn: config.earn,
    benefits: current ? (config.benefitsByTier[current.id] ?? []) : [],
    progression,
    partners: config.partners,
    rewards,
    punchCards: [],
    visits: [],
    events: [],
    ledger: [],
    redemptions: [],
    pendingBenefits: s.pending.map((p) => ({
      redemptionId: p.id,
      rewardName: p.name,
      imageUrl: p.imageUrl,
      kind: 'reward' as const,
    })),
  }
}

function clampPts(n: number): number {
  return Math.max(0, Math.min(100000, Math.round(n)))
}

function Stepper({
  label,
  value,
  onChange,
  accent,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  accent?: boolean
}) {
  const steps = [-100, -10, 10, 100]
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span
          className={`font-display text-2xl font-semibold tabular-nums ${accent ? 'text-primary' : 'text-foreground'}`}
        >
          {formatPoints(value)}
          <span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((d) => (
          <Button
            key={d}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(clampPts(value + d))}
            className="tabular-nums"
          >
            {d > 0 ? `+${d}` : d}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function WalletSimulator({ config }: { config: SimConfig }): React.JSX.Element {
  const sorted = useMemo(() => sortedActiveTiers(config.tiers), [config.tiers])
  const firstTierMin = sorted[0]?.min_category_points ?? 0
  const [state, setState] = useState<SimState>({
    categoryPoints: sorted[2]?.min_category_points ?? firstTierMin,
    pointsBalance: 340,
    expiryPoints: 0,
    pending: [],
  })
  // Fecha de vencimiento fija por sesión (evita recomputar en cada render).
  const expiresAt = useMemo(() => new Date(Date.now() + 25 * 86400000).toISOString(), [])

  const wallet = useMemo(() => buildWallet(config, state, expiresAt), [config, state, expiresAt])
  const currentTierId = wallet.tier.current?.id ?? sorted[0]?.id ?? ''

  // Monto sugerido de vencimiento = el que te haría bajar del nivel actual (para
  // demostrar el aviso "volvé para no bajar").
  const suggestedExpiry = useMemo(() => {
    const cur = resolveTier(state.categoryPoints, config.tiers)
    const curMin = cur?.min_category_points ?? 0
    return Math.max(1, Math.min(state.categoryPoints, state.categoryPoints - curMin + 1))
  }, [state.categoryPoints, config.tiers])

  const affordable = wallet.rewards.filter((r) => r.affordable && !r.tierLocked)

  function set(patch: Partial<SimState>) {
    setState((s) => ({ ...s, ...patch }))
  }

  function redeem(r: { id: string; name: string; imageUrl: string | null; costPoints: number }) {
    setState((s) => ({
      ...s,
      pointsBalance: clampPts(s.pointsBalance - r.costPoints),
      pending: [
        { id: `${r.id}-${s.pending.length}`, name: r.name, imageUrl: r.imageUrl },
        ...s.pending,
      ],
    }))
  }

  function unredeem(id: string, cost: number) {
    setState((s) => ({
      ...s,
      pointsBalance: clampPts(s.pointsBalance + cost),
      pending: s.pending.filter((p) => p.id !== id),
    }))
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* PANEL DE CONTROL */}
      <div className="w-full space-y-5 rounded-2xl border bg-card p-5 shadow-sm lg:w-[380px] lg:shrink-0">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Controles</h2>
          <p className="text-sm text-muted-foreground">
            Ajustá el estado y mirá la tarjeta a la derecha. No toca datos reales.
          </p>
        </div>

        {/* Nivel por puntos de categoría */}
        <div className="space-y-3 border-t pt-4">
          <Stepper
            label="Puntos de categoría"
            value={state.categoryPoints}
            onChange={(n) => set({ categoryPoints: n })}
            accent
          />
          {sorted.length > 1 ? (
            <SlidingTabs
              size="sm"
              className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              tabs={sorted.map((t) => ({ value: t.id, label: t.name }))}
              value={currentTierId}
              onChange={(id) => {
                const t = sorted.find((x) => x.id === id)
                if (t) set({ categoryPoints: t.min_category_points })
              }}
            />
          ) : null}
        </div>

        {/* Puntos canjeables */}
        <div className="border-t pt-4">
          <Stepper
            label="Puntos canjeables"
            value={state.pointsBalance}
            onChange={(n) => set({ pointsBalance: n })}
          />
        </div>

        {/* Vencimiento */}
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Vencimiento
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingDown className="size-3.5" aria-hidden="true" />
              {state.expiryPoints > 0
                ? wouldDropTier(state.categoryPoints, state.expiryPoints, config.tiers).drops
                  ? 'bajaría de nivel'
                  : 'mantiene nivel'
                : 'sin aviso'}
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant={state.expiryPoints > 0 ? 'default' : 'outline'}
              size="sm"
              onClick={() => set({ expiryPoints: state.expiryPoints > 0 ? 0 : suggestedExpiry })}
            >
              {state.expiryPoints > 0 ? 'Quitar aviso' : 'Simular vencimiento'}
            </Button>
            {state.expiryPoints > 0 ? (
              <span className="flex items-center text-sm text-muted-foreground tabular-nums">
                {formatPoints(state.expiryPoints)} pts por vencer
              </span>
            ) : null}
          </div>
        </div>

        {/* Simular canjes */}
        <div className="space-y-2 border-t pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Simular canje
          </span>
          {affordable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sumá puntos canjeables para poder canjear algo.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {affordable.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => redeem(r)}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/50 px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-secondary"
                >
                  <Ticket className="size-3 text-primary" aria-hidden="true" />
                  {r.name}{' '}
                  <span className="text-muted-foreground tabular-nums">−{r.costPoints}</span>
                </button>
              ))}
            </div>
          )}
          {state.pending.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {state.pending.map((p) => {
                const cost = config.rewards.find((r) => p.id.startsWith(r.id))?.costPoints ?? 0
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => unredeem(p.id, cost)}
                      className="shrink-0 font-medium text-primary hover:underline"
                    >
                      Descanjear
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        <div className="border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() =>
              setState({
                categoryPoints: sorted[2]?.min_category_points ?? firstTierMin,
                pointsBalance: 340,
                expiryPoints: 0,
                pending: [],
              })
            }
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reiniciar
          </Button>
        </div>
      </div>

      {/* PREVIEW — la wallet real, en un marco de teléfono */}
      <div className="flex flex-1 justify-center">
        <div className="force-light w-full max-w-[400px]">
          <BrandAccent
            accent={config.tenant.brandAccent}
            className="bg-app-gradient h-[760px] max-h-[80vh] overflow-y-auto overscroll-contain rounded-[2.25rem] border-[6px] border-foreground/80 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <WalletShell data={wallet} qrDataUrl={DUMMY_QR} embedded />
          </BrandAccent>
        </div>
      </div>
    </div>
  )
}
