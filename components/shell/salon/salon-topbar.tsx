'use client'

import { usePathname } from 'next/navigation'
import { BrandWordmark } from '@/components/shell/brand-mark'
import type { Tenant } from '@/lib/tenant/types'
import { salonTitleFor } from './salon-nav'

/**
 * Topbar del salón: marca chica + título de la pantalla actual + cuenta.
 *
 * El título sale de `salon-nav.ts` en vez de un `PageHeader` por página. Antes
 * había dos barras diciendo casi lo mismo ("HUB! · Hub" arriba, "Validar" en un
 * serif de 34px abajo) y entre las dos se comían ~180px de un celular. Ahora el
 * chrome son 56px y el resto es operativa.
 *
 * z-30: por encima de cualquier `sticky` de contenido (z-10) y por debajo de la
 * tab bar (z-40). El header del operativo de reservas estaba en z-30 y tapaba
 * este topbar al scrollear.
 */
export function SalonTopbar({
  tenant,
  account,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>
  account: React.ReactNode
}) {
  const pathname = usePathname()
  const title = salonTitleFor(pathname, tenant.slug)

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-[var(--salon-topbar-h)] w-full max-w-screen-md items-center gap-3 px-4">
        <BrandWordmark className="text-base" />
        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {title ?? tenant.name}
        </h1>
        {account}
      </div>
    </header>
  )
}
