import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listItemTags } from '@/lib/item-tags/queries'
import { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import { PunchCardsManager } from './_components/punch-cards-manager'

export const metadata = { title: 'Punch cards' }

export default async function PunchCardsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }
  if (role !== 'owner') notFound()

  const supabase = await createClient()
  const [{ data: items }, { data: cats }, tags, { data: rewards }, templates] = await Promise.all([
    supabase.from('menu_items').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase.from('menu_categories').select('id, name').eq('tenant_id', tenantId).order('name'),
    listItemTags(tenantId),
    supabase.from('rewards').select('id, name').eq('tenant_id', tenantId).order('name'),
    listPunchCardTemplates(tenantId),
  ])

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        eyebrow="Catálogo"
        title="Punch cards"
        description="Tarjetas perforadas: cada N consumos, un reward."
      />
      <Section>
        <PunchCardsManager
          tenantSlug={tenantSlug}
          initialTemplates={templates}
          items={items ?? []}
          categories={cats ?? []}
          tags={tags}
          rewards={rewards ?? []}
        />
      </Section>
    </main>
  )
}
