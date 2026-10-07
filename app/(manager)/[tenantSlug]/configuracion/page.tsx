import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsHref,
} from './_components/settings-nav'

export const metadata = { title: 'Configuración' }

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
    <>
      <PageHeader
        title="Configuración"
        description="Lo que define cómo funciona el bar en HUB: quién entra al panel, cuánta gente recibe el salón y cómo se ve tu marca."
      />

      {SETTINGS_GROUPS.map((group) => (
        <Section key={group} title={group}>
          <div className="grid gap-4 sm:grid-cols-2">
            {SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => (
              <SettingsCard key={section.path} section={section} tenantSlug={tenantSlug} />
            ))}
          </div>
        </Section>
      ))}
    </>
  )
}

/** Toda la tarjeta es el link: borde que se marca al pasar, foco afuera, sin «float». */
function SettingsCard({ section, tenantSlug }: { section: SettingsSection; tenantSlug: string }) {
  const Icon = section.icon
  return (
    <Card asChild interactive>
      <Link href={settingsHref(tenantSlug, section.path)}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-subtitle text-foreground">{section.title}</span>
            <span className="text-pretty type-small text-muted-foreground">
              {section.description}
            </span>
            <span className="mt-1 type-caption text-subtle-foreground">
              {section.topics.join(' · ')}
            </span>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
        </div>
      </Link>
    </Card>
  )
}
