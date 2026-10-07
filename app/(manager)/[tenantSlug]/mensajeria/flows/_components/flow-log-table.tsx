'use client'

import { CheckCircle2, LogIn, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { DataTable } from '@/components/ui/data-table'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { StatusBadge } from '@/components/ui/status-badge'
import { cordobaDateTime, formatIsoDay } from '@/lib/dates'
import {
  ACTION_LABEL,
  CHANNEL_LABEL,
  DETAIL_LABEL,
  type FlowActionType,
  formatWaitLabel,
  SKIP_REASON_LABEL,
} from '@/lib/flows/execution-log-labels'
import type { FlowLogRow } from '@/lib/flows/execution-log-queries'
import { FLOW_EVENT_STATUS } from './flow-status'
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

/**
 * `dd/MM/yyyy HH:mm:ss` en hora de Córdoba, escrito a mano (los segundos
 * ordenan los pasos que corren en el mismo minuto).
 */
function fullDate(iso: string): string {
  const parts = cordobaDateTime(iso)
  if (!parts) return '—'
  return `${formatIsoDay(parts.date)} ${parts.time}:${String(parts.second).padStart(2, '0')}`
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
      {/* En el celular la tabla pasa a tarjetas-fila (lo hace la DataTable). */}
      <DataTable
        caption="Registros de ejecución"
        rows={rows}
        getRowId={(row) => row.id}
        columns={[
          {
            id: 'contact',
            header: 'Contacto',
            cell: (row) => (
              <span className="flex min-w-0 items-center gap-3">
                <Avatar size="sm" aria-hidden="true">
                  <AvatarFallback className="bg-brand-soft font-semibold text-brand-text">
                    {initialsOf(row)}
                  </AvatarFallback>
                </Avatar>
                <CustomerLink row={row} tenantSlug={tenantSlug} />
              </span>
            ),
          },
          {
            id: 'action',
            header: 'Acción',
            cell: (row) => {
              const Icon = actionIcon(row.action_type)
              return (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{row.action_label}</span>
                </span>
              )
            },
          },
          {
            id: 'status',
            header: 'Estado',
            mobile: 'value',
            cell: (row) => <StatusBadge status={row.status} map={FLOW_EVENT_STATUS} />,
          },
          {
            id: 'occurred',
            header: 'Ejecutado el',
            mobile: 'meta',
            cell: (row) => (
              <time
                className="whitespace-nowrap tabular-nums text-muted-foreground"
                dateTime={row.occurred_at}
              >
                {fullDate(row.occurred_at)}
              </time>
            ),
          },
          {
            id: 'details',
            header: 'Detalles',
            headerHidden: true,
            align: 'end',
            cell: (row) => (
              <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                Ver detalles
                <span className="sr-only"> de {customerName(row)}</span>
              </Button>
            ),
          },
        ]}
      />

      <FlowLogDetailSheet row={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function CustomerLink({ row, tenantSlug }: { row: FlowLogRow; tenantSlug: string }) {
  if (!row.customer) {
    return <span className="truncate text-muted-foreground">{customerName(row)}</span>
  }
  return (
    <Link
      href={`/${tenantSlug}/clientes/${row.customer.id}`}
      className="truncate font-medium underline-offset-2 hover:underline"
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

  return (
    <Sheet open={row !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" size="md">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle>{row.action_label}</SheetTitle>
              <SheetDescription>
                {ACTION_LABEL[row.action_type]} · {fullDate(row.occurred_at)}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={row.status} map={FLOW_EVENT_STATUS} />
                <span className="type-body text-muted-foreground">{customerName(row)}</span>
              </div>

              {row.error ? (
                <Callout tone="danger" title="Qué falló">
                  {row.error}
                </Callout>
              ) : null}

              {known.length > 0 ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 type-body">
                  {known.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{DETAIL_LABEL[key]}</dt>
                      <dd className="text-pretty">{formatDetailValue(key, value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="type-body text-muted-foreground">Este paso no dejó datos extra.</p>
              )}

              {Object.keys(detail).length > 0 ? (
                <details className="rounded-lg border border-border bg-secondary p-3">
                  <summary className="cursor-pointer type-label text-muted-foreground">
                    Datos técnicos (para soporte)
                  </summary>
                  <pre className="mt-2 overflow-x-auto font-mono type-caption">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                </details>
              ) : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
