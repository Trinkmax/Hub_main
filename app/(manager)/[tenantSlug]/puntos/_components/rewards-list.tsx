'use client'

import { Gift, Pause, Play, Trash2 } from 'lucide-react'
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
import { deleteReward, updateReward } from '@/lib/points/actions'
import type { Reward } from '@/lib/points/queries'

export function RewardsList({ tenantSlug, rewards }: { tenantSlug: string; rewards: Reward[] }) {
  const [, start] = useTransition()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const onToggle = (r: Reward) => {
    start(async () => {
      const result = await updateReward(tenantSlug, {
        id: r.id,
        name: r.name,
        description: r.description,
        cost_points: r.cost_points,
        stock: r.stock,
        active: !r.active,
      })
      if (!result.ok) toast.error(result.message)
    })
  }

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const id = pendingDelete
    start(async () => {
      const result = await deleteReward(tenantSlug, id)
      if (!result.ok) toast.error(result.message)
      setPendingDelete(null)
    })
  }

  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="Sin recompensas"
        description="Creá una recompensa arriba para que tus clientes empiecen a canjear sus puntos."
      />
    )
  }

  return (
    <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
      {rewards.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
          {r.active ? (
            <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
              Activa
            </Badge>
          ) : (
            <Badge variant="outline">Pausada</Badge>
          )}
          <span className="flex-1 truncate font-medium">{r.name}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
            {r.cost_points} pts
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            stock: {r.stock === null ? '∞' : r.stock}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => onToggle(r)}
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
            <AlertDialogTitle>¿Borrar esta recompensa?</AlertDialogTitle>
            <AlertDialogDescription>
              Los clientes ya no podrán canjearla. Esta acción no se puede deshacer.
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
