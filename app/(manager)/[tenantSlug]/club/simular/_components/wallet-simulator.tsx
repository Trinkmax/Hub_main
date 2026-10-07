'use client'

import { RotateCcw, Ticket, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { WalletShell } from '@/app/c/[token]/_components/wallet-shell'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format/number-kind'
import { wouldDropTier } from '@/lib/points/category'
import { progressToNext, resolveTier, sortedActiveTiers } from '@/lib/points/tiers'
import {
  buildPartnerTiers,
  resolvePartnersForTier,
  visibleWalletPartners,
} from '@/lib/wallet/partner-benefits'
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
      sort: r.sort,
      ...state,
    }
  })

  // Marca oculta = no existe para el socio, y la publicada que no da nada en
  // ningún nivel tampoco se muestra. Espejo EXACTO de lib/wallet/queries.ts: si
  // el simulador y la billetera real se separan, el simulador miente.
  const benefitsByTier = new Map(Object.entries(config.partnerBenefitsByTier))
  const partnerResolution = resolvePartnersForTier(
    config.partners.filter((p) => p.active).map((p) => p.id),
    benefitsByTier,
    tiers,
    current?.id ?? null,
  )
  const partnersResolved: WalletData['partners'] = visibleWalletPartners(
    config.partners.map((p) => {
      const r = p.active ? partnerResolution.get(p.id) : undefined
      return { ...p, myBenefit: r?.myBenefit ?? null, unlockTierName: r?.unlockTierName ?? null }
    }),
  )
  const partnerTiers = buildPartnerTiers(partnersResolved, benefitsByTier, tiers)

  const drop =
    s.expiryPoints > 0
      ? wouldDropTier(s.categoryPoints, s.expiryPoints, tiers)
      : { drops: false, toTierName: null }

  return {
    // El simulador es una vista previa sintética: no hay socio real que pueda
    // canjear ni caja que le acredite, así que no tiene nada que refrescar.
    rev: null,
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
    // Los aliados por nivel (ITEM 9) se resuelven con los MISMOS helpers puros
    // que usa la billetera real: si acá se pasara `config.partners` crudo, el
    // dueño vería en la vista previa un "Nuestros Aliados" sin beneficios y
    // ninguna sección "Aliados por categoría" — justo lo que viene a revisar.
    partners: partnersResolved,
    partnerTiers,
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

const MAX_POINTS = 100000

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
  // La vista previa congelada (.force-light): los overlays del kit que se
  // abran adentro se portalizan ahí y no en el <body> del panel.
  const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null)

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
  const expiryDrops =
    state.expiryPoints > 0 &&
    wouldDropTier(state.categoryPoints, state.expiryPoints, config.tiers).drops

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
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      {/* PANEL DE CONTROL */}
      <Card className="w-full gap-0 lg:w-[380px] lg:shrink-0">
        <CardHeader>
          <CardTitle>Controles</CardTitle>
          <CardDescription>
            Ajustá el estado y mirá la tarjeta al lado. No toca datos reales.
          </CardDescription>
        </CardHeader>

        {/* Nivel por puntos de categoría */}
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          <Field
            label="Puntos de categoría"
            hint="Definen el nivel: lo ganado en los últimos 4 meses."
          >
            <NumberField
              min={0}
              max={MAX_POINTS}
              step={10}
              largeStep={100}
              suffix="pts"
              value={state.categoryPoints}
              onValueChange={(n) => {
                if (n !== null) set({ categoryPoints: clampPts(n) })
              }}
            />
          </Field>
          {sorted.length > 1 ? (
            <SegmentedControl
              aria-label="Saltar al comienzo de un nivel"
              size="sm"
              items={sorted.map((t) => ({ value: t.id, label: t.name }))}
              value={currentTierId}
              onValueChange={(id) => {
                const t = sorted.find((x) => x.id === id)
                if (t) set({ categoryPoints: t.min_category_points })
              }}
            />
          ) : null}
        </div>

        {/* Puntos canjeables */}
        <div className="mt-4 border-t border-border pt-4">
          <Field label="Puntos canjeables" hint="El saldo que puede gastar en recompensas.">
            <NumberField
              min={0}
              max={MAX_POINTS}
              step={10}
              largeStep={100}
              suffix="pts"
              value={state.pointsBalance}
              onValueChange={(n) => {
                if (n !== null) set({ pointsBalance: clampPts(n) })
              }}
            />
          </Field>
        </div>

        {/* Vencimiento */}
        <div className="mt-4 border-t border-border pt-4">
          <Field
            label="Simular vencimiento"
            layout="toggle"
            hint={
              state.expiryPoints > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <TrendingDown className="size-3.5 shrink-0" aria-hidden="true" />
                  {formatNumber(state.expiryPoints)} pts por vencer ·{' '}
                  {expiryDrops ? 'bajaría de nivel' : 'mantiene el nivel'}
                </span>
              ) : (
                'Muestra el aviso «volvé para no bajar de nivel».'
              )
            }
          >
            <Switch
              checked={state.expiryPoints > 0}
              onCheckedChange={(on) => set({ expiryPoints: on ? suggestedExpiry : 0 })}
            />
          </Field>
        </div>

        {/* Simular canjes */}
        <div className="mt-4 grid gap-2 border-t border-border pt-4">
          <p className="type-label text-foreground">Simular canje</p>
          {affordable.length === 0 ? (
            <p className="type-small text-muted-foreground">
              Sumá puntos canjeables para poder canjear algo.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {affordable.slice(0, 8).map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => redeem(r)}
                  aria-label={`Canjear ${r.name} por ${formatNumber(r.costPoints)} puntos`}
                >
                  <Ticket aria-hidden="true" />
                  {r.name}
                  <span className="type-amount text-muted-foreground">
                    −{formatNumber(r.costPoints)}
                  </span>
                </Button>
              ))}
            </div>
          )}
          {state.pending.length > 0 ? (
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {state.pending.map((p) => {
                const cost = config.rewards.find((r) => p.id.startsWith(r.id))?.costPoints ?? 0
                return (
                  <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 px-3">
                    <span className="truncate type-small font-medium">{p.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => unredeem(p.id, cost)}
                      aria-label={`Descanjear ${p.name}`}
                    >
                      Descanjear
                    </Button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
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
            <RotateCcw aria-hidden="true" />
            Reiniciar
          </Button>
        </div>
      </Card>

      {/* PREVIEW — la wallet real (pública y congelada), en un marco de teléfono.
          No se reestila: es la billetera tal cual la ve el socio. */}
      <div className="flex flex-1 justify-center">
        <div ref={setPreviewRoot} className="force-light w-full max-w-[400px]">
          <PortalContainerProvider container={previewRoot}>
            <BrandAccent
              accent={config.tenant.brandAccent}
              className="bg-app-gradient h-[760px] max-h-[80vh] overflow-y-auto overscroll-contain rounded-[2.25rem] border-[6px] border-foreground/80 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <WalletShell data={wallet} qrDataUrl={DUMMY_QR} embedded />
            </BrandAccent>
          </PortalContainerProvider>
        </div>
      </div>
    </div>
  )
}
