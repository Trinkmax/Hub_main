'use client'

import { Settings } from 'lucide-react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import type { ResolvedSectionTab } from '@/components/shell/section-tabs-config'
import { cn } from '@/lib/utils'
import {
  type AdmAudience,
  type AdmNavSection,
  activeAdmSection,
  activeAdmSub,
  buildAdmNav,
} from './adm-nav-model'
import { LauncherButton } from './launcher'

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** El resorte de la pestaña elegida: se desliza de una a otra, sin rebotar de más. */
const SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 } as const

function SectionTab({
  section,
  active,
  reduceMotion,
}: {
  section: AdmNavSection
  active: boolean
  reduceMotion: boolean
}) {
  return (
    <Link
      href={section.href}
      aria-current={active ? 'page' : undefined}
      data-nav-current={active ? '' : undefined}
      className={cn(
        'relative inline-flex h-8.5 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors motion-reduce:transition-none',
        active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        FOCUS,
      )}
    >
      {active ? (
        <motion.span
          layoutId="adm-nav-active"
          transition={reduceMotion ? { duration: 0 } : SPRING}
          className="absolute inset-0 rounded-lg bg-primary shadow-xs"
        />
      ) : null}
      <span className="relative">
        {section.shortLabel ? (
          <>
            <span className="sm:hidden">{section.shortLabel}</span>
            <span className="max-sm:hidden">{section.label}</span>
          </>
        ) : (
          section.label
        )}
      </span>
    </Link>
  )
}

/** Las solapas de la sección. Con el subrayado que se desliza; `search` llega por props para el Suspense. */
function SubTabsRow({ section, reduceMotion }: { section: AdmNavSection; reduceMotion: boolean }) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const active = activeAdmSub(section, pathname, search)
  if (section.sub.length === 0 && !section.action) return null
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3 sm:px-6 lg:px-8">
      <LayoutGroup id={`adm-sub-${section.value}`}>
        <nav
          aria-label={section.label}
          className="-mx-1 flex min-w-0 max-w-full gap-4 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {section.sub.map((sub) => {
            const on = sub.value === active
            return (
              <Link
                key={sub.value}
                href={sub.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative shrink-0 whitespace-nowrap rounded-sm pt-1 pb-2 text-[13.5px] transition-colors motion-reduce:transition-none',
                  on
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  FOCUS,
                )}
              >
                {sub.label}
                {on ? (
                  <motion.span
                    layoutId="adm-sub-active"
                    transition={reduceMotion ? { duration: 0 } : SPRING}
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </Link>
            )
          })}
        </nav>
      </LayoutGroup>
      {section.action ? (
        <Link
          href={section.action.href}
          className={cn(
            'inline-flex h-7.5 shrink-0 items-center rounded-md border border-border bg-card px-2.5 text-[13px] font-medium shadow-xs transition-colors hover:bg-secondary/70 motion-reduce:transition-none',
            FOCUS,
          )}
        >
          {section.action.label}
        </Link>
      ) : null}
    </div>
  )
}

/**
 * La navegación de Administración: una fila con seis palabras, el engranaje y «Cargar». Debajo, las
 * solapas de la sección donde estás. La fila queda pegada arriba al bajar: una planilla larga no
 * te hace perder el menú.
 *
 * Quién ve qué lo decide `resolveSection('administracion', …)` en el layout: acá llegan solo las
 * pestañas permitidas. «Cargar» depende del permiso de escritura (la contadora no lo ve).
 */
export function AdmNav({
  label,
  tabs,
  audience = 'owner',
}: {
  /** Nombre accesible de la barra. */
  label: string
  tabs: readonly ResolvedSectionTab[]
  audience?: AdmAudience
}) {
  const pathname = usePathname()
  const { tenantSlug } = useAccounting()
  const reduceMotion = useReducedMotion() ?? false
  const rowRef = useRef<HTMLDivElement>(null)
  const model = useMemo(
    () => buildAdmNav(tabs, { base: `/${tenantSlug}/administracion`, audience }),
    [tabs, tenantSlug, audience],
  )
  const active = activeAdmSection(model, pathname)
  const activeValue = active?.value ?? null

  // En el celular la fila se desliza: que la elegida quede a la vista, sin mover la página.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `activeValue` no se lee adentro, pero al cambiar de sección hay que volver a acomodar la fila (el DOM ya marca la nueva)
  useEffect(() => {
    const row = rowRef.current
    const current = row?.querySelector<HTMLElement>('[data-nav-current]')
    if (!row || !current || row.scrollWidth <= row.clientWidth) return
    const box = current.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    if (box.left < rowBox.left || box.right > rowBox.right) {
      row.scrollLeft += box.left - rowBox.left - 12
    }
  }, [activeValue])

  if (tabs.length === 0) return null
  const settingsOn = activeValue === model.settings.value

  return (
    <>
      <div className="sticky top-14 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <nav
          aria-label={label}
          className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2 sm:px-6 lg:px-8"
        >
          <LayoutGroup id="adm-nav">
            <div
              ref={rowRef}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {model.sections.map((section) => (
                <SectionTab
                  key={section.value}
                  section={section}
                  active={section.value === activeValue}
                  reduceMotion={reduceMotion}
                />
              ))}
            </div>
          </LayoutGroup>
          <Link
            href={model.settings.href}
            aria-label={model.settings.label}
            title={model.settings.label}
            aria-current={settingsOn ? 'page' : undefined}
            className={cn(
              'inline-flex size-8.5 shrink-0 items-center justify-center rounded-lg transition-colors motion-reduce:transition-none',
              settingsOn
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
              FOCUS,
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Link>
          <LauncherButton className="max-lg:hidden" />
        </nav>
      </div>
      {active ? (
        <Suspense fallback={null}>
          <SubTabsRow section={active} reduceMotion={reduceMotion} />
        </Suspense>
      ) : null}
    </>
  )
}
