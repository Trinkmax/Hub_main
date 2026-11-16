'use client'

import { formatInTimeZone } from 'date-fns-tz'
import { Check, ChevronDown, Link2, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { getTaskDetail } from '@/lib/marketing/actions'
import { type BoardGroup, type BoardTask, peopleOf } from '@/lib/marketing/board'
import { GROUP_RAIL, GROUP_TEXT } from '@/lib/marketing/constants'
import type { TaskDetail, TaskFileRow } from '@/lib/marketing/queries'
import { MARKETING_TZ } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'
import { useBoard } from './board-context'
import { DuePicker } from './due-picker'
import { CONNECTION_ERROR } from './guard'
import { PeoplePicker } from './people-picker'
import { AvatarStack, PersonChip } from './person-avatar'
import { StatusPicker } from './status-picker'
import { TaskFiles } from './task-files'
import { TaskUpdates } from './task-updates'

export type PanelTab = 'updates' | 'files'

/** Las URLs firmadas duran 1 h: se reusan hasta los 45 min para no re-bajar fotos y videos. */
const SIGNED_REUSE_MS = 45 * 60_000

/**
 * Al volver a pedir el detalle (alguien comentó), los archivos que ya estaban conservan su URL:
 * si cambiara, las miniaturas y los videos se bajarían de nuevo y parpadearían.
 */
function keepSignedUrls(
  prev: TaskDetail | null,
  next: TaskDetail,
  signedAt: { current: number },
): TaskDetail {
  const expired = Date.now() - signedAt.current > SIGNED_REUSE_MS
  if (!prev || prev.taskId !== next.taskId || expired) {
    signedAt.current = Date.now()
    return next
  }
  const known = new Map(prev.files.map((file) => [file.id, file]))
  const reuse = (file: TaskFileRow): TaskFileRow => {
    const old = known.get(file.id)
    return old ? { ...file, url: old.url, thumbUrl: old.thumbUrl } : file
  }
  return {
    ...next,
    files: next.files.map(reuse),
    updates: next.updates.map((update) => ({ ...update, files: update.files.map(reuse) })),
  }
}

/**
 * El panel de una tarea (el de Monday): título grande, estado, vencimiento y
 * personas arriba; notas; y abajo las actualizaciones y los archivos. Se abre
 * con «Abrir», con el globito o con `?tarea=<id>` en la URL (para mandar el link).
 */
export function TaskPanel({
  task,
  group,
  open,
  onOpenChange,
  tab,
  onTab,
  refreshSignal,
}: {
  task: BoardTask | null
  group: BoardGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  /** Sube cuando la base avisa que algo cambió (otro socio comentó, subió un archivo…). */
  refreshSignal: number
}) {
  const board = useBoard()
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const signedAt = useRef(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const taskId = task?.id ?? null
  const latest = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!taskId || taskId.startsWith('tmp-')) return
    latest.current = taskId
    try {
      const result = await getTaskDetail(board.tenantSlug, taskId)
      // Si mientras tanto se abrió otra tarea, esta respuesta ya no sirve.
      if (latest.current !== taskId) return
      if (result.ok) {
        setFailed(null)
        setDetail((prev) => keepSignedUrls(prev, result.data, signedAt))
      } else setFailed(result.message)
    } catch {
      if (latest.current === taskId) setFailed(CONNECTION_ERROR)
    }
  }, [board.tenantSlug, taskId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal es justamente el disparador.
  useEffect(() => {
    if (!open || !taskId) return
    let cancelled = false
    setLoading((prev) => prev || detail?.taskId !== taskId)
    void reload().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, taskId, refreshSignal, reload])

  const shownDetail = detail && detail.taskId === taskId ? detail : null
  const canDelete = task ? board.canManage || task.createdBy === board.currentUserId : false

  return (
    <Sheet open={open && Boolean(task)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[34rem]"
        // Sin el foco en el título (en el celular abriría el teclado), pero adentro del panel:
        // si no, Tab recorre el tablero que quedó atrás.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusRef.current?.focus()
        }}
      >
        {task && group ? (
          <>
            <SheetTitle className="sr-only">{task.title}</SheetTitle>
            <SheetDescription className="sr-only">
              Detalle de la tarea: estado, personas, notas, actualizaciones y archivos.
            </SheetDescription>

            <div
              ref={focusRef}
              tabIndex={-1}
              className="relative px-5 pb-4 pt-4 outline-none sm:px-6"
            >
              <span
                aria-hidden
                className={cn('absolute inset-y-0 left-0 w-1', GROUP_RAIL[group.color])}
              />
              <div className="flex items-center gap-2 pr-10">
                <GroupMenu task={task} group={group} />
                <CopyLink taskId={task.id} />
              </div>

              <PanelTitle task={task} />

              <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label="Estado">
                  <StatusPicker
                    status={task.status}
                    variant="field"
                    onChange={(status) => board.changeStatus(task, status)}
                  />
                </Field>
                <Field label="Vencimiento">
                  <DuePicker
                    value={task.dueDate}
                    today={board.today}
                    status={task.status}
                    variant="field"
                    onChange={(date) => board.setDue(task, date)}
                  />
                </Field>
                <Field label="Responsable">
                  <PeopleField task={task} kind="responsible" />
                </Field>
                <Field label="Involucrados">
                  <PeopleField task={task} kind="involved" />
                </Field>
              </dl>

              <PanelNotes task={task} />
            </div>

            <div className="sticky top-0 z-10 flex items-center gap-1 border-y border-border/70 bg-background/95 px-4 backdrop-blur sm:px-5">
              <TabButton active={tab === 'updates'} onClick={() => onTab('updates')}>
                Actualizaciones
                <Count value={shownDetail ? shownDetail.updates.length : task.updatesCount} />
              </TabButton>
              <TabButton active={tab === 'files'} onClick={() => onTab('files')}>
                Archivos
                <Count value={shownDetail ? shownDetail.files.length : task.filesCount} />
              </TabButton>
              {loading ? (
                <Loader2
                  className="ml-auto size-4 animate-spin text-muted-foreground"
                  aria-label="Cargando"
                />
              ) : null}
            </div>

            <div className="flex-1 px-5 py-4 sm:px-6">
              {!shownDetail ? (
                failed ? (
                  <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
                    <p className="text-sm text-muted-foreground">{failed}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setLoading(true)
                        void reload().finally(() => setLoading(false))
                      }}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Reintentar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3" aria-hidden>
                    <Skeleton className="h-24 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                  </div>
                )
              ) : (
                // Las dos montadas (la otra, escondida): cambiar de pestaña no borra lo que se
                // estaba escribiendo ni los archivos elegidos.
                <>
                  <div hidden={tab !== 'updates'}>
                    <TaskUpdates
                      task={task}
                      updates={shownDetail.updates}
                      onChanged={() => void reload()}
                    />
                  </div>
                  <div hidden={tab !== 'files'}>
                    <TaskFiles
                      taskId={task.id}
                      files={shownDetail.files}
                      onChanged={() => void reload()}
                    />
                  </div>
                </>
              )}
            </div>

            <footer className="flex items-center gap-3 border-t border-border/70 px-5 py-3 text-xs text-muted-foreground sm:px-6">
              <span className="min-w-0 flex-1 truncate">
                Creada el {formatInTimeZone(new Date(task.createdAt), MARKETING_TZ, 'dd/MM/yyyy')}
                {task.createdBy
                  ? ` por ${board.team.find((member) => member.id === task.createdBy)?.name ?? 'alguien que ya no está'}`
                  : ''}
              </span>
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Borrar tarea
                </button>
              ) : null}
            </footer>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Borrar «{task.title}»?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se borra con sus actualizaciones y archivos. Si ya está hecha, mejor marcala
                    Terminado: queda guardada en «Terminadas».
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      onOpenChange(false)
                      board.removeTask(task)
                    }}
                  >
                    Borrar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative inline-flex h-11 items-center gap-1.5 px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
        active ? 'after:bg-primary' : 'after:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Count({ value }: { value: number }) {
  if (value === 0) return null
  return (
    <span className="rounded-full bg-secondary px-1.5 text-[11px] font-semibold tabular-nums text-secondary-foreground">
      {value}
    </span>
  )
}

/** El chip del grupo arriba del título: también sirve para pasarla a otro grupo. */
function GroupMenu({ task, group }: { task: BoardTask; group: BoardGroup }) {
  const board = useBoard()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-full border border-border/80 bg-background pl-2.5 pr-1.5 text-xs font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          GROUP_TEXT[group.color],
        )}
        aria-label={`Grupo: ${group.name}. Pasar a otro grupo`}
      >
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', GROUP_RAIL[group.color])} />
        <span className="truncate">{group.name}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Pasar a
        </DropdownMenuLabel>
        {board.groups.map((option) => (
          <DropdownMenuItem
            key={option.id}
            disabled={option.id === group.id}
            onSelect={() => board.moveToGroup(task, option.id)}
          >
            <span aria-hidden className={cn('size-2.5 rounded-full', GROUP_RAIL[option.color])} />
            <span className="truncate">{option.name}</span>
            {option.id === group.id ? <Check className="ml-auto" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Copiar el link directo a la tarea (para mandarlo por WhatsApp). */
function CopyLink({ taskId }: { taskId: string }) {
  const board = useBoard()
  return (
    <button
      type="button"
      onClick={async () => {
        const url = `${window.location.origin}/${board.tenantSlug}/tareas?tarea=${taskId}`
        try {
          await navigator.clipboard.writeText(url)
          toast.success('Link copiado: mandalo y abre esta tarea.')
        } catch {
          toast.error('No se pudo copiar. El link es la dirección de esta página.')
        }
      }}
      className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Link2 className="size-3.5" aria-hidden />
      Copiar link
    </button>
  )
}

/** El título grande, editable: Enter guarda. */
function PanelTitle({ task }: { task: BoardTask }) {
  const board = useBoard()
  const [draft, setDraft] = useState(task.title)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(task.title)
  }, [task.title])

  // biome-ignore lint/correctness/useExhaustiveDependencies: se mide cada vez que cambia el texto.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function save() {
    const next = draft.replace(/\s+/g, ' ').trim()
    if (next && next !== task.title) board.rename(task, next.slice(0, 160))
    else setDraft(task.title)
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      maxLength={160}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.stopPropagation()
          setDraft(task.title)
          event.currentTarget.blur()
        }
      }}
      aria-label="Nombre de la tarea"
      className="mt-3 block w-full resize-none overflow-hidden rounded-md bg-transparent font-serif text-2xl font-semibold leading-tight tracking-tight outline-none hover:bg-accent/40 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}

function PeopleField({ task, kind }: { task: BoardTask; kind: 'responsible' | 'involved' }) {
  const board = useBoard()
  const people = peopleOf(task, kind, board.team)
  const label = kind === 'responsible' ? 'Responsable' : 'Involucrados'
  return (
    <PeoplePicker
      label={label}
      team={board.team}
      selected={kind === 'responsible' ? task.responsibleIds : task.involvedIds}
      currentUserId={board.currentUserId}
      onCommit={(ids) => board.setPeople(task, kind, ids)}
      align="start"
      triggerLabel={
        people.length > 0
          ? `${label}: ${people.map((person) => person.name).join(', ')}. Cambiar`
          : `${label}: nadie. Elegir`
      }
      triggerClassName="flex min-h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1 text-left text-sm hover:bg-accent/40"
    >
      {people.length === 0 ? (
        <span className="text-muted-foreground">Nadie</span>
      ) : kind === 'responsible' ? (
        <>
          <AvatarStack people={people} max={3} />
          <span className="min-w-0 truncate">
            {people.length === 1 ? people[0]?.name : `${people.length} personas`}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-wrap gap-1">
          {people.slice(0, 4).map((person) => (
            <PersonChip key={person.id} person={person} />
          ))}
          {people.length > 4 ? (
            <span className="self-center text-xs text-muted-foreground">+{people.length - 4}</span>
          ) : null}
        </span>
      )}
    </PeoplePicker>
  )
}

/** Notas: se guardan solas al salir del cuadro. */
function PanelNotes({ task }: { task: BoardTask }) {
  const board = useBoard()
  const [draft, setDraft] = useState(task.notes ?? '')
  const [saved, setSaved] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Con algo escrito sin guardar, lo que llega de la base no pisa el cuadro.
  const dirty = useRef(false)

  useEffect(() => {
    if (!dirty.current) setDraft(task.notes ?? '')
  }, [task.notes])

  // biome-ignore lint/correctness/useExhaustiveDependencies: se mide cada vez que cambia el texto.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 360)}px`
  }, [draft])

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 1800)
    return () => window.clearTimeout(timer)
  }, [saved])

  async function save() {
    const clean = draft.trim()
    if ((clean || null) === (task.notes ?? null)) {
      dirty.current = false
      return
    }
    // «Guardado» recién cuando la base dijo que sí; si falla, lo escrito queda en el cuadro.
    const ok = await board.setNotes(task, clean || null)
    if (ok) {
      dirty.current = false
      setSaved(true)
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor={`notes-${task.id}`}
          className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
        >
          Notas
        </label>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-(--task-done)">
            <Check className="size-3" aria-hidden />
            Guardado
          </span>
        ) : null}
      </div>
      <textarea
        id={`notes-${task.id}`}
        ref={ref}
        value={draft}
        onChange={(event) => {
          dirty.current = true
          setSaved(false)
          setDraft(event.target.value)
        }}
        onBlur={() => void save()}
        maxLength={10000}
        placeholder="Lo que hay que saber para hacerla: medidas, textos, referencias…"
        className="block w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
