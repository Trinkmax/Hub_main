'use client'

import { Check, UserRoundX } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { type FloorTeamMember, floorTeam } from '@/lib/pos/actions'
import { posFont } from '@/lib/pos/font'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import { cn } from '@/lib/utils'

/**
 * «Pasar la mesa»: elegir quién la atiende. La lista es el equipo que trabaja en esa sucursal (mozos
 * primero). El encargado además puede dejarla sin nadie; a un mozo se le ofrece solo lo que la base le
 * deja hacer (pasar la suya, o tomar una que no tiene a nadie).
 */

type Props = {
  slug: string
  branchId: string
  /** La mesa que se está pasando; `null` = cerrada. */
  table: { sessionId: string; label: string; waiterId: string | null } | null
  /** Quién mira. */
  me: string | null
  /** Solo puede tomarla para sí (un mozo frente a una mesa sin nadie). */
  onlyTake: boolean
  /** Puede dejarla sin nadie (el encargado). */
  canClear: boolean
  busy: boolean
  onPick: (userId: string | null, name: string | null) => void
  onClose: () => void
}

export function PassTableSheet({
  slug,
  branchId,
  table,
  me,
  onlyTake,
  canClear,
  busy,
  onPick,
  onClose,
}: Props) {
  const open = table !== null
  const [team, setTeam] = useState<FloorTeamMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // El equipo se pide al abrir la hoja (no al cargar el mapa) y queda para la próxima.
  useEffect(() => {
    if (!open || team !== null) return
    let stale = false
    setProblem(null)
    void (async () => {
      try {
        const result = await floorTeam(slug, branchId)
        if (stale) return
        if (result.ok) setTeam(result.data)
        else setProblem(result.message)
      } catch {
        if (!stale) setProblem('No hay señal: no pude traer el equipo.')
      }
    })()
    return () => {
      stale = true
    }
  }, [open, team, slug, branchId])
  // Otra sucursal, otro equipo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se vacía al cambiar de sucursal
  useEffect(() => setTeam(null), [branchId])

  const people = (team ?? []).filter((person) => !onlyTake || person.id === me)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet', posFont.variable)}
        data-testid="pass-sheet"
      >
        <SheetGrabber />
        <div className="pos-sheet-body">
          <SheetTitle className="pos-sheet-title">
            ¿Quién atiende la mesa {table?.label}?
          </SheetTitle>
          <SheetDescription className="pos-merge-text">
            A esa persona le llegan los avisos de cocina de esta mesa. A los demás mozos se les
            muestra tomada.
          </SheetDescription>

          {problem ? <p className="pos-team-empty">{problem}</p> : null}
          {team === null && !problem ? <p className="pos-team-empty">Buscando al equipo…</p> : null}
          {team !== null && people.length === 0 ? (
            <p className="pos-team-empty">No hay nadie más que atienda mesas en esta sucursal.</p>
          ) : null}

          <ul className="pos-team">
            {people.map((person) => {
              const current = person.id === table?.waiterId
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    className="pos-team-row"
                    aria-current={current ? 'true' : undefined}
                    disabled={busy || current}
                    onClick={() => onPick(person.id, person.id === me ? null : person.name)}
                    data-testid="pass-pick"
                  >
                    <span className="pos-team-initial" aria-hidden>
                      {(person.name.trim().charAt(0) || '?').toUpperCase()}
                    </span>
                    {person.id === me ? `${person.name} (vos)` : person.name}
                    <em>
                      {current ? (
                        <>
                          <Check aria-hidden className="inline size-4" /> la atiende
                        </>
                      ) : (
                        (ROLE_LABELS[person.role] ?? '')
                      )}
                    </em>
                  </button>
                </li>
              )
            })}
            {canClear && table?.waiterId ? (
              <li>
                <button
                  type="button"
                  className="pos-team-row"
                  disabled={busy}
                  onClick={() => onPick(null, null)}
                  data-testid="pass-clear"
                >
                  <span className="pos-team-initial" aria-hidden>
                    <UserRoundX className="size-4" />
                  </span>
                  <span className="pos-team-two">
                    Dejarla sin mozo
                    <small>La toma quien le cargue un pedido</small>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>

          <div className="pos-merge-actions">
            <button
              type="button"
              className="pos-btn pos-btn-quiet"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
