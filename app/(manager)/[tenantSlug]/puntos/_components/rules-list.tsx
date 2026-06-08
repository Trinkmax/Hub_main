'use client'

import { Pause, Play, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { deleteRule, toggleRule } from '@/lib/points/actions'
import type { PointsRule } from '@/lib/points/types'

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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const describe = (rule: PointsRule): string => {
    if (rule.type === 'per_amount') {
      const cfg = rule.config as { every_cents: number; points: number }
      return `Cada $${(cfg.every_cents / 100).toLocaleString('es-AR')} → ${cfg.points} pts`
    }
    const cfg = rule.config as Record<string, unknown>
    if (typeof cfg.item_id === 'string') {
      const item = menu.items.find((i) => i.id === cfg.item_id)
      return `Ítem "${item?.name ?? '???'}" → ${cfg.points as number} pts`
    }
    if (typeof cfg.category_id === 'string') {
      const cat = menu.categories.find((c) => c.id === cfg.category_id)
      return `Cat "${cat?.name ?? '???'}" → ${cfg.points as number} pts c/u`
    }
    return 'Regla desconocida'
  }

  const onToggle = (id: string, current: boolean) => {
    start(async () => {
      const r = await toggleRule(tenantSlug, id, !current)
      if (!r.ok) toast.error(r.message)
    })
  }

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const id = pendingDelete
    start(async () => {
      const r = await deleteRule(tenantSlug, id)
      if (!r.ok) toast.error(r.message)
      setPendingDelete(null)
    })
  }

  if (rules.length === 0) {
    return (
      <EmptyState
        title="Sin reglas configuradas"
        description="Creá una regla arriba para empezar a otorgar puntos cada vez que se cierre una mesa."
      />
    )
  }

  return (
    <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
          {r.active ? (
            <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
              Activa
            </Badge>
          ) : (
            <Badge variant="outline">Pausada</Badge>
          )}
          <span className="flex-1 truncate">{describe(r)}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
            prio {r.priority}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => onToggle(r.id, r.active)}
            aria-label={r.active ? 'Pausar' : 'Activar'}
          >
            {r.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={() => setPendingDelete(r.id)}
            aria-label="Borrar"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta regla?</AlertDialogTitle>
            <AlertDialogDescription>
              La regla dejará de otorgar puntos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmDelete}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
