import { ArrowRight, type LucideIcon, Palette, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Configuración' }

type SettingsCard = {
  icon: LucideIcon
  title: string
  description: string
  topics: string[]
  href: (slug: string) => string
}

const CARDS: SettingsCard[] = [
  {
    icon: UsersRound,
    title: 'Equipo',
    description: 'Sumá owners, cajeros, mozos y cocineros con el rol que corresponde.',
    topics: ['Miembros', 'Roles e invitaciones'],
    href: (s) => `/${s}/configuracion/equipo`,
  },
  {
    icon: Palette,
    title: 'Apariencia',
    description: 'Logo del bar, idioma y zona horaria. El acento de tenant llega pronto.',
    topics: ['Logo', 'Idioma · TZ'],
    href: (s) => `/${s}/configuracion/apariencia`,
  },
]

export default async function ConfiguracionIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ajustes"
        title="Configuración"
        description="Tres grupos para que encuentres rápido lo que necesitás cambiar."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.title}
              href={card.href(tenantSlug)}
              className="group block focus-visible:outline-none"
            >
              <Card className="card-hairline relative h-full gap-3 border-border/70 bg-card/85 p-6 transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary shadow-2xs">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <ArrowRight
                    className="size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </div>
                <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground">{card.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {card.topics.map((topic) => (
                    <li
                      key={topic}
                      className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {topic}
                    </li>
                  ))}
                </ul>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
