import { Receipt, Users } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SalesTab = 'ventas' | 'funciones'

/**
 * Las dos caras de Ventas online: las compras, día por día, y las funciones con su cupo
 * (11/11/2026). Links de verdad, así cada una tiene su URL y el «atrás» del celular anda.
 */
export function SalesTabs({ tenantSlug, active }: { tenantSlug: string; active: SalesTab }) {
  const tabs = [
    { key: 'ventas', href: `/${tenantSlug}/ventas-online`, label: 'Ventas', icon: Receipt },
    {
      key: 'funciones',
      href: `/${tenantSlug}/ventas-online/funciones`,
      label: 'Funciones y cupos',
      icon: Users,
    },
  ] as const

  return (
    <nav aria-label="Ventas online" className="flex items-center gap-1 border-b border-border/60">
      {tabs.map((tab) => {
        const on = tab.key === active
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'relative flex min-h-11 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors',
              on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {tab.label}
            {on ? (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
