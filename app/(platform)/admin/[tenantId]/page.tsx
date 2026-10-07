import { ArrowLeft, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Todos los bares
      </Link>

      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <p className="font-mono text-xs text-muted-foreground">/{tenant.slug}</p>
      </div>

      <FeatureToggleGrid tenantId={tenant.id} initialFeatures={features} groups={groups} />

      <div className="space-y-2 rounded-xl border border-border/60 bg-card/60 p-4">
        <p className="text-sm font-medium">Abrir paneles ocultos</p>
        <p className="text-xs text-muted-foreground">
          Como superadmin podés abrirlos aunque estén OFF para el bar.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {HIDDEN_PANELS.map((p) => (
            <Link
              key={p.label}
              href={p.href(tenant.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary"
            >
              {p.label}
              <ExternalLink className="size-3" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
