'use client'

import { ArrowLeft, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { KPI } from '@/components/ui/kpi'
import { Section } from '@/components/ui/section'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format/number-kind'
import type { StaffSessionDetail } from '@/lib/staff-performance/queries'
import { shortDateTime } from './format'

type DetailItem = StaffSessionDetail['items'][number]
type DetailCustomer = StaffSessionDetail['customers'][number]

/**
 * Los productos agrupados por categoría, en el orden en que aparece cada
 * categoría por primera vez (como antes). `DataTable groupBy` agrupa filas
 * SEGUIDAS, así que primero se juntan.
 */
function itemsByCategory(items: ReadonlyArray<DetailItem>): DetailItem[] {
  const groups = new Map<string, DetailItem[]>()
  for (const it of items) {
    const list = groups.get(it.category_name) ?? []
    list.push(it)
    groups.set(it.category_name, list)
  }
  return Array.from(groups.values()).flat()
}

function customerName(c: DetailCustomer): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Sin nombre'
}

export function StaffSessionDetailDrawer({
  open,
  onOpenChange,
  sessionId,
  onBack,
  backLabel,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionId: string | null
  onBack: () => void
  /** El mozo del que se viene: «← Juan». */
  backLabel?: string
}) {
  const [detail, setDetail] = useState<StaffSessionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sube con «Reintentar»: vuelve a correr la carga sin cerrar el cajón.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !sessionId) return
    void attempt
    let cancelled = false
    setLoading(true)
    setDetail(null)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/staff/sessions/${encodeURIComponent(sessionId)}/detail`, {
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setError('No pudimos cargar el detalle de la mesa.')
          setLoading(false)
          return
        }
        const data = (await res.json()) as { detail: StaffSessionDetail }
        setDetail(data.detail)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error inesperado.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, sessionId, attempt])

  const title = detail ? (detail.alias ?? `Mesa ${detail.table_label ?? ''}`.trim()) : 'Mesa'
  const staffCount = detail?.staff_user_ids.length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="lg">
        <SheetHeader>
          <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="-ms-2">
              <ArrowLeft aria-hidden />
              {backLabel ? `Volver a ${backLabel}` : 'Volver'}
            </Button>
          </div>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {detail ? (
              <>
                {detail.alias && detail.table_label ? `Mesa ${detail.table_label} · ` : null}
                Abierta <span className="type-amount">{shortDateTime(detail.opened_at)}</span>
                {' → '}
                {detail.paid_at ? (
                  <span className="type-amount">{shortDateTime(detail.paid_at)}</span>
                ) : (
                  'sin cierre'
                )}
              </>
            ) : (
              <span className="sr-only">Detalle de la mesa</span>
            )}
          </SheetDescription>
          {detail ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {detail.party_size !== null ? (
                <Badge icon={Users}>
                  {formatNumber(detail.party_size)}{' '}
                  {detail.party_size === 1 ? 'persona' : 'personas'}
                </Badge>
              ) : null}
              <Badge appearance="outline">
                {staffCount} {staffCount === 1 ? 'mozo atribuido' : 'mozos atribuidos'}
              </Badge>
            </div>
          ) : null}
        </SheetHeader>

        <SheetBody className="flex flex-col gap-8">
          {loading ? (
            <div aria-busy="true" className="flex flex-col gap-6">
              <SkeletonStatus />
              <Skeleton className="h-16 w-48" />
              <SkeletonTable rows={4} columns={3} />
            </div>
          ) : error ? (
            <ErrorState size="sm" description={error} onRetry={() => setAttempt((n) => n + 1)} />
          ) : !detail ? (
            <EmptyState size="sm" title="Sin datos de esta mesa" />
          ) : (
            <>
              <KPI
                label="Total cobrado"
                value={<Amount cents={detail.total_cents} decimals={0} />}
              />

              {detail.customers.length > 0 ? (
                <Section
                  title={`Comensales registrados (${formatNumber(detail.customers.length)})`}
                  headingLevel={3}
                >
                  <DataTable
                    caption="Comensales registrados"
                    rows={detail.customers}
                    getRowId={(c) => `${c.phone ?? ''}-${c.first_name ?? ''}-${c.last_name ?? ''}`}
                    columns={[
                      { id: 'nombre', header: 'Nombre', cell: (c) => customerName(c) },
                      {
                        id: 'telefono',
                        header: 'Teléfono',
                        mobile: 'secondary',
                        cell: (c) =>
                          c.phone ? (
                            <span className="type-amount text-muted-foreground">{c.phone}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          ),
                      },
                    ]}
                  />
                </Section>
              ) : null}

              <Section title={`Productos (${formatNumber(detail.items.length)})`} headingLevel={3}>
                <DataTable
                  caption="Productos de la mesa"
                  rows={itemsByCategory(detail.items)}
                  getRowId={(it) => it.menu_item_id}
                  density="compact"
                  groupBy={(it) => ({ key: it.category_name, label: it.category_name })}
                  columns={[
                    { id: 'producto', header: 'Producto', cell: (it) => it.name },
                    {
                      id: 'cantidad',
                      header: 'Cant.',
                      numeric: true,
                      mobile: 'secondary',
                      cell: (it) => (
                        <span className="text-muted-foreground">×{formatNumber(it.quantity)}</span>
                      ),
                    },
                    {
                      id: 'total',
                      header: 'Total',
                      numeric: true,
                      cell: (it) => <Amount cents={it.line_total_cents} decimals={0} />,
                    },
                  ]}
                  empty={<EmptyState size="sm" title="Esta mesa no tiene productos cargados" />}
                />
              </Section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
