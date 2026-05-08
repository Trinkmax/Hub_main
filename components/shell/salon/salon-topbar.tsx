import { BrandWordmark } from '@/components/shell/brand-mark'
import type { Tenant } from '@/lib/tenant/types'

export function SalonTopbar({ tenant }: { tenant: Pick<Tenant, 'id' | 'name' | 'slug'> }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
      <BrandWordmark className="text-lg" />
      <span className="ml-1 truncate text-xs font-medium text-muted-foreground">{tenant.name}</span>
    </header>
  )
}
