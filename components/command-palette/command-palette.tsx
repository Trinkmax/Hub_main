'use client'

import { MessageCircleQuestion, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { openTex, texAvailable } from '@/components/administracion/tex/open-tex'
import { NO_ACCOUNTING } from '@/components/shell/nav-config'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import type { TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import type { CommandEntry, commandEntries } from './command-config'
import { COMMAND_GROUPS_ORDER, commandEntryHref, visibleCommandEntries } from './command-entries'
import { useCommandShortcuts } from './use-command-shortcuts'

type CommandPaletteProps = {
  tenantSlug: string
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** Administración para esta persona (`access.accounting`). */
  accounting?: AccountingAccess
}

export function CommandPalette({
  tenantSlug,
  role,
  features,
  isPlatformAdmin,
  accounting = NO_ACCOUNTING,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()
  const pathname = usePathname()
  const asked = query.trim()

  const toggle = useCallback(() => setOpen((current) => !current), [])
  useCommandShortcuts(toggle)

  const groupedEntries = useMemo(() => {
    const visible = visibleCommandEntries({ role, features, isPlatformAdmin, accounting })
    return COMMAND_GROUPS_ORDER.map((group) => ({
      group,
      items: visible.filter((entry) => entry.group === group),
    })).filter((g) => g.items.length > 0)
  }, [accounting, features, isPlatformAdmin, role])

  const handleSelect = useCallback(
    (entry: CommandEntry) => {
      setOpen(false)
      const search = typeof window === 'undefined' ? '' : window.location.search
      router.push(commandEntryHref(entry, tenantSlug, pathname, search))
    },
    [pathname, router, tenantSlug],
  )

  return (
    <>
      <CommandTriggerButton onClick={() => setOpen(true)} />
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Buscar y navegar"
        description="Tipeá el nombre de una acción, página o cliente."
      >
        <CommandInput
          placeholder="Buscar acciones, páginas, clientes…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No encontramos nada que coincida.</CommandEmpty>
          {groupedEntries.map((g, index) => (
            <CommandPaletteGroup
              key={g.group}
              label={g.group}
              entries={g.items}
              onSelect={handleSelect}
              showSeparator={index > 0}
            />
          ))}
          {/* Lo que no se encuentra se le pregunta: Tex solo existe en Administración. */}
          {open && asked.length >= 2 && texAvailable() ? (
            <CommandGroup heading="Tex" forceMount>
              <CommandItem
                forceMount
                value={`tex ${asked}`}
                onSelect={() => {
                  setOpen(false)
                  setQuery('')
                  openTex(asked)
                }}
              >
                <MessageCircleQuestion className="size-4 text-muted-foreground" aria-hidden />
                <span className="truncate">Preguntale a Tex: «{asked}»</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function CommandPaletteGroup({
  label,
  entries,
  onSelect,
  showSeparator,
}: {
  label: string
  entries: typeof commandEntries
  onSelect: (entry: CommandEntry) => void
  showSeparator: boolean
}) {
  return (
    <>
      {showSeparator ? <CommandSeparator /> : null}
      <CommandGroup heading={label}>
        {entries.map((entry) => {
          const Icon = entry.icon
          return (
            <CommandItem
              key={entry.id}
              value={`${entry.label} ${entry.keywords?.join(' ') ?? ''}`}
              onSelect={() => onSelect(entry)}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <span>{entry.label}</span>
            </CommandItem>
          )
        })}
      </CommandGroup>
    </>
  )
}

function CommandTriggerButton({ onClick }: { onClick: () => void }) {
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl+K')

  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)
    setShortcutLabel(isMac ? '⌘K' : 'Ctrl+K')
  }, [])

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 text-left text-sm text-muted-foreground transition-[colors,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-card hover:border-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">Buscar clientes, páginas, acciones…</span>
      <Kbd>{shortcutLabel}</Kbd>
    </button>
  )
}
