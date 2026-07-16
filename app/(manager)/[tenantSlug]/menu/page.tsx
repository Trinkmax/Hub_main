import { notFound, redirect } from 'next/navigation'
import { listItemTags } from '@/lib/item-tags/queries'
import { listMenu } from '@/lib/menu/queries'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { MenuHub } from './_components/menu-hub'

export const metadata = { title: 'Carta' }

// Tabs válidos del viejo mundo Club (compat de deep-links ?world=club&tab=…).
const CLUB_TABS = new Set(['programa', 'aliados', 'bienvenida', 'punch'])

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  // El Club ya no vive acá: /menu?world=club era el editor unificado previo al
  // split. Redirigimos para no romper links guardados.
  if (sp.world === 'club') {
    const tab = typeof sp.tab === 'string' && CLUB_TABS.has(sp.tab) ? sp.tab : 'programa'
    redirect(`/${tenantSlug}/club?tab=${tab}`)
  }

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, MENU_EDIT_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  const tenantId = access.tenant.id

  const [menu, tags] = await Promise.all([listMenu({ tenantId }), listItemTags(tenantId)])

  return (
    <MenuHub
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      role={access.role}
      menu={menu}
      tags={tags}
    />
  )
}
