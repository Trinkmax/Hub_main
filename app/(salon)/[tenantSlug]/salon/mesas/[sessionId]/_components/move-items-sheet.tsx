'use client'

import { ArrowRightLeft, Loader2, Users } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { ItemMoveTarget } from '@/lib/floor-plan/queries'
import type { SessionGuestLite } from '@/lib/sessions-waiter/queries'
import {
  loadItemMoveTargetsAction,
  loadSessionGuestsAction,
  moveTicketItemsAction,
} from '@/lib/tickets/actions'
import { cn } from '@/lib/utils'

export type MoveItemsSheetProps = {
  slug: string
  sourceSessionId: string
  /** Ítems seleccionados a mover: id de ticket_item + cantidad. */
  moves: Array<{ ticketItemId: string; quantity: number }>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tras mover con éxito. */
  onMoved: () => void
}

type AssignChoice = 'auto' | 'shared' | string // string = uuid de comensal destino

export function MoveItemsSheet({
  slug,
  sourceSessionId,
  moves,
  open,
  onOpenChange,
  onMoved,
}: MoveItemsSheetProps) {
  const [targets, setTargets] = useState<ItemMoveTarget[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<ItemMoveTarget | null>(null)
  const [destGuests, setDestGuests] = useState<SessionGuestLite[]>([])
  const [assign, setAssign] = useState<AssignChoice>('auto')
  const [pending, startMove] = useTransition()

  // Cargar destinos al abrir.
  useEffect(() => {
    if (!open) {
      setTargets(null)
      setSelectedTarget(null)
      setDestGuests([])
      setAssign('auto')
      return
    }
    let active = true
    setLoading(true)
    void loadItemMoveTargetsAction(slug, sourceSessionId).then((res) => {
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
  }, [open, slug, sourceSessionId])

  // Al elegir una mesa ocupada, cargar sus comensales para reasignación.
  const handleSelectTarget = (t: ItemMoveTarget) => {
    setSelectedTarget(t)
    setAssign('auto')
    setDestGuests([])
    if (t.session) {
      void loadSessionGuestsAction(slug, t.session.id).then((res) => {
        if (res.ok) setDestGuests(res.guests)
      })
    }
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    startMove(async () => {
      const r = await moveTicketItemsAction(slug, {
        sourceSessionId,
        targetTableId: selectedTarget.table_id,
        moves: moves.map((m) => ({ ...m, assign })),
        idempotencyKey: crypto.randomUUID(),
      })
      if (r.ok) {
        toast.success(
          `${r.movedCount} ${r.movedCount === 1 ? 'ítem movido' : 'ítems movidos'} a ${selectedTarget.label}.`,
        )
        onOpenChange(false)
        onMoved()
      } else {
        toast.error(r.message)
      }
    })
  }

  // Agrupar por área (ya viene ordenado por area_pos → label).
  const groups: { area: string; tables: ItemMoveTarget[] }[] = []
  for (const t of targets ?? []) {
    const last = groups[groups.length - 1]
    if (last && last.area === t.area_name) last.tables.push(t)
    else groups.push({ area: t.area_name, tables: [t] })
  }

  const itemCount = moves.reduce((acc, m) => acc + m.quantity, 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-serif">
            <ArrowRightLeft className="size-4" aria-hidden />
            Mover {itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}
          </SheetTitle>
          <SheetDescription>
            Elegí la mesa destino. El ítem mantiene su cliente salvo que reasignes abajo.
          </SheetDescription>
        </SheetHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Buscando mesas…
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No hay otras mesas disponibles.
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
                      onClick={() => handleSelectTarget(t)}
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border border-border/70 bg-card p-2 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                        selectedTarget?.table_id === t.table_id && 'border-primary bg-primary/10',
                        t.session && 'border-amber-300/70',
                      )}
                    >
                      <span className="font-semibold font-serif text-sm tabular-nums">
                        {t.label}
                      </span>
                      {t.session ? (
                        <span className="text-[10px] text-amber-600">ocupada</span>
                      ) : t.capacity != null ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                          <Users className="size-2.5" aria-hidden />
                          {t.capacity}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">libre</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}

          {selectedTarget && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                Asignar a
              </h3>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="assign"
                    className="accent-primary"
                    checked={assign === 'auto'}
                    onChange={() => setAssign('auto')}
                  />
                  Mantener el cliente de cada ítem
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="assign"
                    className="accent-primary"
                    checked={assign === 'shared'}
                    onChange={() => setAssign('shared')}
                  />
                  Para toda la mesa (compartido)
                </label>
                {destGuests.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assign"
                      className="accent-primary"
                      checked={assign === g.id}
                      onChange={() => setAssign(g.id)}
                    />
                    {g.display_name ?? `Comensal #${g.id.slice(0, 4)}`}
                    {g.customer_id ? ' ✓' : ''}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={pending || !selectedTarget}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Moviendo…
              </>
            ) : (
              'Confirmar'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
