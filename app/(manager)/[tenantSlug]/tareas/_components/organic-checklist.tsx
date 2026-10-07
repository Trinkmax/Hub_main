'use client'

import { Check, ChevronLeft, ChevronRight, ListChecks, Pencil, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { formatNumber } from '@/lib/format/number-kind'
import { seedSuggestedRoutines, toggleRoutineCheck } from '@/lib/marketing/actions'
import type { RoutineRow } from '@/lib/marketing/queries'
import { formatDayShort, shiftWeeks, weekEndOf } from '@/lib/marketing/week'
import { NBSP } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import { RoutineDialog } from './routine-dialog'

type Toggle = { routineId: string; slot: number; done: boolean }

/** Cuántos casilleros de la rutina están tildados HOY (los de un cupo viejo no cuentan). */
function doneCount(routine: RoutineRow): number {
  return routine.doneSlots.filter((slot) => slot < routine.slots).length
}

export function OrganicChecklist({
  tenantSlug,
  routines,
  weekStart,
  /** Etiqueta resuelta en el server ("Esta semana", "Semana anterior"…): si se
   *  calculara acá, un render a las 23:59 y la hidratación a las 00:00 dirían
   *  cosas distintas. */
  weekTitle,
  isCurrentWeek,
  /** Sube de valor cuando el botón del header pide una rutina nueva. */
  newRoutineNonce = 0,
}: {
  tenantSlug: string
  routines: RoutineRow[]
  weekStart: string
  weekTitle: string
  isCurrentWeek: boolean
  newRoutineNonce?: number
}) {
  const [editing, setEditing] = useState<RoutineRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Cambia en cada apertura: remonta el diálogo para que `useActionState` no
  // arrastre el resultado del guardado anterior.
  const [dialogSession, setDialogSession] = useState(0)

  // Los tildes se pintan al instante: el gesto es "pasar la lista" y esperar
  // el round-trip por cada casillero rompe el ritmo.
  const [optimistic, applyToggle] = useOptimistic(routines, (state, toggle: Toggle) =>
    state.map((routine) =>
      routine.id === toggle.routineId
        ? {
            ...routine,
            doneSlots: toggle.done
              ? [...routine.doneSlots, toggle.slot]
              : routine.doneSlots.filter((slot) => slot !== toggle.slot),
          }
        : routine,
    ),
  )

  const [, startTransition] = useTransition()

  function toggle(routine: RoutineRow, slot: number, done: boolean) {
    startTransition(async () => {
      applyToggle({ routineId: routine.id, slot, done })
      const result = await toggleRoutineCheck(tenantSlug, {
        routineId: routine.id,
        weekStart,
        slot,
        done,
      })
      if (!result.ok) toast.error(result.message)
    })
  }

  const total = optimistic.reduce((acc, routine) => acc + routine.slots, 0)
  const done = optimistic.reduce((acc, routine) => acc + doneCount(routine), 0)
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  function openNew() {
    setEditing(null)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  function openEdit(routine: RoutineRow) {
    setEditing(routine)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  // El botón "Nueva rutina" vive en el header del tablero (componente padre);
  // el diálogo vive acá. El contador es el puente: cada incremento abre el alta.
  const lastNonce = useRef(newRoutineNonce)
  useEffect(() => {
    if (newRoutineNonce !== lastNonce.current) {
      lastNonce.current = newRoutineNonce
      setEditing(null)
      setDialogSession((n) => n + 1)
      setDialogOpen(true)
    }
  }, [newRoutineNonce])

  return (
    <div className="flex flex-col gap-6">
      <WeekBar weekStart={weekStart} weekTitle={weekTitle} isCurrentWeek={isCurrentWeek} />

      {optimistic.length === 0 ? (
        <SuggestedEmptyState tenantSlug={tenantSlug} onCreate={openNew} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="type-small text-muted-foreground">
                <span className="type-label type-amount text-foreground">
                  {done} de {total}
                </span>{' '}
                hechas esta semana
              </p>
              <span className="type-label type-amount text-foreground">
                {formatNumber(percent)}
                {NBSP}%
              </span>
            </div>
            <Progress
              value={percent}
              tone={percent >= 100 ? 'success' : 'brand'}
              label="Avance del checklist de la semana"
              valueText={`${done} de ${total} hechas`}
            />
          </div>

          <ul
            aria-label="Rutinas de la semana"
            className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card"
          >
            {optimistic.map((routine) => {
              // Sólo cuentan los casilleros que HOY existen: si el cupo bajó de
              // 3 a 1, los tildes viejos de los slots 2 y 3 siguen en la DB y
              // marcarían la rutina como completa sin haberla hecho.
              const complete = doneCount(routine) >= routine.slots
              return (
                <li
                  key={routine.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* El título abre la edición. El lápiz siempre se ve: en
                          un celular no hay hover que lo descubra. */}
                      <button
                        type="button"
                        onClick={() => openEdit(routine)}
                        aria-haspopup="dialog"
                        aria-label={`Editar ${routine.title}`}
                        className="hit-area relative inline-flex items-center gap-1.5 rounded-sm text-start type-body font-medium text-foreground underline-offset-2 outline-offset-2 outline-(--ring) hover:underline focus-visible:outline-2"
                      >
                        {routine.title}
                        <Pencil className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
                      </button>
                      {complete ? (
                        <Badge tone="success" icon={Check}>
                          Hecha
                        </Badge>
                      ) : null}
                    </div>
                    {routine.description ? (
                      <p className="mt-1 max-w-prose type-small text-pretty text-muted-foreground">
                        {routine.description}
                      </p>
                    ) : null}
                  </div>

                  {/* fieldset + legend: el grupo de casilleros se anuncia con el
                      nombre de la rutina. El flex va en un div adentro (en
                      algunos Safari un fieldset no arma flex). */}
                  <fieldset className="min-w-0 shrink-0">
                    <legend className="sr-only">Veces hechas de {routine.title}</legend>
                    <div className="flex flex-wrap items-center gap-2">
                      {Array.from({ length: routine.slots }, (_, index) => index).map((slot) => {
                        const checked = routine.doneSlots.includes(slot)
                        return (
                          <button
                            key={`${routine.id}-${slot}`}
                            type="button"
                            onClick={() => toggle(routine, slot, !checked)}
                            aria-pressed={checked}
                            aria-label={`${routine.title}: vez ${slot + 1} de ${routine.slots}`}
                            className={cn(
                              'press inline-flex size-9 items-center justify-center rounded-full border type-label type-amount pointer-coarse:size-11',
                              'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                              // Tildado: relleno verde (lo elegido de una grilla, §3.0) y
                              // además el check, así no depende solo del color.
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input bg-card text-muted-foreground hover:bg-hover hover:text-foreground',
                            )}
                          >
                            {checked ? (
                              <Check className="size-4" aria-hidden />
                            ) : (
                              <span aria-hidden>{slot + 1}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                </li>
              )
            })}
          </ul>

          <div>
            <Button variant="secondary" onClick={openNew} className="w-full sm:w-auto">
              <Plus aria-hidden />
              Sumar una rutina
            </Button>
          </div>
        </>
      )}

      <RoutineDialog
        key={dialogSession}
        tenantSlug={tenantSlug}
        routine={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}

function WeekBar({
  weekStart,
  weekTitle,
  isCurrentWeek,
}: {
  weekStart: string
  weekTitle: string
  isCurrentWeek: boolean
}) {
  // La semana viaja por la URL (no por estado) para que el server traiga los
  // tildes de esa semana. Los links mantienen `?seccion=organico` para volver
  // a la misma pestaña después de la navegación.
  const hrefFor = (offset: number) =>
    `?seccion=organico&semana=${shiftWeeks(weekStart, offset)}` as const

  return (
    <nav aria-label="Semana del checklist" className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="secondary" size="icon" aria-label="Semana anterior">
          <Link href={hrefFor(-1)} scroll={false}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="secondary" size="icon" aria-label="Semana siguiente">
          <Link href={hrefFor(1)} scroll={false}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      <div className="min-w-0">
        <p className="type-subtitle text-foreground">{weekTitle}</p>
        <p className="type-small type-amount text-muted-foreground">
          {formatDayShort(weekStart)} – {formatDayShort(weekEndOf(weekStart))}
        </p>
      </div>

      {isCurrentWeek ? null : (
        <Button asChild variant="ghost" size="sm" className="ms-auto">
          <Link href="?seccion=organico" scroll={false}>
            Volver a esta semana
          </Link>
        </Button>
      )}
    </nav>
  )
}

function SuggestedEmptyState({
  tenantSlug,
  onCreate,
}: {
  tenantSlug: string
  onCreate: () => void
}) {
  const [pending, startTransition] = useTransition()

  return (
    <EmptyState
      icon={ListChecks}
      title="Todavía no hay checklist semanal"
      description="Son las cosas que se repiten todas las semanas (historias, reels, el mensaje al canal). Se reinician solas cada lunes."
      secondaryAction={
        <Button variant="secondary" onClick={onCreate}>
          <Plus aria-hidden />
          Crear la primera
        </Button>
      }
      action={
        <Button
          loading={pending}
          loadingText="Cargando…"
          onClick={() =>
            startTransition(async () => {
              const result = await seedSuggestedRoutines(tenantSlug)
              if (result.ok) toast.success('Listo, ya tenés el checklist base.')
              else toast.error(result.message)
            })
          }
        >
          <Sparkles aria-hidden />
          Cargar checklist sugerido
        </Button>
      }
    />
  )
}
