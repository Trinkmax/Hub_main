'use client'

import { formatInTimeZone } from 'date-fns-tz'
import { CheckCircle2, LogIn, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TZ } from '@/lib/flows/execution-log-filters'
import {
  ACTION_LABEL,
  CHANNEL_LABEL,
  DETAIL_LABEL,
  type FlowActionType,
  formatWaitLabel,
  SKIP_REASON_LABEL,
  STATUS_META,
} from '@/lib/flows/execution-log-labels'
import type { FlowLogRow } from '@/lib/flows/execution-log-queries'
// Mismo mapa de íconos que el editor de grafo: el registro tiene que "verse"
// como el canvas donde el dueño armó el paso.
import { KIND_ICON, type StepKind } from './step-meta'

const EXTRA_ICON = {
  enrolled: LogIn,
  completed: CheckCircle2,
  failed: TriangleAlert,
} as const

function actionIcon(actionType: FlowActionType) {
  if (actionType in EXTRA_ICON) return EXTRA_ICON[actionType as keyof typeof EXTRA_ICON]
  return KIND_ICON[actionType as StepKind] ?? LogIn
}

function fullDate(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, 'dd/MM/yyyy HH:mm:ss')
}

function initialsOf(row: FlowLogRow): string {
  if (!row.customer) return '?'
  const { first_name, last_name } = row.customer
  return `${first_name?.[0] ?? ''}${last_name?.[0] ?? ''}`.toUpperCase() || '?'
}

function customerName(row: FlowLogRow): string {
  return row.customer ? `${row.customer.first_name} ${row.customer.last_name}` : 'Cliente borrado'
}

/** Traduce un valor conocido de `detail` a algo que se lea en castellano. */
function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (key === 'skip_reason') return SKIP_REASON_LABEL[String(value)] ?? String(value)
  if (key === 'branch') return value === 'true' ? 'Sí' : 'No'
  if (key === 'channel_type') return CHANNEL_LABEL[String(value).toLowerCase()] ?? String(value)
  if (key === 'wait_minutes') return formatWaitLabel(Number(value)) || String(value)
  if (key === 'next_run_at') return fullDate(String(value))
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function FlowLogTable({ rows, tenantSlug }: { rows: FlowLogRow[]; tenantSlug: string }) {
  const [selected, setSelected] = useState<FlowLogRow | null>(null)

  return (
    <>
      {/* Mobile: la grilla se cae en cards, que una tabla de 5 columnas no entra
          en un celular sin volverse ilegible. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => {
          const Icon = actionIcon(row.action_type)
          const status = STATUS_META[row.status]
          return (
            <li
              key={row.id}
              className="card-hairline flex flex-col gap-2 rounded-xl border bg-card/60 p-3"
            >
              <div className="flex items-center gap-2">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                    {initialsOf(row)}
                  </AvatarFallback>
                </Avatar>
                <CustomerLink row={row} tenantSlug={tenantSlug} className="min-w-0 flex-1" />
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{row.action_label}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <time
                  className="text-xs tabular-nums text-muted-foreground"
                  dateTime={row.occurred_at}
                >
                  {fullDate(row.occurred_at)}
                </time>
                <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                  Ver detalles
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="hidden sm:block">
        <DataTableShell>
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Contacto</DataTableHeader>
                  <DataTableHeader>Acción</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                  <DataTableHeader>Ejecutado el</DataTableHeader>
                  <DataTableHeader className="text-right">Acciones</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => {
                  const Icon = actionIcon(row.action_type)
                  const status = STATUS_META[row.status]
                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-secondary/40">
                      <DataTableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                              {initialsOf(row)}
                            </AvatarFallback>
                          </Avatar>
                          <CustomerLink row={row} tenantSlug={tenantSlug} />
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <span className="inline-flex items-center gap-2">
                          <Icon
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>{row.action_label}</span>
                        </span>
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </DataTableCell>
                      <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        <time dateTime={row.occurred_at}>{fullDate(row.occurred_at)}</time>
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                          Ver detalles
                        </Button>
                      </DataTableCell>
                    </tr>
                  )
                })}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      </div>

      <FlowLogDetailSheet row={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function CustomerLink({
  row,
  tenantSlug,
  className,
}: {
  row: FlowLogRow
  tenantSlug: string
  className?: string
}) {
  if (!row.customer) {
    return <span className={className}>{customerName(row)}</span>
  }
  return (
    <Link
      href={`/${tenantSlug}/clientes/${row.customer.id}`}
      className={`block truncate font-medium hover:text-primary ${className ?? ''}`}
    >
      {customerName(row)}
    </Link>
  )
}

function FlowLogDetailSheet({ row, onClose }: { row: FlowLogRow | null; onClose: () => void }) {
  const detail =
    row?.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : {}
  const known = Object.entries(detail).filter(([key]) => key in DETAIL_LABEL)
  const status = row ? STATUS_META[row.status] : null

  return (
    <Sheet open={row !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle>{row.action_label}</SheetTitle>
              <SheetDescription>
                {ACTION_LABEL[row.action_type]} · {fullDate(row.occurred_at)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                {status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
                <span className="text-sm text-muted-foreground">{customerName(row)}</span>
              </div>

              {row.error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {row.error}
                </p>
              ) : null}

              {known.length > 0 ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {known.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{DETAIL_LABEL[key]}</dt>
                      <dd className="text-pretty">{formatDetailValue(key, value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Este paso no dejó datos extra.</p>
              )}

              {Object.keys(detail).length > 0 ? (
                <details className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Datos técnicos
                  </summary>
                  <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
