'use client'

import { Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { actionHrefFrom } from '@/components/administracion/acciones/types'
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
import { type CommandEntry, commandEntries } from './command-config'
import { useCommandShortcuts } from './use-command-shortcuts'

type CommandPaletteProps = {
  tenantSlug: string
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  /** Administración para esta persona (`access.accounting`). */
  accounting?: AccountingAccess
}

const GROUPS_ORDER = ['Acciones rápidas', 'Administración', 'Operación', 'Ir a'] as const

/** ¿Alcanza el acceso a Administración para esta entrada? (el flag ya viene adentro). */
function accountingOk(entry: CommandEntry, accounting: AccountingAccess): boolean {
  if (!entry.accounting) return true
  if (!accounting.enabled) return false
  if (entry.accounting === 'write') return accounting.write
  if (entry.accounting === 'read') return accounting.read
  return accounting.read || accounting.canSetUp
}

export function CommandPalette({
  tenantSlug,
  role,
  features,
  isPlatformAdmin,
  accounting = NO_ACCOUNTING,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  const toggle = useCallback(() => setOpen((current) => !current), [])
  useCommandShortcuts(toggle)

  const groupedEntries = useMemo(() => {
    const visible = commandEntries.filter((entry) => {
      const roleOk = (entry.roles ?? ['owner']).includes(role)
      // El flag de Administración no se saltea por ser superadmin (lo decide la base).
      const featureOk =
        !entry.feature ||
        (entry.feature !== 'accounting' && isPlatformAdmin) ||
        features[entry.feature]
      return roleOk && featureOk && accountingOk(entry, accounting)
    })
    return GROUPS_ORDER.map((group) => ({
      group,
      items: visible.filter((entry) => entry.group === group),
    })).filter((g) => g.items.length > 0)
  }, [accounting, features, isPlatformAdmin, role])

  const handleSelect = useCallback(
    (entry: CommandEntry) => {
      setOpen(false)
      // Las hojas de Administración se abren sobre la pantalla actual si ya se
      // está en la sección (conservando ?tab=, ?mes=…); si no, sobre el Resumen.
      const href = entry.accountingAction
        ? actionHrefFrom(
            tenantSlug,
            pathname,
            typeof window === 'undefined' ? '' : window.location.search,
            entry.accountingAction,
          )
        : entry.href(tenantSlug)
      router.push(href)
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
        <CommandInput placeholder="Buscar acciones, páginas, clientes…" />
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
