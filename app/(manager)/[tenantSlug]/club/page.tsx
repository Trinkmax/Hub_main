import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Gift, Sparkles, Stamp, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { listRewards, listRules, listTiers } from '@/lib/points/queries'
import { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'

export const metadata = { title: 'Club de beneficios' }

type SectionCard = {
  href: string
  title: string
  description: string
  stat: string
  icon: LucideIcon
}

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

  // Stats vivos de cada área, en paralelo.
  const [tiers, rules, rewards, punchCards, welcome] = await Promise.all([
    listTiers({ tenantId }),
    listRules({ tenantId }),
    listRewards({ tenantId }),
    listPunchCardTemplates(tenantId),
    getWelcomeRewardConfig(tenantId),
  ])

  const activeTiers = tiers.filter((t) => t.active).length
  const activeRules = rules.filter((r) => r.active).length
  const activeRewards = rewards.filter((r) => r.active).length
  const activePunchCards = punchCards.filter((p) => p.active).length

  const plural = (n: number, sing: string, plur: string) => (n === 1 ? sing : plur)

  const sections: SectionCard[] = [
    {
      href: `/${tenantSlug}/club/niveles`,
      title: 'Niveles',
      description:
        'Convertí a tus habitués en VIPs. Definí escalones por puntos acumulados y desbloqueá beneficios exclusivos en cada uno.',
      stat:
        tiers.length === 0
          ? 'Sin niveles todavía'
          : `${tiers.length} ${plural(tiers.length, 'nivel configurado', 'niveles configurados')}${
              activeTiers !== tiers.length
                ? ` · ${activeTiers} ${plural(activeTiers, 'activo', 'activos')}`
                : ''
            }`,
      icon: Star,
    },
    {
      href: `/${tenantSlug}/puntos`,
      title: 'Puntos y recompensas',
      description:
        'El motor del club: cómo se ganan puntos al consumir y qué pueden canjear tus clientes con ellos.',
      stat: `${activeRules} ${plural(activeRules, 'regla', 'reglas')} · ${activeRewards} ${plural(
        activeRewards,
        'recompensa',
        'recompensas',
      )}`,
      icon: Gift,
    },
    {
      href: `/${tenantSlug}/punch-cards`,
      title: 'Punch cards',
      description:
        'Tarjetas de sellos para premiar la repetición: "5 almuerzos, el 6º gratis". Suman solas con cada visita.',
      stat:
        punchCards.length === 0
          ? 'Sin tarjetas todavía'
          : `${punchCards.length} ${plural(punchCards.length, 'tarjeta', 'tarjetas')}${
              activePunchCards !== punchCards.length
                ? ` · ${activePunchCards} ${plural(activePunchCards, 'activa', 'activas')}`
                : ''
            }`,
      icon: Stamp,
    },
    {
      href: `/${tenantSlug}/configuracion/bienvenida`,
      title: 'Regalo de bienvenida',
      description:
        'El primer gesto del club: un regalo (y puntos iniciales opcionales) para quien se registra escaneando el QR.',
      stat: welcome.enabled
        ? `Activo${welcome.reward ? ` · ${welcome.reward.name}` : ''}`
        : 'Desactivado',
      icon: Sparkles,
    },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Fidelización"
        title="Club de beneficios"
        description="El centro de control de tu programa de lealtad. Configurá cómo tus clientes ganan, suben de nivel y canjean — todo desde acá."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Card className="card-hairline h-full gap-0 border-border/70 bg-card/85 p-6 transition-all group-hover:border-primary/30 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-[--cream-tint] text-primary shadow-2xs">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <ArrowRight
                    className="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                    aria-hidden
                  />
                </div>

                <h2 className="mt-4 font-serif text-xl font-semibold tracking-tight">
                  {section.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
                  {section.description}
                </p>

                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  {section.stat}
                </p>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
