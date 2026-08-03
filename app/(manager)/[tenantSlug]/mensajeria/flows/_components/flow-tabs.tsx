'use client'

import { History, Workflow } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { matchesPath } from '@/components/shell/nav-active'
import { cn } from '@/lib/utils'

// Barra de sub-navegación de una automatización. Links reales (no tabs con
// estado de cliente) para que cada pestaña sea una URL compartible y el back
// del navegador funcione. El activo se resuelve con el mismo helper que el
// sidebar, así no hay dos ideas distintas de "estoy acá".

export function FlowTabs({ tenantSlug, flowId }: { tenantSlug: string; flowId: string }) {
  const pathname = usePathname()
  const base = `/${tenantSlug}/mensajeria/flows/${flowId}`

  const tabs = [
    { href: base, icon: Workflow, label: 'Creador', short: 'Creador', exact: true },
    {
      href: `${base}/registros`,
      icon: History,
      label: 'Registros de ejecución',
      short: 'Registros',
      exact: false,
    },
  ]

  return (
    <nav
      aria-label="Secciones de la automatización"
      className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-4 sm:px-6"
    >
      {tabs.map((tab) => {
        const active = matchesPath(pathname, tab.href, tab.exact)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-2 whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
