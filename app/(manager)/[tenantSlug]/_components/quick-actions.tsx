import { ArrowRight, Receipt, UserPlus } from 'lucide-react'
import Link from 'next/link'
import type { TenantRole } from '@/lib/tenant/types'

export function QuickActions({ tenantSlug, role }: { tenantSlug: string; role: TenantRole }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/${tenantSlug}/visitas/nueva`}
        className="group inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-[0_8px_24px_-12px_var(--ring)]"
      >
        <Receipt className="size-4" />
        Cerrar mesa
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
      <Link
        href={`/${tenantSlug}/clientes/nuevo`}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-4 text-sm font-medium text-foreground transition-colors hover:bg-card"
      >
        <UserPlus className="size-4" />
        Nuevo cliente
      </Link>
      {role === 'owner' ? (
        <Link
          href={`/${tenantSlug}/estadisticas`}
          className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex sm:items-center sm:gap-1"
        >
          Ver estadísticas completas
          <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  )
}
