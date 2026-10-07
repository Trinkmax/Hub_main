import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { listItemTags, listMenuItemsWithTags } from '@/lib/item-tags/queries'
import { MENU_EDIT_ROLES, requireTenantAccess } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'
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
  if (!MENU_EDIT_ROLES.includes(role as TenantRole)) notFound()

  const [tags, items] = await Promise.all([listItemTags(tenantId), listMenuItemsWithTags(tenantId)])

  return (
    <PageShell width="comfortable">
      <PageHeader
        back={{ href: `/${tenantSlug}/menu`, label: 'Carta' }}
        title="Tags de carta"
        description="Etiquetá ítems para usarlos en las punch cards (#cafe, #vegano, etc.)."
      />
      <TagsManager tenantSlug={tenantSlug} initialTags={tags} initialItems={items} />
    </PageShell>
  )
}
