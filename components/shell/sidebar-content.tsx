import Link from 'next/link'
import { Suspense } from 'react'
import type { TenantFeatures } from '@/lib/platform/features'
import { homePathForRole, ROLE_LABELS } from '@/lib/tenant/roles'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { resolveNavGroups } from './nav-config'
import { SidebarNav } from './sidebar-nav'

export function SidebarContent({
  tenant,
  role,
  features,
  isPlatformAdmin,
  accounting,
  onNavigate,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** Administración para esta persona (`access.accounting`): suma o saca su entrada. */
  accounting?: AccountingAccess
  onNavigate?: () => void
}) {
  const groups = resolveNavGroups(role, tenant.slug, features, isPlatformAdmin, accounting)

  return (
    <>
      <div className="flex items-center justify-center px-4 pt-5 pb-4">
        {/* El home de cada rol: la contadora o el editor no pueden abrir el inicio del dueño. */}
        <Link
          href={homePathForRole(role, tenant.slug)}
          onClick={onNavigate}
          className="flex items-center justify-center rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Ir al inicio de ${tenant.name}`}
        >
          {tenant.logo_url ? (
            // biome-ignore lint/performance/noImgElement: Storage URL externa con cache-buster, Next/Image requiere remotePatterns config global
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="h-14 w-auto max-w-[200px] object-contain"
            />
          ) : (
            <span className="font-serif text-4xl font-semibold leading-none tracking-[-0.045em]">
              HUB
              <span className="text-primary">!</span>
            </span>
          )}
        </Link>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* Un solo menú: la lista y, anclada al fondo, Configuración. El fallback
          ocupa el mismo lugar para que el pie no salte. */}
      <Suspense fallback={<div className="flex-1" />}>
        <SidebarNav groups={groups} onNavigate={onNavigate} />
      </Suspense>

      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-[11px] font-medium text-muted-foreground/90">{tenant.name}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/60">
          /{tenant.slug}
        </p>
        <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          {ROLE_LABELS[role]}
        </p>
      </div>
    </>
  )
}
