'use client'

import { ArrowUpRight, ChevronRight, MessageCircleQuestion, Search, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { openTex } from '@/components/administracion/tex/open-tex'
import {
  commandEntryHref,
  searchCommandEntries,
  visibleCommandEntries,
} from '@/components/command-palette/command-entries'
import type { TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import type { ResolvedNavGroup } from '../nav-config'
import { NAV_ICONS } from '../nav-icons'
import { AccountPanel } from './account-panel'
import { AppSheet } from './app-sheet'

/** El color de los íconos de cada bloque del menú, como las carpetas de una pantalla de inicio. */
const GROUP_TONES: Record<string, string> = {
  Hoy: 'forest',
  'Agenda y clientes': 'blue',
  Negocio: 'amber',
  Salón: 'terracotta',
  Ajustes: 'slate',
}

export type MoreSheetViewer = {
  role: TenantRole
  roleLabel: string
  features: TenantFeatures
  isPlatformAdmin: boolean
  accounting: AccountingAccess
  email: string
}

/**
 * «Más» en el celular: todo lo que no entra en la barra de abajo.
 *
 * - Arriba, un buscador con las mismas entradas que ⌘K en la compu (acciones, pantallas, Administración);
 *   si no aparece y Tex está, se le pregunta a él.
 * - En el medio, todas las secciones como íconos de app, agrupadas como en el menú lateral, cada bloque con
 *   su color.
 * - Abajo, tu cuenta (apariencia, «Ver como», contraseña, salir).
 */
export function MoreSheet({
  open,
  onOpenChange,
  slug,
  tenantName,
  groups,
  activeHref,
  viewer,
  tex,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  tenantName: string
  groups: ResolvedNavGroup[]
  /** La entrada del menú de la página abierta (para marcarla). */
  activeHref: string | null
  viewer: MoreSheetViewer
  /** ¿Está Tex en este panel? */
  tex: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const asked = query.trim()

  const entries = useMemo(
    () =>
      visibleCommandEntries({
        role: viewer.role,
        features: viewer.features,
        isPlatformAdmin: viewer.isPlatformAdmin,
        accounting: viewer.accounting,
      }),
    [viewer.role, viewer.features, viewer.isPlatformAdmin, viewer.accounting],
  )
  const results = useMemo(() => searchCommandEntries(entries, asked), [entries, asked])

  // Cada vez que se abre, arranca limpia.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const close = () => onOpenChange(false)

  const goTo = (href: string) => {
    close()
    router.push(href)
  }

  const askTex = () => {
    close()
    openTex(asked)
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title={tenantName}
      description="Todas las secciones del panel, un buscador y tu cuenta."
    >
      <form
        aria-label="Buscar en el panel"
        className="app-search"
        onSubmit={(event) => {
          event.preventDefault()
          const first = results[0]
          if (first) goTo(commandEntryHref(first, slug, pathname, window.location.search))
          else if (tex && asked.length >= 2) askTex()
        }}
      >
        <Search aria-hidden className="app-search-icon" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tex ? 'Buscá o pedile algo a Tex' : 'Buscar en el panel'}
          aria-label="Buscar acciones y pantallas"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="app-search-input"
        />
        {query ? (
          <button
            type="button"
            className="app-search-clear"
            aria-label="Borrar la búsqueda"
            onClick={() => setQuery('')}
          >
            <X aria-hidden className="size-3.5" strokeWidth={3} />
          </button>
        ) : null}
      </form>

      {asked ? (
        <div className="app-group app-group-list mt-3" aria-live="polite">
          {results.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                className="app-row"
                onClick={() =>
                  goTo(commandEntryHref(entry, slug, pathname, window.location.search))
                }
              >
                <span className="app-row-icon" data-tone={toneForCommand(entry.group)}>
                  <Icon aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{entry.label}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {entry.group}
                  </span>
                </span>
                <ChevronRight aria-hidden className="app-row-chevron" />
              </button>
            )
          })}
          {tex && asked.length >= 2 ? (
            <button type="button" className="app-row" onClick={askTex}>
              <span className="app-row-icon" data-tone="navy">
                <MessageCircleQuestion aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">Preguntale a Tex: «{asked}»</span>
              <ChevronRight aria-hidden className="app-row-chevron" />
            </button>
          ) : null}
          {results.length === 0 && !(tex && asked.length >= 2) ? (
            <p className="px-4 py-5 text-center text-sm text-muted-foreground">
              No encontramos nada con «{asked}».
            </p>
          ) : null}
        </div>
      ) : (
        <nav aria-label="Todas las secciones" className="mt-1">
          {groups.map((group) => (
            <section key={group.label} aria-labelledby={`more-${group.label}`}>
              <h3 id={`more-${group.label}`} className="app-group-label">
                {group.label}
              </h3>
              <ul className="app-tiles">
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.iconKey]
                  const active = !item.newTab && item.href === activeHref
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        className="app-tile"
                        aria-current={active ? 'page' : undefined}
                        target={item.newTab ? '_blank' : undefined}
                        rel={item.newTab ? 'noopener noreferrer' : undefined}
                        onClick={close}
                      >
                        <span className="app-tile-icon" data-tone={GROUP_TONES[group.label]}>
                          <Icon aria-hidden />
                          {item.newTab ? (
                            <span className="app-tile-out">
                              <ArrowUpRight aria-hidden />
                            </span>
                          ) : null}
                        </span>
                        <span className="app-tile-label">{item.label}</span>
                        {item.newTab ? (
                          <span className="sr-only"> (se abre en otra pestaña)</span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>
      )}

      <h3 className="app-group-label mt-5">Tu cuenta</h3>
      <AccountPanel
        email={viewer.email}
        roleLabel={viewer.roleLabel}
        tenantName={tenantName}
        onDone={close}
      />
    </AppSheet>
  )
}

function toneForCommand(group: string): string {
  if (group === 'Acciones rápidas') return 'forest'
  if (group === 'Administración') return 'amber'
  if (group === 'Operación') return 'terracotta'
  return 'blue'
}
