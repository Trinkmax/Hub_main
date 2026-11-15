'use client'

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleEllipsis,
  MessageCircleQuestion,
  Plus,
  Search,
  X,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { DOCK_PINNED, planDock } from '../dock/dock-items'
import { hapticTick } from '../dock/haptics'
import type { ResolvedNavGroup, ResolvedNavItem } from '../nav-config'
import { NAV_ICONS } from '../nav-icons'
import { AccountPanel } from './account-panel'
import { AppSheet } from './app-sheet'

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
 * - En el medio, todas las secciones como íconos de vidrio (sin colores, el trazo en el verde de la marca),
 *   agrupadas como en el menú lateral.
 * - «Editar» (arriba a la derecha): los íconos tiemblan, como en la pantalla de inicio del iPhone, y con un
 *   toque se elige qué cuatro van en la barra. Arriba se ve cómo va a quedar.
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
  bar,
  defaultBar,
  onSaveBar,
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
  /** Las claves que van hoy en la barra. */
  bar: string[]
  /** Las de siempre (las del rol), para «Volver a las de siempre». */
  defaultBar: readonly string[]
  /** Guarda la barra elegida (sin esto no se puede editar). */
  onSaveBar?: (keys: string[]) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(bar)
  const [nudge, setNudge] = useState(0)
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

  // Cada vez que se abre, arranca limpia (sin búsqueda y sin editar).
  useEffect(() => {
    if (!open) {
      setQuery('')
      setEditing(false)
    }
  }, [open])

  // Cómo va a quedar la barra con lo elegido (lo que falte se completa solo, como en el servidor).
  const preview = useMemo(
    () => (editing ? (planDock(groups, viewer.role, draft)?.bar ?? []) : []),
    [editing, groups, viewer.role, draft],
  )

  const close = () => onOpenChange(false)

  const goTo = (href: string) => {
    close()
    router.push(href)
  }

  const askTex = () => {
    close()
    openTex(asked)
  }

  const toggle = (key: string) => {
    if (draft.includes(key)) {
      setDraft(draft.filter((item) => item !== key))
    } else if (draft.length < DOCK_PINNED) {
      setDraft([...draft, key])
    } else {
      // Llena: la barra de arriba se sacude para decir «sacá una primero».
      setNudge((count) => count + 1)
      hapticTick()
      return
    }
    hapticTick()
  }

  const headerAction = onSaveBar ? (
    editing ? (
      <button
        type="button"
        className="app-sheet-text-button is-strong"
        onClick={() => {
          onSaveBar(draft)
          setEditing(false)
        }}
      >
        Listo
      </button>
    ) : (
      <button
        type="button"
        className="app-sheet-text-button"
        onClick={() => {
          setDraft(bar)
          setQuery('')
          setEditing(true)
        }}
      >
        Editar
      </button>
    )
  ) : null

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Tu barra' : tenantName}
      description="Todas las secciones del panel, un buscador y tu cuenta."
      headerAction={headerAction}
    >
      {editing ? (
        <>
          <p className="app-edit-hint">
            Tocá las secciones para elegir las {DOCK_PINNED} que van abajo. «Más» queda siempre al
            final.
          </p>
          <DockPreview
            key={nudge}
            items={preview}
            chosen={draft}
            nudged={nudge > 0}
            onRemove={toggle}
          />
        </>
      ) : (
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
      )}

      {asked && !editing ? (
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
                <span className="app-row-icon">
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
              <span className="app-row-icon">
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
              <ul className="app-tiles" data-editing={editing ? '' : undefined}>
                {group.items.map((item) => (
                  <li key={item.key}>
                    {editing ? (
                      <EditTile
                        item={item}
                        inBar={draft.includes(item.key)}
                        onToggle={() => toggle(item.key)}
                      />
                    ) : (
                      <SectionTile
                        item={item}
                        active={!item.newTab && item.href === activeHref}
                        onGo={close}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      )}

      {editing ? (
        <button
          type="button"
          className="app-edit-reset"
          onClick={() => {
            setDraft([...defaultBar])
            hapticTick()
          }}
        >
          Volver a las de siempre
        </button>
      ) : (
        <>
          <h3 className="app-group-label mt-5">Tu cuenta</h3>
          <AccountPanel
            email={viewer.email}
            roleLabel={viewer.roleLabel}
            tenantName={tenantName}
            onDone={close}
          />
        </>
      )}
    </AppSheet>
  )
}

/** Un ícono de sección: lleva a su pantalla. */
function SectionTile({
  item,
  active,
  onGo,
}: {
  item: ResolvedNavItem
  active: boolean
  onGo: () => void
}) {
  const Icon = NAV_ICONS[item.iconKey]
  return (
    <Link
      href={item.href}
      className="app-tile"
      aria-current={active ? 'page' : undefined}
      target={item.newTab ? '_blank' : undefined}
      rel={item.newTab ? 'noopener noreferrer' : undefined}
      onClick={onGo}
    >
      <span className="app-tile-icon">
        <Icon aria-hidden />
        {item.newTab ? (
          <span className="app-tile-out">
            <ArrowUpRight aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="app-tile-label">{item.label}</span>
      {item.newTab ? <span className="sr-only"> (se abre en otra pestaña)</span> : null}
    </Link>
  )
}

/** En «Editar»: el ícono tiembla y con un toque entra o sale de la barra. */
function EditTile({
  item,
  inBar,
  onToggle,
}: {
  item: ResolvedNavItem
  inBar: boolean
  onToggle: () => void
}) {
  const Icon = NAV_ICONS[item.iconKey]
  // Lo que abre otra pestaña del navegador no puede ir en la barra.
  if (item.newTab) {
    return (
      <span className="app-tile is-disabled" aria-disabled="true">
        <span className="app-tile-icon">
          <Icon aria-hidden />
        </span>
        <span className="app-tile-label">{item.label}</span>
      </span>
    )
  }
  return (
    <button type="button" className="app-tile" aria-pressed={inBar} onClick={onToggle}>
      <span className="app-tile-icon">
        <Icon aria-hidden />
        <span className={cn('app-tile-badge', inBar && 'is-in')}>
          {inBar ? <Check aria-hidden /> : <Plus aria-hidden />}
        </span>
      </span>
      <span className="app-tile-label">{item.label}</span>
      <span className="sr-only">{inBar ? ' (en tu barra)' : ' (sumar a tu barra)'}</span>
    </button>
  )
}

/**
 * Cómo va a quedar la barra: una cápsula de vidrio como la de verdad. Lo elegido se saca con un toque; lo
 * que se completa solo (si elegiste menos de cuatro) va más claro.
 */
function DockPreview({
  items,
  chosen,
  nudged,
  onRemove,
}: {
  items: ResolvedNavItem[]
  chosen: string[]
  nudged: boolean
  onRemove: (key: string) => void
}) {
  return (
    <div className="app-dock-preview" data-nudge={nudged ? '' : undefined}>
      <span aria-hidden className="lg-glass" />
      <ul className="app-dock-preview-row">
        {items.map((item) => {
          const Icon = NAV_ICONS[item.iconKey]
          const mine = chosen.includes(item.key)
          return (
            <li key={item.key}>
              <button
                type="button"
                className={cn('app-dock-preview-item', !mine && 'is-auto')}
                onClick={() => (mine ? onRemove(item.key) : undefined)}
                disabled={!mine}
                aria-label={
                  mine
                    ? `Sacar ${item.label} de la barra`
                    : `${item.label} (se completa sola: elegí otra para reemplazarla)`
                }
              >
                <Icon aria-hidden />
                <span>{item.short ?? item.label}</span>
                {mine ? (
                  <span aria-hidden className="app-dock-preview-x">
                    <X />
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
        <li>
          <span className="app-dock-preview-item is-fixed">
            <CircleEllipsis aria-hidden />
            <span>Más</span>
          </span>
        </li>
      </ul>
    </div>
  )
}
