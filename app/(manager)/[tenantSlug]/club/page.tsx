import { ArrowRight, Gift, Sparkles, Stamp, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { listRewards, listRules, listTiers } from '@/lib/points/queries'
import { sortedActiveTiers } from '@/lib/points/tiers'
import { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'

export const metadata = { title: 'Club de beneficios' }

export default async function ClubPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  // Owner-only: 404 si no es owner para no revelar la ruta.
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const tenantId = access.tenant.id

  const [tiers, rules, rewards, punchCards, welcome] = await Promise.all([
    listTiers({ tenantId }),
    listRules({ tenantId }),
    listRewards({ tenantId }),
    listPunchCardTemplates(tenantId),
    getWelcomeRewardConfig(tenantId),
  ])

  const activeTiers = sortedActiveTiers(tiers)
  const activeRules = rules.filter((r) => r.active).length
  const activeRewards = rewards.filter((r) => r.active).length
  const activePunchCards = punchCards.filter((p) => p.active).length

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Fidelización"
        title="Club de beneficios"
        description="El centro de tu programa de lealtad: cómo ganan puntos tus clientes, cómo suben de nivel y qué pueden canjear. Todo en un solo lugar."
      />

      {/* Stats vivos del programa — clickeables para ir a configurar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={`/${tenantSlug}/club/niveles`} className="rounded-xl">
          <StatCard
            label="Niveles activos"
            numberValue={activeTiers.length}
            icon={Star}
            iconClassName="text-primary"
          />
        </Link>
        <Link href={`/${tenantSlug}/club/puntos`} className="rounded-xl">
          <StatCard
            label="Reglas de puntos"
            numberValue={activeRules}
            icon={Sparkles}
            iconClassName="text-info"
          />
        </Link>
        <Link href={`/${tenantSlug}/club/puntos`} className="rounded-xl">
          <StatCard
            label="Recompensas"
            numberValue={activeRewards}
            icon={Gift}
            iconClassName="text-success"
          />
        </Link>
        <Link href={`/${tenantSlug}/club/punch-cards`} className="rounded-xl">
          <StatCard
            label="Punch cards activas"
            numberValue={activePunchCards}
            icon={Stamp}
            iconClassName="text-warning"
          />
        </Link>
      </div>

      {/* Niveles — el hero del club, con los colores reales de cada nivel */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">
              Niveles del club
            </h2>
            <p className="text-xs text-muted-foreground">
              Se alcanzan por puntos de categoría — la suma de los últimos meses. Pueden bajar.
            </p>
          </div>
          <Link
            href={`/${tenantSlug}/club/niveles`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Gestionar
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>

        {activeTiers.length === 0 ? (
          <Link
            href={`/${tenantSlug}/club/niveles`}
            className="card-hairline group flex items-center gap-4 rounded-xl border border-dashed border-border/70 bg-card/50 p-6 transition-colors hover:border-primary/40 hover:bg-card"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-[--cream-tint] text-primary">
              <Star className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-medium">Todavía no tenés niveles</p>
              <p className="text-sm text-muted-foreground text-pretty">
                Convertí a tus habitués en VIPs: definí escalones (Bronce, Plata, Oro) y desbloqueá
                beneficios exclusivos en cada uno.
              </p>
            </div>
            <ArrowRight
              className="ml-auto size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
              aria-hidden
            />
          </Link>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeTiers.map((tier) => (
              <TierBadgeCard key={tier.id} tier={tier} />
            ))}
          </div>
        )}
      </section>

      {/* Bienvenida — banner, no card uniforme */}
      <WelcomeBanner
        tenantSlug={tenantSlug}
        enabled={welcome.enabled}
        rewardName={welcome.reward?.name ?? null}
      />
    </div>
  )
}

function TierBadgeCard({
  tier,
}: {
  tier: {
    name: string
    color: string | null
    min_category_points: number
    perks: string | null
  }
}) {
  const color = tier.color ?? '#8a6d3b'
  return (
    <div
      className={cn(
        'card-hairline relative overflow-hidden rounded-xl border p-4',
        'transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md',
      )}
      style={{
        borderColor: `color-mix(in oklch, ${color} 35%, var(--border))`,
        backgroundColor: `color-mix(in oklch, ${color} 7%, var(--card))`,
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-center justify-between gap-2 pl-1.5">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="font-serif text-lg font-semibold tracking-tight">{tier.name}</h3>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{
            color,
            backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
          }}
        >
          Desde {tier.min_category_points.toLocaleString('es-AR')} pts
        </span>
      </div>
      {tier.perks ? (
        <p className="mt-2 pl-1.5 text-sm text-muted-foreground text-pretty">{tier.perks}</p>
      ) : null}
    </div>
  )
}

function WelcomeBanner({
  tenantSlug,
  enabled,
  rewardName,
}: {
  tenantSlug: string
  enabled: boolean
  rewardName: string | null
}) {
  return (
    <Link
      href={`/${tenantSlug}/club/bienvenida`}
      className={cn(
        'card-hairline group flex items-center gap-4 rounded-xl border p-5 transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md',
        enabled ? 'border-success/30 bg-success/5' : 'border-border/70 bg-card/60',
      )}
    >
      <div
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          enabled ? 'bg-success/15 text-success' : 'bg-[--cream-tint] text-primary',
        )}
      >
        <Sparkles className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-semibold tracking-tight">
            Regalo de bienvenida
          </h2>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              enabled ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground',
            )}
          >
            {enabled ? 'Activo' : 'Desactivado'}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
          {enabled
            ? `Quien se registra escaneando el QR recibe${rewardName ? ` ${rewardName}` : ' tu regalo'}.`
            : 'El primer gesto del club: un regalo para quien se registra escaneando el QR.'}
        </p>
      </div>
      <ArrowRight
        className="ml-auto size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  )
}
