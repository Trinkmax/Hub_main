'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { FeatureKey } from '@/lib/platform/features'
import { cn } from '@/lib/utils'
import { visibleSettingsGroups } from './settings-sections'

/**
 * El menú lateral de Configuración (compu, y solo adentro de una pantalla). Las entradas salen de
 * `settings-sections.ts`, la misma lista que dibuja la portada.
 */
export function SettingsNav({
  tenantSlug,
  features,
}: {
  tenantSlug: string
  /** Las funciones que ve quien mira (las del bar; todas si es superadmin). */
  features: readonly FeatureKey[]
}) {
  const pathname = usePathname()
  const groups = visibleSettingsGroups((feature) => features.includes(feature))

  // En la portada la lista ya está en la página (con una línea que explica cada cosa): repetirla al
  // costado era mostrar lo mismo dos veces. El menú aparece al entrar a una pantalla.
  if (pathname === `/${tenantSlug}/configuracion`) return null

  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      <div className="sticky top-20">
        <nav aria-label="Secciones de Configuración" className="space-y-5">
          {groups.map((group) => {
            const Icon = group.icon
            return (
              <div key={group.label} className="space-y-1.5">
                <div className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  <Icon className="size-3" aria-hidden />
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const href = item.href(tenantSlug)
                    const active = pathname === href || pathname.startsWith(`${href}/`)
                    return (
                      <li key={item.label}>
                        <Link
                          href={href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex h-8 items-center rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                            active
                              ? 'bg-secondary font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-(--cream-tint) hover:text-foreground',
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
