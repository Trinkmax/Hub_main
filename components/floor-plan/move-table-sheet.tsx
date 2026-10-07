'use client'

import { ArrowRightLeft, Users } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
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
 * Es el original del panel (vista En vivo del dueño); el salón usa su copia
 * congelada en `components/legacy/floor-plan`.
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
      {/* Abajo en el celular; en escritorio, centrada y con un ancho que se lee. */}
      <SheetContent side="bottom" className="sm:mx-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            Cambiar de mesa
          </SheetTitle>
          <SheetDescription>
            {currentLabel ? `Pasá el grupo de la mesa ${currentLabel} ` : 'Pasá el grupo '}a otra
            mesa libre. Podés cambiar de área (por ejemplo, de Planta baja a Planta alta).
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="max-h-[60vh]" aria-busy={loading || undefined}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 type-body text-muted-foreground">
              <Spinner aria-hidden />
              Buscando mesas libres…
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              size="sm"
              title="No hay otras mesas libres"
              description="Cuando se libere una, va a aparecer acá. También podés liberar una desde el salón."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <div key={g.area} className="flex flex-col gap-2">
                  <h3 className="type-label text-muted-foreground">{g.area}</h3>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                    {g.tables.map((t) => {
                      const moving = movingId === t.table_id
                      return (
                        <button
                          key={t.table_id}
                          type="button"
                          disabled={pending}
                          aria-busy={moving || undefined}
                          aria-label={`Mesa ${t.label}${
                            t.capacity != null ? `, ${t.capacity} personas` : ''
                          }`}
                          onClick={() => handleMove(t)}
                          className={cn(
                            'press flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border border-border-strong bg-card p-2 text-center',
                            'hover:bg-hover',
                            'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                            moving && 'border-primary bg-selected',
                          )}
                        >
                          {moving ? (
                            <Spinner aria-hidden className="text-primary" />
                          ) : (
                            <span className="type-subtitle type-amount">{t.label}</span>
                          )}
                          {t.capacity != null ? (
                            <span className="flex items-center gap-1 type-caption text-muted-foreground tabular-nums">
                              <Users className="size-3.5" aria-hidden />
                              {t.capacity}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
