import Link from 'next/link'
import { Suspense } from 'react'
import type { TenantFeatures } from '@/lib/platform/features'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { resolveNavGroups } from './nav-config'
import { SidebarNav } from './sidebar-nav'

export function SidebarContent({
  tenant,
  role,
  features,
  isPlatformAdmin,
  onNavigate,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  onNavigate?: () => void
}) {
  const groups = resolveNavGroups(role, tenant.slug, features, isPlatformAdmin)
  const mainGroups = groups.filter((g) => !g.pinned)
  const pinnedGroups = groups.filter((g) => g.pinned)

  return (
    <>
      <div className="flex items-center justify-center px-4 pt-5 pb-4">
        <Link
          href={`/${tenant.slug}`}
          onClick={onNavigate}
          className="flex items-center justify-center rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85"
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

      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={null}>
          <SidebarNav groups={mainGroups} onNavigate={onNavigate} />
        </Suspense>
      </div>

      {pinnedGroups.length > 0 ? (
        <div className="border-t border-border/60">
          <Suspense fallback={null}>
            <SidebarNav groups={pinnedGroups} onNavigate={onNavigate} className="py-2" />
          </Suspense>
        </div>
      ) : null}

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
