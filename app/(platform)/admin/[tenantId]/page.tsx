import { ArrowUpRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { featuresByGroup, getTenantFeatures } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import { FeatureToggleGrid } from '../_components/feature-toggle-grid'

export const dynamic = 'force-dynamic'

type TenantRow = { id: string; name: string; slug: string; feature_flags: Record<string, boolean> }

const HIDDEN_PANELS = [
  { label: 'Plano del salón', href: (s: string) => `/${s}/local/mesas` },
  { label: 'Salón en vivo', href: (s: string) => `/${s}/salon/mesas` },
  { label: 'Cocina', href: (s: string) => `/${s}/salon/cocina` },
  { label: 'Auto-aceptación', href: (s: string) => `/${s}/local/auto-aceptacion` },
]

export default async function PlatformTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('id, name, slug, feature_flags')
    .eq('id', tenantId)
    .maybeSingle()
  if (!data) notFound()
  const tenant = data as TenantRow

  const features = getTenantFeatures(tenant)
  const groups = featuresByGroup()

  return (
    <>
      <PageHeader
        back={{ href: '/admin', label: 'Todos los bares' }}
        title={tenant.name}
        meta={<span className="font-mono">/{tenant.slug}</span>}
      />

      <FeatureToggleGrid tenantId={tenant.id} initialFeatures={features} groups={groups} />

      <Section
        title="Abrir paneles ocultos"
        description="Como superadmin podés abrirlos aunque estén apagados para el bar."
        divider
      >
        <div className="flex flex-wrap gap-2">
          {HIDDEN_PANELS.map((p) => (
            // `<a>` y no Link: el salón es otro workspace y abre en otra pestaña.
            <Button key={p.label} variant="secondary" size="sm" asChild>
              <a href={p.href(tenant.slug)} target="_blank" rel="noopener noreferrer">
                {p.label}
                <ArrowUpRight aria-hidden="true" />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </Button>
          ))}
        </div>
      </Section>
    </>
  )
}
