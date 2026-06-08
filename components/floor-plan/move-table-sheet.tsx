'use client'

import { ArrowRightLeft, Loader2, Users } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { MoveTarget } from '@/lib/floor-plan/queries'
import { loadMoveTargetsAction, moveSessionAction } from '@/lib/sessions-waiter/actions'
import { cn } from '@/lib/utils'

export type MoveTableSheetProps = {
  slug: string
  sessionId: string
  /** Mesa actual (se excluye de los destinos). */
  currentTableId: string | null
  currentLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tras mover con éxito (refrescar / navegar). */
  onMoved: (targetTableId: string) => void
}

/**
 * Selector de "cambio de mesa": lista las mesas libres de TODAS las áreas
 * (cross-área) agrupadas por área; tocar una mueve la sesión ahí (move_session).
 * Compartido por el detalle de sesión (salón) y la vista En vivo (dueño).
 */
export function MoveTableSheet({
  slug,
  sessionId,
  currentTableId,
  currentLabel,
  open,
  onOpenChange,
  onMoved,
}: MoveTableSheetProps) {
  const [targets, setTargets] = useState<MoveTarget[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, startMove] = useTransition()
  const [movingId, setMovingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setTargets(null)
      return
    }
    let active = true
    setLoading(true)
    void loadMoveTargetsAction(slug, currentTableId ?? undefined).then((res) => {
      if (!active) return
      setLoading(false)
      if (res.ok) setTargets(res.targets)
      else {
        toast.error(res.message)
        setTargets([])
      }
    })
    return () => {
      active = false
    }
  }, [open, slug, currentTableId])

  // Agrupar por área (ya viene ordenado por area_pos → label).
  const groups: { area: string; tables: MoveTarget[] }[] = []
  for (const t of targets ?? []) {
    const last = groups[groups.length - 1]
    if (last && last.area === t.area_name) last.tables.push(t)
    else groups.push({ area: t.area_name, tables: [t] })
  }

  const handleMove = (target: MoveTarget) => {
    setMovingId(target.table_id)
    startMove(async () => {
      const r = await moveSessionAction(slug, sessionId, target.table_id)
      setMovingId(null)
      if (r.ok) {
        toast.success(`Mesa cambiada a ${target.label} (${target.area_name}).`)
        onOpenChange(false)
        onMoved(target.table_id)
      } else {
        toast.error(r.message)
        // La mesa destino pudo ocuparse mientras tanto → refrescar la lista.
        void loadMoveTargetsAction(slug, currentTableId ?? undefined).then((res) => {
          if (res.ok) setTargets(res.targets)
        })
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-serif">
            <ArrowRightLeft className="size-4" aria-hidden />
            Cambiar de mesa
          </SheetTitle>
          <SheetDescription>
            {currentLabel ? `Mover el grupo de la mesa ${currentLabel} ` : 'Mover el grupo '}a otra
            mesa libre. Podés cambiar de área (ej. Planta Baja → Planta Alta).
          </SheetDescription>
        </SheetHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Buscando mesas libres…
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No hay otras mesas libres en este momento.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.area} className="space-y-2">
                <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  {g.area}
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.tables.map((t) => (
                    <button
                      key={t.table_id}
                      type="button"
                      disabled={pending}
                      onClick={() => handleMove(t)}
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border border-border/70 bg-card p-2 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                        movingId === t.table_id && 'border-primary bg-primary/10',
                      )}
                    >
                      {movingId === t.table_id ? (
                        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                      ) : (
                        <span className="font-semibold font-serif text-sm tabular-nums">
                          {t.label}
                        </span>
                      )}
                      {t.capacity != null ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                          <Users className="size-2.5" aria-hidden />
                          {t.capacity}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
