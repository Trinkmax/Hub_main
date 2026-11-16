'use client'

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  createGroup as createGroupAction,
  createTask as createTaskAction,
  deleteGroup as deleteGroupAction,
  deleteTask as deleteTaskAction,
  reorderGroups as reorderGroupsAction,
  reorderTasks as reorderTasksAction,
  setTaskPeople as setTaskPeopleAction,
  updateGroup as updateGroupAction,
  updateTask as updateTaskAction,
} from '@/lib/marketing/actions'
import {
  type BoardGroup,
  type BoardTask,
  buildBoard,
  newTaskPosition,
  openCountByPerson,
  type TeamMember,
} from '@/lib/marketing/board'
import type { GroupColor, TaskPersonRole, TaskStatus, TaskView } from '@/lib/marketing/constants'
import type { RoutineRow } from '@/lib/marketing/queries'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { type BoardContextValue, BoardProvider } from './board-context'
import { BoardToolbar } from './board-toolbar'
import { DoneSection } from './done-section'
import { GroupSection } from './group-section'
import { GroupsEmpty, NewGroupInline } from './groups-empty'
import { CONNECTION_ERROR } from './guard'
import { OrganicChecklist } from './organic-checklist'
import { type PanelTab, TaskPanel } from './task-panel'

// ──────────────────────────────────────────────
// Estado optimista
// ──────────────────────────────────────────────

type TaskAction =
  | { kind: 'patch'; id: string; patch: Partial<BoardTask> }
  | { kind: 'add'; task: BoardTask }
  | { kind: 'remove'; id: string }
  | { kind: 'reorder'; groupId: string; ids: string[] }
  | { kind: 'removeGroup'; groupId: string }

function taskReducer(state: BoardTask[], action: TaskAction): BoardTask[] {
  switch (action.kind) {
    case 'patch':
      return state.map((task) => (task.id === action.id ? { ...task, ...action.patch } : task))
    case 'add':
      return [...state, action.task]
    case 'remove':
      return state.filter((task) => task.id !== action.id)
    case 'reorder': {
      const order = new Map(action.ids.map((id, index) => [id, index + 1]))
      return state.map((task) => {
        const position = order.get(task.id)
        return position === undefined ? task : { ...task, groupId: action.groupId, position }
      })
    }
    case 'removeGroup':
      return state.filter((task) => task.groupId !== action.groupId)
  }
}

type GroupAction =
  | { kind: 'add'; group: BoardGroup }
  | { kind: 'patch'; id: string; patch: Partial<BoardGroup> }
  | { kind: 'remove'; id: string }
  | { kind: 'order'; ids: string[] }

function groupReducer(state: BoardGroup[], action: GroupAction): BoardGroup[] {
  switch (action.kind) {
    case 'add':
      return [...state, action.group]
    case 'patch':
      return state.map((group) => (group.id === action.id ? { ...group, ...action.patch } : group))
    case 'remove':
      return state.filter((group) => group.id !== action.id)
    case 'order': {
      const order = new Map(action.ids.map((id, index) => [id, index + 1]))
      return state.map((group) => ({ ...group, position: order.get(group.id) ?? group.position }))
    }
  }
}

type Outcome = { ok: true } | { ok: false; message: string }

/** Cambia la URL sin navegar (Next la sincroniza con useSearchParams). */
function replaceParams(update: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(update)) {
    if (value === null) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  // Los `?seccion=` del tablero de septiembre ya se tradujeron en el server.
  url.searchParams.delete('seccion')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

const REALTIME_TABLES = [
  'marketing_task_groups',
  'marketing_tasks',
  'marketing_task_people',
  'marketing_task_updates',
  'marketing_task_files',
] as const

function shortTitle(title: string): string {
  return title.length > 48 ? `${title.slice(0, 46)}…` : title
}

// ──────────────────────────────────────────────
// El tablero
// ──────────────────────────────────────────────

export function TaskBoard(props: {
  tenantSlug: string
  tenantId: string
  groups: BoardGroup[]
  tasks: BoardTask[]
  doneTotal: number
  team: TeamMember[]
  currentUserId: string
  canManage: boolean
  today: string
  initialView: TaskView
  initialPerson: string | null
  initialTaskId: string | null
  initialGroupId: string | null
  routines: RoutineRow[]
  weekStart: string
  weekTitle: string
  isCurrentWeek: boolean
}) {
  const { tenantSlug, tenantId, team, currentUserId, canManage, today } = props
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [tasks, applyTask] = useOptimistic(props.tasks, taskReducer)
  const [groups, applyGroup] = useOptimistic(props.groups, groupReducer)

  const [view, setView] = useState<TaskView>(props.initialView)
  const [person, setPerson] = useState<string | null>(props.initialPerson)
  const [query, setQuery] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [panel, setPanel] = useState<{ taskId: string | null; tab: PanelTab }>({
    taskId: props.initialTaskId,
    tab: 'updates',
  })
  const [leaving, setLeaving] = useState<ReadonlyMap<string, TaskStatus>>(() => new Map())
  const [doneOpen, setDoneOpen] = useState(false)
  const [doneBump, setDoneBump] = useState(0)
  const [newRoutineNonce, setNewRoutineNonce] = useState(0)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const tmpCounter = useRef(0)

  // ── Grupos plegados: comodidad de cada uno, en este navegador ──
  const collapseKey = `hub:tareas:plegados:${tenantId}`
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(collapseKey)
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]))
    } catch {
      // Sin almacenamiento (modo privado): arranca todo abierto.
    }
  }, [collapseKey])

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem(collapseKey, JSON.stringify([...next]))
      } catch {
        // Igual se pliega; solo no se recuerda.
      }
      return next
    })
  }

  // ── En vivo: si otro socio cambia algo, el tablero se pone al día solo ──
  const refresh = useDebouncedRefresh(() => {
    router.refresh()
  }, 700)
  // El panel abierto se vuelve a pedir solo si el cambio es de ESA tarea (no con cada
  // cambio del bar: re-firmar las fotos las hacía parpadear).
  const openTaskRef = useRef<string | null>(props.initialTaskId)
  const refreshPanel = useDebouncedRefresh(() => {
    setRefreshSignal((value) => value + 1)
  }, 700)
  useEffect(() => {
    const touchesOpenTask = (payload: unknown) => {
      const open = openTaskRef.current
      if (!open || typeof payload !== 'object' || payload === null) return false
      const rows = [
        (payload as { new?: Record<string, unknown> }).new,
        (payload as { old?: Record<string, unknown> }).old,
      ]
      return rows.some((row) => row && (row.task_id === open || row.id === open))
    }
    const onChange = (payload: unknown) => {
      refresh()
      if (touchesOpenTask(payload)) refreshPanel()
    }
    let wasDown = false
    return subscribeChanges({
      channel: `tareas-${tenantId}`,
      events: [
        ...REALTIME_TABLES.map((table) => ({
          event: '*' as const,
          table,
          filter: `tenant_id=eq.${tenantId}` as const,
          onChange,
        })),
        // Los DELETE no se pueden filtrar por bar (Realtime los manda sin filtro y solo con
        // el id): sin esto, una tarea o un grupo borrado no le llegaba a nadie.
        { event: 'DELETE' as const, table: 'marketing_tasks', onChange },
        { event: 'DELETE' as const, table: 'marketing_task_groups', onChange },
      ],
      // Al reconectarse no llega lo que pasó mientras estuvo caído: se vuelve a leer.
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && wasDown) {
          refresh()
          refreshPanel()
        }
        if (status !== 'SUBSCRIBED') wasDown = true
      },
    })
  }, [tenantId, refresh, refreshPanel])

  // ── El link directo a un grupo (?grupo=) lo trae a la vista ──
  useEffect(() => {
    if (!props.initialGroupId) return
    document
      .getElementById(`group-${props.initialGroupId}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [props.initialGroupId])

  // ── El link directo a una tarea que ya no está ──
  const warnedMissing = useRef(false)
  useEffect(() => {
    if (!props.initialTaskId || warnedMissing.current) return
    if (!props.tasks.some((task) => task.id === props.initialTaskId)) {
      warnedMissing.current = true
      toast.info('Esa tarea ya no está en el tablero.')
      replaceParams({ tarea: null })
      setPanel((prev) => ({ ...prev, taskId: null }))
    }
  }, [props.initialTaskId, props.tasks])

  /** Optimista: pinta, llama al server y avisa si falló. Devuelve si salió bien. */
  function run(apply: () => void, call: () => Promise<Outcome>): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        apply()
        try {
          const result = await call()
          if (!result.ok) toast.error(result.message)
          resolve(result.ok)
        } catch {
          toast.error(CONNECTION_ERROR)
          resolve(false)
        }
      })
    })
  }

  // ── Lo que se ve ──
  const placement = useMemo(
    () =>
      tasks.map((task) => {
        const from = leaving.get(task.id)
        return from ? { ...task, status: from } : task
      }),
    [tasks, leaving],
  )
  const filter = { personId: person, query, onlyOverdue }
  const board = useMemo(
    () => buildBoard(groups, placement, { personId: person, query, onlyOverdue }, today),
    [groups, placement, person, query, onlyOverdue, today],
  )
  const dragEnabled = !filter.personId && !filter.query && !filter.onlyOverdue
  const tasksById = useMemo(() => new Map(placement.map((task) => [task.id, task])), [placement])
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  const openByPerson = useMemo(() => openCountByPerson(tasks), [tasks])
  const totalByGroup = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasks) counts.set(task.groupId, (counts.get(task.groupId) ?? 0) + 1)
    return counts
  }, [tasks])

  // Terminadas: el total del server más lo que se terminó (o reabrió) acá y todavía no volvió.
  const serverDoneLoaded = props.tasks.filter((task) => task.status === 'done').length
  const doneTotal = Math.max(0, props.doneTotal + (board.counts.done - serverDoneLoaded))

  const routineProgress = useMemo(() => {
    let done = 0
    let total = 0
    for (const routine of props.routines) {
      total += routine.slots
      done += Math.min(
        routine.slots,
        routine.doneSlots.filter((slot) => slot < routine.slots).length,
      )
    }
    return { done, total }
  }, [props.routines])

  // ── Arrastrar (entre grupos también) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [drag, setDrag] = useState<{ activeId: string; columns: Record<string, string[]> } | null>(
    null,
  )

  function containerOf(columns: Record<string, string[]>, id: string): string | null {
    if (id.startsWith('group:')) return id.slice('group:'.length)
    for (const [groupId, ids] of Object.entries(columns)) if (ids.includes(id)) return groupId
    return null
  }

  function onDragStart(event: DragStartEvent) {
    const columns: Record<string, string[]> = {}
    for (const column of board.columns)
      columns[column.group.id] = column.tasks.map((task) => task.id)
    setDrag({ activeId: String(event.active.id), columns })
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    setDrag((prev) => {
      if (!prev) return prev
      const activeId = String(active.id)
      const from = containerOf(prev.columns, activeId)
      const to = containerOf(prev.columns, String(over.id))
      if (!from || !to || from === to) return prev
      const fromIds = (prev.columns[from] ?? []).filter((id) => id !== activeId)
      const toIds = [...(prev.columns[to] ?? [])]
      const overIndex = toIds.indexOf(String(over.id))
      toIds.splice(overIndex >= 0 ? overIndex : toIds.length, 0, activeId)
      return { ...prev, columns: { ...prev.columns, [from]: fromIds, [to]: toIds } }
    })
  }

  function onDragEnd(event: DragEndEvent) {
    const current = drag
    setDrag(null)
    const { active, over } = event
    if (!current || !over) return
    const activeId = String(active.id)
    const to = containerOf(current.columns, String(over.id))
    if (!to) return
    let ids = current.columns[to] ?? []
    const oldIndex = ids.indexOf(activeId)
    const overIndex = String(over.id).startsWith('group:')
      ? ids.length - 1
      : ids.indexOf(String(over.id))
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex)
      ids = arrayMove(ids, oldIndex, overIndex)

    const task = tasksById.get(activeId)
    const before = board.columns
      .find((column) => column.group.id === to)
      ?.tasks.map((item) => item.id)
    const sameGroup = task?.groupId === to
    const sameOrder =
      before && before.length === ids.length && before.every((id, index) => id === ids[index])
    if (!task || (sameGroup && sameOrder)) return

    run(
      () => applyTask({ kind: 'reorder', groupId: to, ids }),
      () => reorderTasksAction(tenantSlug, { groupId: to, ids }),
    )
  }

  const columns = drag
    ? board.columns.map((column) => ({
        ...column,
        tasks: (drag.columns[column.group.id] ?? []).flatMap((id) => {
          const task = tasksById.get(id)
          return task ? [task] : []
        }),
      }))
    : board.columns

  // ── Los gestos ──
  function openTask(taskId: string, tab: PanelTab = 'updates') {
    openTaskRef.current = taskId
    setPanel({ taskId, tab })
    replaceParams({ tarea: taskId })
  }

  function closePanel() {
    openTaskRef.current = null
    setPanel((prev) => ({ ...prev, taskId: null }))
    replaceParams({ tarea: null })
  }

  function changeStatus(task: BoardTask, status: TaskStatus) {
    if (status === task.status) return
    const previous = task.status
    if (status === 'done') {
      setLeaving((prev) => new Map(prev).set(task.id, previous))
      window.setTimeout(() => {
        setLeaving((prev) => {
          const next = new Map(prev)
          next.delete(task.id)
          return next
        })
        setDoneBump((value) => value + 1)
      }, 560)
    }
    run(
      () =>
        applyTask({
          kind: 'patch',
          id: task.id,
          patch: { status, completedAt: status === 'done' ? new Date().toISOString() : null },
        }),
      () => updateTaskAction(tenantSlug, { id: task.id, patch: { status } }),
    )
    if (status === 'done' && panel.taskId !== task.id) {
      toast.success(`«${shortTitle(task.title)}» terminada`, {
        description: 'Pasó a Terminadas.',
        action: {
          label: 'Deshacer',
          onClick: () => changeStatus({ ...task, status: 'done' }, previous),
        },
      })
    }
  }

  function createTask(groupId: string, title: string, where: 'top' | 'bottom' = 'bottom') {
    tmpCounter.current += 1
    const now = new Date().toISOString()
    const siblings = tasks.filter((task) => task.groupId === groupId && task.status !== 'done')
    const temp: BoardTask = {
      id: `tmp-${tmpCounter.current}`,
      groupId,
      title,
      status: 'todo',
      dueDate: null,
      notes: null,
      position: newTaskPosition(siblings, where),
      responsibleIds: [],
      involvedIds: [],
      updatesCount: 0,
      filesCount: 0,
      createdBy: currentUserId,
      createdAt: now,
      completedAt: null,
      updatedAt: now,
    }
    run(
      () => applyTask({ kind: 'add', task: temp }),
      () => createTaskAction(tenantSlug, { groupId, title, where }),
    )
  }

  const value: BoardContextValue = {
    tenantSlug,
    tenantId,
    team,
    currentUserId,
    today,
    canManage,
    dragEnabled,
    groups: [...groups].sort((a, b) => a.position - b.position),
    createTask,
    changeStatus,
    rename: (task, title) =>
      run(
        () => applyTask({ kind: 'patch', id: task.id, patch: { title } }),
        () => updateTaskAction(tenantSlug, { id: task.id, patch: { title } }),
      ),
    setDue: (task, dueDate) =>
      run(
        () => applyTask({ kind: 'patch', id: task.id, patch: { dueDate } }),
        () => updateTaskAction(tenantSlug, { id: task.id, patch: { dueDate } }),
      ),
    setNotes: (task, notes) =>
      run(
        () => applyTask({ kind: 'patch', id: task.id, patch: { notes } }),
        () => updateTaskAction(tenantSlug, { id: task.id, patch: { notes } }),
      ),
    setPeople: (task, role: TaskPersonRole, userIds) =>
      run(
        () =>
          applyTask({
            kind: 'patch',
            id: task.id,
            patch: role === 'responsible' ? { responsibleIds: userIds } : { involvedIds: userIds },
          }),
        () => setTaskPeopleAction(tenantSlug, { taskId: task.id, role, userIds }),
      ),
    moveToGroup: (task, groupId) => {
      const siblings = tasks.filter((item) => item.groupId === groupId && item.status !== 'done')
      run(
        () =>
          applyTask({
            kind: 'patch',
            id: task.id,
            patch: { groupId, position: newTaskPosition(siblings, 'bottom') },
          }),
        () => updateTaskAction(tenantSlug, { id: task.id, patch: { groupId } }),
      )
      const target = groupsById.get(groupId)
      if (target) toast.success(`Pasó a «${target.name}».`)
    },
    removeTask: (task) => {
      if (panel.taskId === task.id) closePanel()
      run(
        () => applyTask({ kind: 'remove', id: task.id }),
        () => deleteTaskAction(tenantSlug, task.id),
      )
    },
    openTask,
    createGroup: (name, color: GroupColor) => {
      tmpCounter.current += 1
      const last = groups.reduce((max, group) => Math.max(max, group.position), 0)
      run(
        () =>
          applyGroup({
            kind: 'add',
            group: { id: `tmp-g-${tmpCounter.current}`, name, color, position: last + 1 },
          }),
        () => createGroupAction(tenantSlug, { name, color }),
      )
    },
    renameGroup: (group, name) =>
      run(
        () => applyGroup({ kind: 'patch', id: group.id, patch: { name } }),
        () => updateGroupAction(tenantSlug, { id: group.id, name }),
      ),
    recolorGroup: (group, color) =>
      run(
        () => applyGroup({ kind: 'patch', id: group.id, patch: { color } }),
        () => updateGroupAction(tenantSlug, { id: group.id, color }),
      ),
    moveGroup: (group, direction) => {
      const ordered = [...groups].sort((a, b) => a.position - b.position).map((item) => item.id)
      const from = ordered.indexOf(group.id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= ordered.length) return
      const ids = arrayMove(ordered, from, to)
      run(
        () => applyGroup({ kind: 'order', ids }),
        () => reorderGroupsAction(tenantSlug, { ids }),
      )
    },
    removeGroup: (group) =>
      run(
        () => {
          applyGroup({ kind: 'remove', id: group.id })
          applyTask({ kind: 'removeGroup', groupId: group.id })
        },
        () => deleteGroupAction(tenantSlug, group.id),
      ),
  }

  const panelTask = panel.taskId ? (tasks.find((task) => task.id === panel.taskId) ?? null) : null
  const panelGroup = panelTask ? (groupsById.get(panelTask.groupId) ?? groups[0] ?? null) : null
  const filtering = Boolean(person || query || onlyOverdue)
  const nothingMatches =
    filtering && columns.every((column) => column.tasks.length === 0) && board.done.length === 0

  return (
    <BoardProvider value={value}>
      <BoardToolbar
        view={view}
        onView={(next) => {
          setView(next)
          replaceParams({ vista: next === 'tablero' ? null : next })
        }}
        counts={{ ...board.counts, done: doneTotal }}
        routineProgress={routineProgress}
        team={team}
        openByPerson={openByPerson}
        currentUserId={currentUserId}
        person={person}
        onPerson={(next) => {
          setPerson(next)
          replaceParams({ persona: next === null ? null : next === currentUserId ? 'yo' : next })
        }}
        onlyOverdue={onlyOverdue}
        onOnlyOverdue={setOnlyOverdue}
        query={query}
        onQuery={setQuery}
        onNewRoutine={() => setNewRoutineNonce((value) => value + 1)}
        canEditRoutine={canManage}
      />

      {view === 'rutina' ? (
        <OrganicChecklist
          tenantSlug={tenantSlug}
          routines={props.routines}
          weekStart={props.weekStart}
          weekTitle={props.weekTitle}
          isCurrentWeek={props.isCurrentWeek}
          newRoutineNonce={newRoutineNonce}
          canEdit={canManage}
        />
      ) : groups.length === 0 ? (
        <GroupsEmpty />
      ) : (
        <>
          {filtering ? (
            <FilterNote
              person={person ? (team.find((member) => member.id === person)?.name ?? null) : null}
              mine={person === currentUserId}
              query={query}
              onlyOverdue={onlyOverdue}
              empty={nothingMatches}
              onClear={() => {
                setPerson(null)
                setQuery('')
                setOnlyOverdue(false)
                replaceParams({ persona: null })
              }}
            />
          ) : null}

          <DndContext
            // Id fijo: el que genera dnd-kit cambia entre el server y el navegador (aria-describedby).
            id="tablero-de-tareas"
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDrag(null)}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  'Para mover una tarea, apretá espacio, movela con las flechas y soltala con espacio. Escape cancela.',
              },
            }}
          >
            {columns.map((column, index) => {
              // Con un filtro, los grupos sin nada que mostrar se esconden (menos ruido).
              if (filtering && column.tasks.length === 0) return null
              return (
                <GroupSection
                  key={column.group.id}
                  group={column.group}
                  tasks={column.tasks}
                  breakdown={column.breakdown}
                  totalInGroup={totalByGroup.get(column.group.id) ?? 0}
                  collapsed={collapsed.has(column.group.id)}
                  onToggle={() => toggleGroup(column.group.id)}
                  leaving={new Set(leaving.keys())}
                  isFirst={index === 0}
                  isLast={index === columns.length - 1}
                />
              )
            })}
          </DndContext>

          {filtering ? null : <NewGroupInline />}

          <DoneSection
            tasks={board.done}
            total={filtering ? board.done.length : doneTotal}
            groupsById={groupsById}
            open={doneOpen}
            onToggle={() => setDoneOpen((open) => !open)}
            bump={doneBump}
          />
        </>
      )}

      <TaskPanel
        task={panelTask}
        group={panelGroup}
        open={Boolean(panel.taskId)}
        onOpenChange={(open) => {
          if (!open) closePanel()
        }}
        tab={panel.tab}
        onTab={(tab) => setPanel((prev) => ({ ...prev, tab }))}
        refreshSignal={refreshSignal}
      />
    </BoardProvider>
  )
}

/** Qué filtro está puesto y cómo sacarlo (y, si no queda nada, decirlo). */
function FilterNote({
  person,
  mine,
  query,
  onlyOverdue,
  empty,
  onClear,
}: {
  person: string | null
  mine: boolean
  query: string
  onlyOverdue: boolean
  empty: boolean
  onClear: () => void
}) {
  const parts: string[] = []
  if (mine) parts.push('tus tareas (responsable o involucrado)')
  else if (person) parts.push(`las de ${person}`)
  if (onlyOverdue) parts.push('solo las vencidas')
  if (query.trim()) parts.push(`con «${query.trim()}»`)
  return (
    <div
      className={
        empty
          ? 'mb-6 flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center'
          : 'mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground'
      }
    >
      {empty ? (
        <>
          <p className="font-serif text-xl font-semibold text-foreground">Nada con este filtro</p>
          <p className="mt-1 text-sm text-muted-foreground">Mirando {parts.join(', ')}.</p>
        </>
      ) : (
        <span>Mirando {parts.join(', ')}.</span>
      )}
      <button
        type="button"
        onClick={onClear}
        className={
          empty
            ? 'mt-4 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'
            : 'rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        Ver todo
      </button>
    </div>
  )
}
