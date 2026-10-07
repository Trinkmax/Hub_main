'use client'

import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquareText,
  UserRound,
} from 'lucide-react'
import { BADGE_DOT_CLASS, Badge, badgeVariants } from '@/components/ui/badge'
import {
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableGroupRow,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableRowAction,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { KIND_LABELS, TASK_STATUSES, type TaskStatus } from '@/lib/marketing/constants'
import type { MarketingTaskRow } from '@/lib/marketing/queries'
import { BUCKET_LABELS, type DateBucket, formatDayShort } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'
import { isTaskStatus, TASK_STATUS_META } from './task-status'

/** Tarea · Tipo · Fecha · Equipo · Estado (las del medio se esconden en pantallas chicas). */
const COLUMN_COUNT = 5

/**
 * Toda la fila abre la tarea: el título es el botón estirado de la fila del
 * kit (`DataTableRowAction`, un botón porque abre un diálogo y no navega). Una
 * sola parada de Tab por fila; la fila toma el hover, el presionado y los 44 px
 * con el dedo, y el menú de estado y el link al archivo quedan arriba solos.
 */

export type TaskGroup = { bucket: DateBucket; items: MarketingTaskRow[] }

/**
 * La lista de tareas: una tabla con un grupo por cajón de fecha (Fechas
 * pasadas, Hoy, Esta semana…), cada uno plegable. En el celular quedan
 * «Tarea» y «Estado»; la fecha y el equipo bajan a una línea debajo del título.
 */
export function TaskList({
  caption,
  groups,
  collapsed,
  onToggleGroup,
  nameFor,
  onEdit,
  onStatusChange,
  empty,
}: {
  /** Nombre accesible de la tabla («Tareas de Eventos»). */
  caption: string
  groups: TaskGroup[]
  collapsed: Partial<Record<DateBucket, boolean>>
  onToggleGroup: (bucket: DateBucket) => void
  nameFor: (userId: string | null) => string | null
  onEdit: (task: MarketingTaskRow) => void
  onStatusChange: (task: MarketingTaskRow, status: TaskStatus) => void
  /** Lo que se ve sin tareas: distingue «no hay nada» de «la búsqueda no encontró nada». */
  empty: React.ReactNode
}) {
  return (
    <DataTableShell>
      <DataTableScroll>
        <DataTableRoot caption={caption}>
          <DataTableHead>
            <tr>
              <DataTableHeader>Tarea</DataTableHeader>
              <DataTableHeader className="max-lg:hidden">Tipo</DataTableHeader>
              <DataTableHeader className="max-md:hidden">Fecha</DataTableHeader>
              <DataTableHeader className="max-md:hidden">Equipo</DataTableHeader>
              <DataTableHeader className="w-px whitespace-nowrap">Estado</DataTableHeader>
            </tr>
          </DataTableHead>
          {groups.length === 0 ? (
            <DataTableBody>
              <DataTableEmpty colSpan={COLUMN_COUNT}>{empty}</DataTableEmpty>
            </DataTableBody>
          ) : (
            groups.map((group) => {
              const open = !collapsed[group.bucket]
              return (
                <DataTableBody key={group.bucket}>
                  <DataTableGroupRow
                    colSpan={COLUMN_COUNT}
                    label={
                      <GroupToggle
                        bucket={group.bucket}
                        count={group.items.length}
                        open={open}
                        onToggle={() => onToggleGroup(group.bucket)}
                      />
                    }
                  />
                  {open
                    ? group.items.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          nameFor={nameFor}
                          onEdit={onEdit}
                          onStatusChange={onStatusChange}
                        />
                      ))
                    : null}
                </DataTableBody>
              )
            })
          )}
        </DataTableRoot>
      </DataTableScroll>
    </DataTableShell>
  )
}

function GroupToggle({
  bucket,
  count,
  open,
  onToggle,
}: {
  bucket: DateBucket
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="relative hit-area -mx-1 inline-flex min-h-6 items-center gap-1.5 rounded-sm px-1 text-start outline-offset-2 outline-(--ring) focus-visible:outline-2"
    >
      <ChevronRight
        aria-hidden
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-[rotate] duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
      <span>{BUCKET_LABELS[bucket]}</span>
      {/* Lo vencido se marca en aviso: son tareas que se pasaron de fecha. */}
      <Badge tone={bucket === 'past' ? 'warning' : 'neutral'} className="type-amount">
        {count}
        <span className="sr-only"> {count === 1 ? 'tarea' : 'tareas'}</span>
      </Badge>
    </button>
  )
}

function TaskRow({
  task,
  nameFor,
  onEdit,
  onStatusChange,
}: {
  task: MarketingTaskRow
  nameFor: (userId: string | null) => string | null
  onEdit: (task: MarketingTaskRow) => void
  onStatusChange: (task: MarketingTaskRow, status: TaskStatus) => void
}) {
  const responsible = nameFor(task.responsibleId)
  const involved = nameFor(task.involvedId)
  const date = task.definedDate ?? task.idealDate
  // Sin fecha definida, la que se ve es la ideal: todavía no es un compromiso.
  const tentative = task.definedDate === null && task.idealDate !== null
  const done = task.status === 'done'

  return (
    <DataTableRow>
      <DataTableCell primary>
        <div className="flex min-w-0 flex-col gap-1">
          <DataTableRowAction
            onClick={() => onEdit(task)}
            className={cn(
              'w-fit max-w-full text-pretty',
              done && 'text-muted-foreground line-through decoration-subtle-foreground',
            )}
          >
            {task.title}
          </DataTableRowAction>
          {task.specifications ? (
            <p className="line-clamp-2 max-w-prose type-small font-normal text-pretty text-muted-foreground">
              {task.specifications}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption font-normal text-muted-foreground">
            <span className="lg:hidden">{KIND_LABELS[task.kind]}</span>
            <span className="inline-flex items-center gap-1 md:hidden">
              <CalendarDays className="size-3.5" aria-hidden />
              {formatDayShort(date)}
              {tentative ? ' (ideal)' : null}
            </span>
            <span className="inline-flex items-center gap-1 md:hidden">
              <UserRound className="size-3.5" aria-hidden />
              {responsible ?? 'Sin asignar'}
              {involved ? ` · con ${involved}` : null}
            </span>
            {task.notes ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquareText className="size-3.5" aria-hidden />
                Con contexto
              </span>
            ) : null}
            {task.fileUrl ? (
              <a
                href={task.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hit-area relative z-10 inline-flex items-center gap-1 rounded-sm text-primary underline decoration-1 underline-offset-2 outline-offset-2 outline-(--ring) hover:decoration-2 focus-visible:outline-2"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Archivo
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            ) : null}
          </div>
        </div>
      </DataTableCell>
      <DataTableCell className="text-muted-foreground max-lg:hidden">
        {KIND_LABELS[task.kind]}
      </DataTableCell>
      <DataTableCell className="whitespace-nowrap max-md:hidden">
        <span className="type-amount">{formatDayShort(date)}</span>
        {tentative ? (
          <span className="block type-caption text-subtle-foreground">ideal</span>
        ) : null}
      </DataTableCell>
      <DataTableCell className="max-md:hidden">
        <span className={responsible ? undefined : 'text-subtle-foreground'}>
          {responsible ?? 'Sin asignar'}
        </span>
        {involved ? (
          <span className="block type-caption text-muted-foreground">con {involved}</span>
        ) : null}
      </DataTableCell>
      <DataTableCell className="w-px whitespace-nowrap">
        <TaskStatusMenu task={task} onStatusChange={onStatusChange} />
      </DataTableCell>
    </DataTableRow>
  )
}

/**
 * El estado se cambia desde la misma etiqueta: se ve como la etiqueta del kit
 * (24 px) y responde en 44 con el dedo (`hit-area`). El elegido lo marca el
 * radio del menú.
 */
function TaskStatusMenu({
  task,
  onStatusChange,
}: {
  task: MarketingTaskRow
  onStatusChange: (task: MarketingTaskRow, status: TaskStatus) => void
}) {
  const meta = TASK_STATUS_META[task.status]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Estado de «${task.title}»: ${meta.label}. Cambiar estado`}
        title={meta.description}
        className={badgeVariants({
          tone: meta.tone,
          size: 'md',
          className:
            'z-10 hit-area gap-1.5 pe-1.5 transition-colors duration-(--duration-quick) hover:border-border-strong',
        })}
      >
        <span aria-hidden className={cn('size-1.5 rounded-full', BADGE_DOT_CLASS[meta.tone])} />
        {meta.label}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Cambiar estado</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(next) => {
            if (isTaskStatus(next) && next !== task.status) onStatusChange(task, next)
          }}
        >
          {TASK_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {TASK_STATUS_META[status].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
