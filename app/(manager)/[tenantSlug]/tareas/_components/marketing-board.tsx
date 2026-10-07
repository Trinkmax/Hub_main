'use client'

import { ClipboardList, Plus, SearchX } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTableToolbar } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsCountClasses } from '@/components/ui/tabs'
import { setMarketingTaskStatus } from '@/lib/marketing/actions'
import {
  BOARD_VIEWS,
  type BoardView,
  isBoardView,
  isTaskCategory,
  MINE_MODE_LABELS,
  MINE_MODES,
  type MineMode,
  type TaskStatus,
  VIEW_LABELS,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow, RoutineRow, TeamMember } from '@/lib/marketing/queries'
import { DATE_BUCKETS, type DateBucket, dateBucket } from '@/lib/marketing/week'
import { OrganicChecklist } from './organic-checklist'
import { TaskDialog } from './task-dialog'
import { type TaskGroup, TaskList } from './task-list'

/** Saca tildes para que "grabacion" encuentre "grabación". */
function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const MINE_MODE_ITEMS = MINE_MODES.map((mode) => ({ value: mode, label: MINE_MODE_LABELS[mode] }))

const VIEW_DESCRIPTIONS: Record<BoardView, string> = {
  eventos: 'Lo que hay que hacer para los eventos, ordenado por fecha. Lo ven todos los socios.',
  promociones:
    'Lo que hay que hacer para las promociones, ordenado por fecha. Lo ven todos los socios.',
  impresiones: 'Lo que hay que mandar a imprimir, ordenado por fecha. Lo ven todos los socios.',
  organico: 'El checklist que se repite todas las semanas. Se reinicia solo cada lunes.',
  mias: 'Lo que tiene cada uno: como responsable o como parte del equipo.',
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

  // Estado optimista del cambio de estado desde la lista: la etiqueta tiene que
  // pintarse sola, sin esperar el round-trip ni el revalidate.
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

  const groups = useMemo<TaskGroup[]>(() => {
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
  // override del segundo (que seguía en vuelo) y la etiqueta parpadeaba al
  // estado intermedio.
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
  const trimmedSearch = search.trim()
  const minePersonName = minePerson === currentUserId ? 'vos' : (nameById.get(minePerson) ?? null)

  // El vacío dice por qué no hay nada y qué hacer: la búsqueda no encontró, la
  // persona no tiene tareas, o la sección todavía está vacía.
  const empty =
    query.length > 0 ? (
      <EmptyState
        size="sm"
        icon={SearchX}
        title={`No encontramos tareas con «${trimmedSearch}»`}
        description="Probá con otra palabra o limpiá el buscador para ver todo."
        action={
          <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
            Limpiar búsqueda
          </Button>
        }
      />
    ) : view === 'mias' ? (
      <EmptyState
        size="sm"
        icon={ClipboardList}
        title={
          minePersonName ? `No hay tareas para ${minePersonName}` : 'Elegí a alguien del equipo'
        }
        description={
          minePersonName
            ? 'Cuando le asignen una, como responsable o como parte del equipo, aparece acá.'
            : 'Arriba elegís de quién querés ver las tareas.'
        }
      />
    ) : (
      <EmptyState
        size="sm"
        icon={ClipboardList}
        title={`Todavía no hay tareas en ${VIEW_LABELS[view]}`}
        description="Cargá la primera y queda a la vista de todo el equipo."
        action={
          <Button size="sm" onClick={openNew}>
            <Plus aria-hidden />
            Nueva tarea
          </Button>
        }
      />
    )

  const body = isOrganic ? (
    <OrganicChecklist
      tenantSlug={tenantSlug}
      routines={routines}
      weekStart={weekStart}
      weekTitle={weekTitle}
      isCurrentWeek={isCurrentWeek}
      newRoutineNonce={newRoutineNonce}
    />
  ) : (
    <div className="flex flex-col gap-3">
      <DataTableToolbar>
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder="Buscar tareas…"
          aria-label="Buscar tareas"
        />
        {view === 'mias' ? (
          <>
            <Select value={minePerson} onValueChange={setMinePerson}>
              <SelectTrigger aria-label="De quién" className="w-full sm:w-48">
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
            <SegmentedControl
              aria-label="Rol en la tarea"
              items={MINE_MODE_ITEMS}
              value={mineMode}
              onValueChange={setMineMode}
            />
          </>
        ) : null}
        <p role="status" className="ms-auto type-small text-muted-foreground">
          <span className="type-amount">{visible.length}</span>{' '}
          {visible.length === 1 ? 'tarea' : 'tareas'}
        </p>
      </DataTableToolbar>

      <TaskList
        caption={
          view === 'mias' ? 'Tareas de la persona elegida' : `Tareas de ${VIEW_LABELS[view]}`
        }
        groups={groups}
        collapsed={collapsed}
        onToggleGroup={(bucket) => setCollapsed((prev) => ({ ...prev, [bucket]: !prev[bucket] }))}
        nameFor={nameFor}
        onEdit={openEdit}
        onStatusChange={changeStatus}
        empty={empty}
      />
    </div>
  )

  return (
    <>
      {/* Las secciones del tablero son pestañas con la URL (`?seccion=`): el
          link se puede copiar y el server arranca en la que corresponde. */}
      <Tabs
        value={view}
        defaultValue={initialView}
        onValueChange={(next) => {
          if (isBoardView(next)) setView(next)
        }}
        syncParam="seccion"
        className="gap-6"
      >
        <PageHeader
          title="Tareas de marketing"
          description={VIEW_DESCRIPTIONS[view]}
          actions={
            isOrganic ? (
              // En Orgánico "Nueva tarea" crearía algo que no se ve desde acá:
              // la acción de esta solapa es sumar una rutina.
              <Button onClick={() => setNewRoutineNonce((n) => n + 1)}>
                <Plus aria-hidden />
                Nueva rutina
              </Button>
            ) : (
              <Button onClick={openNew}>
                <Plus aria-hidden />
                Nueva tarea
              </Button>
            )
          }
          tabs={
            <TabsList aria-label="Secciones del tablero">
              {BOARD_VIEWS.map((value) => {
                const open = isTaskCategory(value) ? (openCount[value] ?? 0) : 0
                return (
                  <TabsTrigger key={value} value={value}>
                    {VIEW_LABELS[value]}
                    {open > 0 ? (
                      <span className={tabsCountClasses}>
                        {open}
                        <span className="sr-only"> {open === 1 ? 'abierta' : 'abiertas'}</span>
                      </span>
                    ) : null}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          }
        />

        {BOARD_VIEWS.map((value) => (
          <TabsContent key={value} value={value}>
            {value === view ? body : null}
          </TabsContent>
        ))}
      </Tabs>

      <TaskDialog
        key={dialogSession}
        tenantSlug={tenantSlug}
        team={team}
        task={editing}
        defaultCategory={isTaskCategory(view) ? view : 'eventos'}
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
