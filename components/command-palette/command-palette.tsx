'use client'

import { useCommandState } from 'cmdk'
import { Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NO_ACCOUNTING_ACCESS } from '@/components/shell/accounting-gates'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import type { TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import {
  type CommandEntry,
  commandEntries,
  groupCommandEntries,
  needsFullReload,
  resolveCommandHref,
  visibleCommandEntries,
} from './command-config'
import {
  pageEntryForPath,
  pushRecentId,
  readRecentIds,
  recentEntries,
  writeRecentIds,
} from './recent-pages'
import { useCommandShortcuts } from './use-command-shortcuts'

type CommandPaletteProps = {
  tenantSlug: string
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** `TenantAccess.accounting`. Sin él, Administración queda cerrada. */
  accounting?: AccountingAccess
}

/** Lo que la paleta dice que hace, y nada más: busca páginas y acciones (todavía no clientes). */
const TRIGGER_LABEL = 'Buscar o ir a…'
const KEY_SHORTCUTS = 'Meta+K Control+K'

/**
 * ⌘K del panel (§4.4). Abre al instante (el `CommandDialog` del kit no anima:
 * se usa decenas de veces por día) con ⌘K o Ctrl+K desde cualquier lado,
 * también en el celular, que ahora tiene su lupa en el topbar.
 *
 * Grupos: «Recientes» (solo con la búsqueda vacía), «Acciones rápidas»,
 * «Administración», «Operación» e «Ir a». La búsqueda de clientes, proveedores
 * y cuentas es la fase 2: por Route Handler GET con `AbortController`, no por
 * Server Action (se encolan).
 */
export function CommandPalette({
  tenantSlug,
  role,
  features,
  isPlatformAdmin,
  accounting = NO_ACCOUNTING_ACCESS,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  const toggle = useCallback(() => setOpen((current) => !current), [])
  useCommandShortcuts(toggle)

  const visible = useMemo(
    () => visibleCommandEntries(commandEntries, { role, features, isPlatformAdmin, accounting }),
    [role, features, isPlatformAdmin, accounting],
  )
  const groupedEntries = useMemo(() => groupCommandEntries(visible), [visible])
  const currentPage = useMemo(
    () => pageEntryForPath(pathname, tenantSlug, visible),
    [pathname, tenantSlug, visible],
  )

  // Cada página de la paleta que se abre entra primera en «Recientes».
  useEffect(() => {
    if (!currentPage) return
    writeRecentIds(tenantSlug, pushRecentId(readRecentIds(tenantSlug), currentPage.id))
  }, [tenantSlug, currentPage])

  // Se leen al abrir, en el mismo render: la lista aparece armada, sin saltos.
  // Cerrada no toca el storage (y en el server, donde no existe, nunca está abierta).
  const recents = useMemo(
    () => (open ? recentEntries(readRecentIds(tenantSlug), visible, currentPage?.id) : []),
    [open, tenantSlug, visible, currentPage],
  )

  const handleSelect = useCallback(
    (entry: CommandEntry) => {
      setOpen(false)
      const href = resolveCommandHref(entry, tenantSlug, {
        pathname,
        search: window.location.search,
      })
      // El salón y lo público tienen su propio <html>: se llega recargando.
      if (needsFullReload(href, tenantSlug)) {
        window.location.assign(href)
        return
      }
      router.push(href)
    },
    [pathname, router, tenantSlug],
  )

  return (
    <>
      {/* Celular: la lupa (44 px con el dedo). */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={TRIGGER_LABEL}
        aria-keyshortcuts={KEY_SHORTCUTS}
        onClick={() => setOpen(true)}
      >
        <Search strokeWidth={1.75} aria-hidden="true" />
      </Button>

      {/* Desde md: con aspecto de campo, para que se entienda que se escribe. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts={KEY_SHORTCUTS}
        className="hidden h-(--control-md) w-full max-w-md items-center gap-2 rounded-md border border-input bg-card px-3 text-left type-body text-subtle-foreground outline-(--ring) -outline-offset-1 transition-colors duration-(--duration-quick) hover:text-muted-foreground focus-visible:outline-2 md:flex"
      >
        <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{TRIGGER_LABEL}</span>
        <KbdShortcut keys={['mod', 'k']} aria-hidden="true" />
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Buscar páginas y acciones…" />
        <CommandList>
          <CommandEmpty />
          <RecentGroup entries={recents} onSelect={handleSelect} />
          {groupedEntries.map((g, index) => (
            <PaletteGroup
              key={g.group}
              label={g.group}
              entries={g.items}
              onSelect={handleSelect}
              showSeparator={index > 0}
            />
          ))}
        </CommandList>
        <CommandFooter />
      </CommandDialog>
    </>
  )
}

/**
 * «Recientes» solo con la búsqueda vacía: mientras se escribe, las mismas
 * páginas aparecen en su grupo y no se duplican.
 */
function RecentGroup({
  entries,
  onSelect,
}: {
  entries: CommandEntry[]
  onSelect: (entry: CommandEntry) => void
}) {
  const searching = useCommandState((state) => state.search.trim() !== '')
  if (searching || entries.length === 0) return null
  return (
    <>
      <CommandGroup heading="Recientes">
        {entries.map((entry) => (
          // Valor propio: cmdk identifica la opción por `value` y no puede
          // repetirse con la misma página en su grupo.
          <PaletteItem
            key={entry.id}
            entry={entry}
            value={`reciente:${entry.id}`}
            onSelect={onSelect}
          />
        ))}
      </CommandGroup>
      <CommandSeparator />
    </>
  )
}

function PaletteGroup({
  label,
  entries,
  onSelect,
  showSeparator,
}: {
  label: string
  entries: CommandEntry[]
  onSelect: (entry: CommandEntry) => void
  showSeparator: boolean
}) {
  return (
    <>
      {showSeparator ? <CommandSeparator /> : null}
      <CommandGroup heading={label}>
        {entries.map((entry) => (
          <PaletteItem
            key={entry.id}
            entry={entry}
            value={`${entry.label} ${entry.keywords?.join(' ') ?? ''}`}
            onSelect={onSelect}
          />
        ))}
      </CommandGroup>
    </>
  )
}

function PaletteItem({
  entry,
  value,
  onSelect,
}: {
  entry: CommandEntry
  value: string
  onSelect: (entry: CommandEntry) => void
}) {
  const Icon = entry.icon
  return (
    <CommandItem value={value} onSelect={() => onSelect(entry)}>
      <Icon strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.hint ? <CommandShortcut>{entry.hint}</CommandShortcut> : null}
    </CommandItem>
  )
}
