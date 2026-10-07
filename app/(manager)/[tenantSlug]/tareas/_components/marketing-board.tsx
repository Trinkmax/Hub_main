'use client'

import { ChevronDown, ChevronRight, ClipboardList, Plus, Search, X } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import { setMarketingTaskStatus } from '@/lib/marketing/actions'
import {
  BOARD_VIEWS,
  type BoardView,
  isTaskCategory,
  MINE_MODE_LABELS,
  MINE_MODES,
  type MineMode,
  type TaskCategory,
  type TaskStatus,
  VIEW_LABELS,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow, RoutineRow, TeamMember } from '@/lib/marketing/queries'
import { BUCKET_LABELS, DATE_BUCKETS, type DateBucket, dateBucket } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'
import { OrganicChecklist } from './organic-checklist'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'

/** Saca tildes para que "grabacion" encuentre "grabación". */
function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function MarketingBoard({
  tenantSlug,
  tasks,
  team,
  routines,
  currentUserId,
  today,
  weekStart,
  weekTitle,
  isCurrentWeek,
  initialView,
}: {
  tenantSlug: string
  tasks: MarketingTaskRow[]
  team: TeamMember[]
  routines: RoutineRow[]
  currentUserId: string
  /** Hoy en el reloj del bar, resuelto en el server (evita mismatch de hidratación). */
  today: string
  weekStart: string
  weekTitle: string
  isCurrentWeek: boolean
  initialView: BoardView
}) {
  const [view, setView] = useState<BoardView>(initialView)
  const [search, setSearch] = useState('')
  const [minePerson, setMinePerson] = useState<string>(
    () => team.find((m) => m.id === currentUserId)?.id ?? team[0]?.id ?? '',
  )
  const [mineMode, setMineMode] = useState<MineMode>('both')
  const [collapsed, setCollapsed] = useState<Partial<Record<DateBucket, boolean>>>({})

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MarketingTaskRow | null>(null)
  // Cambia en cada apertura para remontar el diálogo: así `useActionState`
  // vuelve a INITIAL y no arrastra el resultado del guardado anterior.
  const [dialogSession, setDialogSession] = useState(0)
  // Pedido de "nueva rutina" disparado desde el header, que vive acá pero cuyo
  // diálogo vive adentro del checklist.
  const [newRoutineNonce, setNewRoutineNonce] = useState(0)

  // Estado optimista del cambio de estado desde la tarjeta: el select tiene que
  // pintarse solo, sin esperar el round-trip ni el revalidate.
  const [pendingStatus, setPendingStatus] = useState<Record<string, TaskStatus>>({})
  const [, startTransition] = useTransition()

  const resolved = useMemo(
    () => tasks.map((task) => ({ ...task, status: pendingStatus[task.id] ?? task.status })),
    [tasks, pendingStatus],
  )

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of team) map.set(member.id, member.name)
    return map
  }, [team])

  const nameFor = (userId: string | null) => (userId ? (nameById.get(userId) ?? null) : null)

  const query = normalize(search.trim())

  const visible = useMemo(() => {
    const matchesSearch = (task: MarketingTaskRow) =>
      query.length === 0 ||
      normalize([task.title, task.specifications ?? '', task.notes ?? ''].join(' ')).includes(query)

    return resolved.filter((task) => {
      if (!matchesSearch(task)) return false
      if (view === 'mias') {
        if (!minePerson) return false
        if (mineMode === 'responsible') return task.responsibleId === minePerson
        if (mineMode === 'involved') return task.involvedId === minePerson
        return task.responsibleId === minePerson || task.involvedId === minePerson
      }
      if (view === 'organico') return false
      return task.category === view
    })
  }, [resolved, view, query, minePerson, mineMode])

  const groups = useMemo(() => {
    const byBucket = new Map<DateBucket, MarketingTaskRow[]>()
    for (const task of visible) {
      const bucket = dateBucket(task.definedDate ?? task.idealDate, today)
      const list = byBucket.get(bucket)
      if (list) list.push(task)
      else byBucket.set(bucket, [task])
    }
    return DATE_BUCKETS.map((bucket) => ({
      bucket,
      items: (byBucket.get(bucket) ?? []).sort((a, b) => {
        const aDate = a.definedDate ?? a.idealDate ?? '9999-12-31'
        const bDate = b.definedDate ?? b.idealDate ?? '9999-12-31'
        return aDate.localeCompare(bDate)
      }),
    })).filter((group) => group.items.length > 0)
  }, [visible, today])

  const openCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const task of resolved) {
      if (task.status === 'done') continue
      counts[task.category] = (counts[task.category] ?? 0) + 1
    }
    return counts
  }, [resolved])

  function openNew() {
    setEditing(null)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  function openEdit(task: MarketingTaskRow) {
    setEditing(task)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  // Sólo suelta el override si sigue siendo EL NUESTRO: con dos cambios
  // encadenados sobre la misma tarea, la respuesta del primero borraba el
  // override del segundo (que seguía en vuelo) y el chip parpadeaba al estado
  // intermedio.
  function forgetPending(id: string, status: TaskStatus) {
    setPendingStatus((prev) => {
      if (prev[id] !== status) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function changeStatus(task: MarketingTaskRow, status: TaskStatus) {
    setPendingStatus((prev) => ({ ...prev, [task.id]: status }))
    startTransition(async () => {
      const result = await setMarketingTaskStatus(tenantSlug, { id: task.id, status })
      // El override local se suelta en los dos casos: si salió bien porque el
      // revalidate ya trajo el valor bueno, y si falló para volver atrás. Si
      // quedara pegado, taparía el cambio que haga otro socio después.
      forgetPending(task.id, status)
      if (!result.ok) toast.error(result.message)
    })
  }

  const isOrganic = view === 'organico'

  const description =
    view === 'organico'
      ? 'El checklist que se repite todas las semanas. Se reinicia solo cada lunes.'
      : view === 'mias'
        ? 'Lo que tiene cada uno: como responsable o como parte del equipo.'
        : `${visible.length} ${visible.length === 1 ? 'tarea' : 'tareas'} en esta sección. Los cambios los ven todos los socios.`

  return (
    <>
      <PageHeader
        eyebrow="Organización de contenido"
        title="Tareas de marketing"
        description={description}
        actions={
          isOrganic ? (
            // En Orgánico el buscador no tendría qué filtrar y "Nueva tarea"
            // crearía algo que no se ve desde acá: la acción de esta solapa es
            // sumar una rutina.
            <Button onClick={() => setNewRoutineNonce((n) => n + 1)}>
              <Plus className="size-4" aria-hidden />
              Nueva rutina
            </Button>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar tareas…"
                  aria-label="Buscar tareas"
                  className="w-full pl-8 sm:w-56"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <Button onClick={openNew}>
                <Plus className="size-4" aria-hidden />
                Nueva tarea
              </Button>
            </>
          )
        }
      />

      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <SlidingTabs
          value={view}
          onChange={setView}
          tabs={BOARD_VIEWS.map((value) => ({
            value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {VIEW_LABELS[value]}
                {isTaskCategory(value) && (openCount[value] ?? 0) > 0 ? (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
                    {openCount[value]}
                  </span>
                ) : null}
              </span>
            ),
          }))}
        />
      </div>

      {isOrganic ? (
        <OrganicChecklist
          tenantSlug={tenantSlug}
          routines={routines}
          weekStart={weekStart}
          weekTitle={weekTitle}
          isCurrentWeek={isCurrentWeek}
          newRoutineNonce={newRoutineNonce}
        />
      ) : (
        <div className="space-y-4">
          {view === 'mias' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 p-2">
              <Select value={minePerson} onValueChange={setMinePerson}>
                <SelectTrigger className="w-full bg-card sm:w-48" aria-label="Persona">
                  <SelectValue placeholder="Elegí a alguien" />
                </SelectTrigger>
                <SelectContent>
                  {team.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                      {member.id === currentUserId ? ' (vos)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={mineMode} onValueChange={(value) => setMineMode(value as MineMode)}>
                <SelectTrigger className="w-full bg-card sm:w-44" aria-label="Rol en la tarea">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {MINE_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="px-1 text-sm font-medium tabular-nums text-muted-foreground">
                {visible.length} {visible.length === 1 ? 'tarea' : 'tareas'}
              </span>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={search ? 'No encontramos nada' : 'No hay tareas para mostrar'}
              description={
                search
                  ? 'Probá con otra palabra o limpiá el buscador.'
                  : 'Cargá la primera y queda a la vista de todo el equipo.'
              }
              action={
                search ? (
                  <Button variant="outline" onClick={() => setSearch('')}>
                    Limpiar búsqueda
                  </Button>
                ) : (
                  <Button onClick={openNew}>
                    <Plus className="size-4" aria-hidden />
                    Nueva tarea
                  </Button>
                )
              }
            />
          ) : (
            groups.map((group) => {
              const isOpen = !collapsed[group.bucket]
              return (
                <section key={group.bucket} className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [group.bucket]: !prev[group.bucket] }))
                    }
                    className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5" aria-hidden />
                    )}
                    <span>{BUCKET_LABELS[group.bucket]}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[11px] tabular-nums',
                        group.bucket === 'past'
                          ? 'bg-warning/15 text-warning'
                          : 'bg-secondary text-secondary-foreground',
                      )}
                    >
                      {group.items.length}
                    </span>
                  </button>

                  {isOpen ? (
                    <ul className="space-y-2">
                      {group.items.map((task) => (
                        <li key={task.id}>
                          <TaskCard
                            task={task}
                            nameFor={nameFor}
                            onEdit={openEdit}
                            onStatusChange={changeStatus}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              )
            })
          )}
        </div>
      )}

      <TaskDialog
        key={dialogSession}
        tenantSlug={tenantSlug}
        team={team}
        task={editing}
        defaultCategory={(isTaskCategory(view) ? view : 'eventos') as TaskCategory}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        // Si la tarea se creó desde "Mis tareas", la sección elegida es la
        // única pantalla donde va a aparecer: llevamos ahí en vez de dejar al
        // dueño buscándola.
        onSaved={(category) => {
          if (view !== category && !isTaskCategory(view)) setView(category)
        }}
      />
    </>
  )
}
