'use client'

import { Coins, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format/number-kind'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import { formatCents } from '@/lib/money/format'
import { deleteRule, toggleRule } from '@/lib/points/actions'
import type { PointsRule } from '@/lib/points/types'
import { cn } from '@/lib/utils'

export function RulesList({
  tenantSlug,
  rules,
  menu,
}: {
  tenantSlug: string
  rules: PointsRule[]
  menu: { items: MenuItem[]; categories: MenuCategory[] }
}) {
  const [, start] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<PointsRule | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const describe = (rule: PointsRule): string => {
    if (rule.type === 'per_amount') {
      const cfg = rule.config as { every_cents: number; points: number }
      const every = formatCents(cfg.every_cents, {
        decimals: cfg.every_cents % 100 === 0 ? 0 : 2,
      })
      return `Cada ${every} gastados → ${formatNumber(cfg.points)} pts`
    }
    const cfg = rule.config as Record<string, unknown>
    const points = typeof cfg.points === 'number' ? formatNumber(cfg.points) : '—'
    if (typeof cfg.item_id === 'string') {
      const item = menu.items.find((i) => i.id === cfg.item_id)
      return `Ítem «${item?.name ?? 'borrado'}» → ${points} pts`
    }
    if (typeof cfg.category_id === 'string') {
      const label = categoryPathLabel(menu.categories, cfg.category_id)
      return `Categoría «${label || 'borrada'}» → ${points} pts por ítem`
    }
    return 'Regla desconocida'
  }

  const onToggle = (rule: PointsRule) => {
    setTogglingId(rule.id)
    start(async () => {
      const r = await toggleRule(tenantSlug, rule.id, !rule.active)
      if (!r.ok) toast.error(r.message)
      setTogglingId(null)
    })
  }

  return (
    <>
      <DataTable
        caption="Reglas de puntos"
        rows={rules}
        getRowId={(r) => r.id}
        empty={
          <EmptyState
            size="sm"
            icon={Coins}
            title="Sin reglas todavía"
            description="Creá una regla arriba para que tus clientes sumen puntos cada vez que se cierra su mesa."
          />
        }
        columns={[
          {
            id: 'regla',
            header: 'Regla',
            cell: (r) => (
              <span className={cn(!r.active && 'text-muted-foreground')}>{describe(r)}</span>
            ),
          },
          {
            id: 'prioridad',
            header: 'Prioridad',
            numeric: true,
            width: '7rem',
            mobile: 'meta',
            cell: (r) => <span className="text-muted-foreground">{formatNumber(r.priority)}</span>,
          },
          {
            id: 'activa',
            header: 'Activa',
            width: '6rem',
            mobile: 'value',
            cell: (r) => (
              <Switch
                checked={r.active}
                onCheckedChange={() => onToggle(r)}
                pending={togglingId === r.id}
                disabled={togglingId === r.id}
                aria-label={`Regla activa: ${describe(r)}`}
              />
            ),
          },
          {
            id: 'acciones',
            header: 'Acciones',
            headerHidden: true,
            align: 'end',
            width: '3.5rem',
            cell: (r) => (
              <Button
                size="icon-sm"
                variant="danger-ghost"
                onClick={() => {
                  setToDelete(r)
                  setDeleteOpen(true)
                }}
                aria-label={`Borrar la regla: ${describe(r)}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title="¿Borrar esta regla?"
        description={
          toDelete
            ? `«${describe(toDelete)}» deja de dar puntos desde hoy. Los puntos ya dados no se tocan.`
            : undefined
        }
        confirmLabel="Borrar regla"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const r = await deleteRule(tenantSlug, toDelete.id)
          if (!r.ok) return r
        }}
      />
    </>
  )
}
