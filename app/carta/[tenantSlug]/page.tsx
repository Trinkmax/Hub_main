import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { listActiveMenuPublic } from '@/lib/menu/queries'
import { buildCategoryTree } from '@/lib/menu/tree'
import { createServiceClient } from '@/lib/supabase/service'
import { CartaView } from './_components/carta-view'

export const dynamic = 'force-dynamic'

type TenantRow = {
  id: string
  name: string
  logo_url: string | null
  brand_accent: string | null
}

async function resolveTenant(slug: string): Promise<TenantRow | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('tenants')
    .select('id, name, logo_url, brand_accent')
    .eq('slug', slug)
    .maybeSingle()
  return (data as TenantRow | null) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) return { title: 'Carta' }
  return {
    title: `Carta · ${tenant.name}`,
    description: `La carta de ${tenant.name}.`,
  }
}

export default async function CartaPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) notFound()

  const { categories, items } = await listActiveMenuPublic({ tenantId: tenant.id })
  const tree = buildCategoryTree(categories, items)

  return (
    <BrandAccent accent={tenant.brand_accent} className="min-h-[100dvh] bg-background">
      <CartaView
        tenantName={tenant.name}
        logoUrl={tenant.logo_url}
        tree={tree}
        flatCategories={categories}
      />
    </BrandAccent>
  )
}
