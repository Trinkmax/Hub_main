'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { commandEntries } from './command-config'
import { useCommandShortcuts } from './use-command-shortcuts'

type CommandPaletteProps = {
  tenantSlug: string
}

const GROUPS_ORDER = ['Acciones rápidas', 'Operación', 'Ir a'] as const

export function CommandPalette({ tenantSlug }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const toggle = useCallback(() => setOpen((current) => !current), [])
  useCommandShortcuts(toggle)

  const groupedEntries = useMemo(() => {
    return GROUPS_ORDER.map((group) => ({
      group,
      items: commandEntries.filter((entry) => entry.group === group),
    })).filter((g) => g.items.length > 0)
  }, [])

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
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
        <CommandInput placeholder="Buscar acciones, páginas, clientes…" />
        <CommandList>
          <CommandEmpty>No encontramos nada que coincida.</CommandEmpty>
          {groupedEntries.map((g, index) => (
            <CommandPaletteGroup
              key={g.group}
              label={g.group}
              entries={g.items}
              tenantSlug={tenantSlug}
              onSelect={handleSelect}
              showSeparator={index > 0}
            />
          ))}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function CommandPaletteGroup({
  label,
  entries,
  tenantSlug,
  onSelect,
  showSeparator,
}: {
  label: string
  entries: typeof commandEntries
  tenantSlug: string
  onSelect: (href: string) => void
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
              onSelect={() => onSelect(entry.href(tenantSlug))}
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
