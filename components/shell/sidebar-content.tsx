import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'
import type { TenantFeatures } from '@/lib/platform/features'
import { homePathForRole, ROLE_LABELS } from '@/lib/tenant/roles'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { NO_ACCOUNTING_ACCESS } from './accounting-gates'
import { resolveNavGroups } from './nav-config'
import { SidebarNav } from './sidebar-nav'

/**
 * El contenido del menú lateral: lo dibuja el `<aside>` de escritorio y el
 * cajón del celular (el mismo componente, así nunca se separan). Server-safe:
 * lo renderiza el AppShell y lo importa el cajón (cliente), así que no puede
 * traer nada de servidor.
 */
export function SidebarContent({
  tenant,
  role,
  features,
  isPlatformAdmin,
  accounting = NO_ACCOUNTING_ACCESS,
  onNavigate,
  touch = false,
  brandAction,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** `TenantAccess.accounting`. Sin él, Administración queda cerrada. */
  accounting?: AccountingAccess
  onNavigate?: () => void
  /** El cajón del celular: filas de 44 px. */
  touch?: boolean
  /** A la derecha de la fila de marca (el «Cerrar» del cajón). */
  brandAction?: ReactNode
}) {
  const groups = resolveNavGroups(role, tenant.slug, features, isPlatformAdmin, accounting)
  const mainGroups = groups.filter((g) => !g.pinned)
  const pinnedGroups = groups.filter((g) => g.pinned)

  return (
    <>
      {/* Fila de marca: mide lo mismo que el topbar y su pelo de abajo sigue el
          del topbar, una sola línea de lado a lado. El logo lleva al inicio de
          cada rol (la contadora, a Administración): sin el rebote del proxy. */}
      <div className="flex h-(--topbar-h) shrink-0 items-center justify-between gap-2 border-b border-border pr-2 pl-4">
        <Link
          href={homePathForRole(role, tenant.slug)}
          onClick={onNavigate}
          aria-label={`Ir al inicio de ${tenant.name}`}
          className="flex min-w-0 items-center rounded-md outline-(--ring) outline-offset-2 focus-visible:outline-2"
        >
          {tenant.logo_url ? (
            // biome-ignore lint/performance/noImgElement: Storage URL externa con cache-buster, Next/Image requiere remotePatterns config global
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="max-h-8 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <span className="font-display text-[22px] leading-none font-semibold text-foreground">
              HUB<span className="text-primary">!</span>
            </span>
          )}
        </Link>
        {brandAction}
      </div>

      <nav aria-label="Navegación principal" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Suspense fallback={null}>
            <SidebarNav groups={mainGroups} onNavigate={onNavigate} touch={touch} />
          </Suspense>
        </div>

        {pinnedGroups.length > 0 ? (
          <div className="shrink-0 border-t border-border">
            <Suspense fallback={null}>
              <SidebarNav
                groups={pinnedGroups}
                onNavigate={onNavigate}
                touch={touch}
                className="py-2"
              />
            </Suspense>
          </div>
        ) : null}
      </nav>

      {/* Pie: el bar y el rol, en minúscula normal (antes el rol iba en
          mayúsculas de 10 px). */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <p className="truncate type-small font-medium text-foreground">{tenant.name}</p>
        <p className="mt-0.5 type-caption text-subtle-foreground">{ROLE_LABELS[role]}</p>
      </div>
    </>
  )
}
