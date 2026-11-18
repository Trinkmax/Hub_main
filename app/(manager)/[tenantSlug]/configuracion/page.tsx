import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sectionViewer } from '@/components/shell/section-tabs-config'
import { PageHeader } from '@/components/ui/page-header'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { visibleSettingsGroups } from './_components/settings-sections'

export const metadata = { title: 'Configuración' }

/**
 * La portada de Configuración: cada grupo con sus pantallas, las mismas del menú lateral
 * (`settings-sections.ts`). En el celular el menú lateral no se dibuja y esta lista es la única
 * forma de llegar a cada una.
 */
export default async function ConfiguracionIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const viewer = sectionViewer(access)
  const groups = visibleSettingsGroups(
    (feature) => viewer.isPlatformAdmin || viewer.features[feature],
  )

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ajustes"
        title="Configuración"
        description="Lo que se prepara una vez y se toca cada tanto, agrupado por tema."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const Icon = group.icon
          return (
            <section
              key={group.label}
              aria-label={group.label}
              className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card/85"
            >
              <header className="flex items-center gap-2.5 px-5 pt-4 pb-2">
                <span className="flex size-8 items-center justify-center rounded-lg border border-primary/20 bg-(--cream-tint) text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <h2 className="font-serif text-lg font-semibold tracking-tight">{group.label}</h2>
              </header>
              <ul className="divide-y divide-border/50">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href(tenantSlug)}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {item.label}
                        </span>
                        <span className="block text-sm text-muted-foreground text-pretty">
                          {item.description}
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
