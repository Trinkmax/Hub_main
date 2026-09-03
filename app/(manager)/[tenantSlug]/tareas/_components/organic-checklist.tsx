'use client'

import { Check, ChevronLeft, ChevronRight, ListChecks, Pencil, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { seedSuggestedRoutines, toggleRoutineCheck } from '@/lib/marketing/actions'
import type { RoutineRow } from '@/lib/marketing/queries'
import { formatDayShort, shiftWeeks, weekEndOf } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'
import { RoutineDialog } from './routine-dialog'

type Toggle = { routineId: string; slot: number; done: boolean }

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
  const done = optimistic.reduce(
    (acc, routine) => acc + routine.doneSlots.filter((slot) => slot < routine.slots).length,
    0,
  )
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
    <div className="space-y-4">
      <WeekBar weekStart={weekStart} weekTitle={weekTitle} isCurrentWeek={isCurrentWeek} />

      {optimistic.length === 0 ? (
        <SuggestedEmptyState tenantSlug={tenantSlug} onCreate={openNew} />
      ) : (
        <>
          <div className="card-hairline flex items-center gap-4 rounded-xl border bg-card p-4">
            <div className="shrink-0">
              <p className="font-serif text-2xl font-semibold leading-none tracking-tight">
                {done}
                <span className="text-muted-foreground"> de {total}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">completadas esta semana</p>
            </div>
            <Progress value={percent} className="h-2 flex-1" />
            <span className="w-10 shrink-0 text-right font-medium tabular-nums">{percent}%</span>
          </div>

          <ul className="space-y-2">
            {optimistic.map((routine) => {
              // Sólo cuentan los casilleros que HOY existen: si el cupo bajó de
              // 3 a 1, los tildes viejos de los slots 2 y 3 siguen en la DB y
              // marcarían la rutina como completa sin haberla hecho.
              const complete =
                routine.doneSlots.filter((slot) => slot < routine.slots).length >= routine.slots
              return (
                <li
                  key={routine.id}
                  className={cn(
                    'card-hairline group flex flex-col gap-3 rounded-xl border bg-card p-4',
                    'sm:flex-row sm:items-center sm:justify-between',
                    complete && 'border-success/30 bg-success/5',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {/* El título abre la edición, igual que en las tarjetas de
                          tarea: en un celular `group-hover` nunca se aplica
                          (Tailwind lo envuelve en `@media (hover: hover)`), así
                          que el lápiz solo no alcanzaba como único camino. */}
                      <button
                        type="button"
                        onClick={() => openEdit(routine)}
                        className="rounded-sm text-left font-medium leading-snug tracking-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {routine.title}
                      </button>
                      <span
                        aria-hidden
                        className="rounded-md p-2 text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </span>
                    </div>
                    {routine.description ? (
                      <p className="mt-1 text-sm text-muted-foreground text-pretty">
                        {routine.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {Array.from({ length: routine.slots }, (_, index) => index).map((slot) => {
                      const checked = routine.doneSlots.includes(slot)
                      return (
                        <button
                          key={`${routine.id}-${slot}`}
                          type="button"
                          onClick={() => toggle(routine, slot, !checked)}
                          aria-pressed={checked}
                          aria-label={`${routine.title} — ${slot + 1} de ${routine.slots}`}
                          className={cn(
                            'inline-flex size-9 items-center justify-center rounded-full border text-sm font-medium',
                            'transition-[background-color,color,transform] duration-[var(--duration-fast)] active:scale-95',
                            'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            checked
                              ? 'border-transparent bg-success text-success-foreground'
                              : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:bg-cream-tint',
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
                </li>
              )
            })}
          </ul>

          <Button variant="outline" onClick={openNew} className="w-full sm:w-auto">
            <Plus className="size-4" aria-hidden />
            Sumar una rutina
          </Button>
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
  // a la misma solapa después de la navegación.
  const hrefFor = (offset: number) =>
    `?seccion=organico&semana=${shiftWeeks(weekStart, offset)}` as const

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 p-2">
      <Button asChild variant="ghost" size="icon" aria-label="Semana anterior">
        <Link href={hrefFor(-1)} scroll={false}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      </Button>

      <div className="text-center">
        <p className="text-sm font-medium leading-tight">{weekTitle}</p>
        <p className="text-xs text-muted-foreground">
          {formatDayShort(weekStart)} — {formatDayShort(weekEndOf(weekStart))}
        </p>
      </div>

      <div className="flex items-center gap-1">
        {isCurrentWeek ? null : (
          <Button asChild variant="ghost" size="sm">
            <Link href="?seccion=organico" scroll={false}>
              Hoy
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="icon" aria-label="Semana siguiente">
          <Link href={hrefFor(1)} scroll={false}>
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
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
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await seedSuggestedRoutines(tenantSlug)
                if (result.ok) toast.success('Listo, ya tenés el checklist base.')
                else toast.error(result.message)
              })
            }
          >
            <Sparkles className="size-4" aria-hidden />
            {pending ? 'Cargando…' : 'Cargar checklist sugerido'}
          </Button>
          <Button variant="outline" onClick={onCreate}>
            <Plus className="size-4" aria-hidden />
            Crear la primera
          </Button>
        </div>
      }
    />
  )
}
