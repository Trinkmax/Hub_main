import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listItemTags, listMenuItemsWithTags } from '@/lib/item-tags/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { TagsManager } from './_components/tags-manager'

export const metadata = { title: 'Tags de carta' }

export default async function TagsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const [tags, items] = await Promise.all([listItemTags(tenantId), listMenuItemsWithTags(tenantId)])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración · Tags"
        title="Tags de carta"
        description="Etiquetá ítems para usar en punch cards (#cafe, #vegano, etc.)"
      />
      <Section>
        <TagsManager tenantSlug={tenantSlug} initialTags={tags} initialItems={items} />
      </Section>
    </div>
  )
}
