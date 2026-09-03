'use client'

import {
  CalendarDays,
  ChevronDown,
  ExternalLink,
  MessageSquareText,
  Pencil,
  UserRound,
  UsersRound,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  KIND_LABELS,
  STATUS_CHIP,
  STATUS_DOT,
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow } from '@/lib/marketing/queries'
import { formatDayShort } from '@/lib/marketing/week'
import { cn } from '@/lib/utils'

export function TaskCard({
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
  const done = task.status === 'done'

  return (
    <article
      className={cn(
        'card-hairline group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-shadow',
        'hover:shadow-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        done && 'opacity-70',
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT[task.status])}
          />
          <button
            type="button"
            onClick={() => onEdit(task)}
            className={cn(
              'min-w-0 flex-1 text-left font-medium leading-snug tracking-tight text-foreground',
              'rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
              done && 'line-through decoration-muted-foreground/50',
            )}
          >
            {task.title}
          </button>
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label={`Editar ${task.title}`}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-cream-tint hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 sm:opacity-0"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        </div>

        {task.specifications ? (
          <p className="pl-[18px] text-sm leading-relaxed text-muted-foreground text-pretty">
            {task.specifications}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[18px] text-xs text-muted-foreground">
          <span className="rounded-md bg-secondary/70 px-1.5 py-0.5 font-medium text-secondary-foreground">
            {KIND_LABELS[task.kind]}
          </span>
          <Meta icon={CalendarDays}>{formatDayShort(date)}</Meta>
          <Meta icon={UserRound}>{responsible ?? 'Sin responsable'}</Meta>
          {involved ? <Meta icon={UsersRound}>{involved}</Meta> : null}
          {task.notes ? <Meta icon={MessageSquareText}>Con contexto</Meta> : null}
          {task.fileUrl ? (
            <a
              href={task.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Archivo
            </a>
          ) : null}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-2.5 py-1 text-xs font-medium',
            'ml-[18px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-0',
            STATUS_CHIP[task.status],
          )}
        >
          {STATUS_LABELS[task.status]}
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {TASK_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              onSelect={() => {
                if (status !== task.status) onStatusChange(task, status)
              }}
              className="gap-2"
            >
              <span aria-hidden className={cn('size-2 rounded-full', STATUS_DOT[status])} />
              {STATUS_LABELS[status]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  )
}

function Meta({ icon: Icon, children }: { icon: typeof CalendarDays; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  )
}
