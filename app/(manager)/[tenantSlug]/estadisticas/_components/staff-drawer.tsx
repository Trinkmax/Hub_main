'use client'

import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { Section } from '@/components/ui/section'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatNumber } from '@/lib/format/number-kind'
import type { StaffSessionSummary, StaffSummaryRow } from '@/lib/staff-performance/queries'
import { elapsed, shortDateTime } from './format'
import { RowButton } from './row-button'
import { StaffSessionDetailDrawer } from './staff-session-detail-drawer'

function tableName(s: Pick<StaffSessionSummary, 'alias' | 'table_label'>): string {
  return s.alias ?? `Mesa ${s.table_label ?? ''}`.trim()
}

export function StaffDrawer({
  open,
  onOpenChange,
  staff,
  tenantId,
  preset,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  staff: StaffSummaryRow | null
  tenantId: string
  preset: string
}) {
  const [sessions, setSessions] = useState<StaffSessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sube con «Reintentar»: vuelve a correr la carga sin cerrar el cajón.
  const [attempt, setAttempt] = useState(0)

  const [detailSession, setDetailSession] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !staff) return
    void attempt
    let cancelled = false
    setLoading(true)
    setSessions([])
    setError(null)
    void (async () => {
      try {
        const params = new URLSearchParams({
          tenant_id: tenantId,
          user_id: staff.user_id,
          preset,
        })
        const res = await fetch(`/api/staff/sessions?${params.toString()}`, {
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setError('No pudimos cargar las mesas.')
          return
        }
        const data = (await res.json()) as { sessions: StaffSessionSummary[] }
        setSessions(data.sessions)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error inesperado.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, staff, tenantId, preset, attempt])

  const name = staff ? (staff.full_name ?? staff.email) : ''

  return (
    <>
      <Sheet open={open && detailSession === null} onOpenChange={onOpenChange}>
        <SheetContent side="right" size="lg">
          <SheetHeader>
            <SheetTitle>{name || 'Mozo'}</SheetTitle>
            {staff?.full_name ? (
              <SheetDescription>{staff.email}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Mesas atendidas en el período</SheetDescription>
            )}
          </SheetHeader>
          <SheetBody className="flex flex-col gap-8">
            {staff ? (
              <>
                <KPIGroup columns={4}>
                  <KPI label="Mesas" value={formatNumber(staff.sessions_count)} />
                  <KPI
                    label="Comensales"
                    value={formatNumber(Math.round(staff.party_size_share))}
                  />
                  <KPI
                    label="Ventas"
                    value={<Amount cents={staff.revenue_share_cents} decimals={0} />}
                  />
                  <KPI label="Ítems" value={formatNumber(Math.round(staff.items_share))} />
                </KPIGroup>

                <Section
                  title="Mesas atendidas"
                  description="Tocá una para ver quiénes estaban y qué se llevaron."
                  headingLevel={3}
                >
                  <DataTable
                    caption={`Mesas atendidas por ${name}`}
                    rows={sessions}
                    getRowId={(s) => s.session_id}
                    loading={loading}
                    error={
                      error ? { message: error, onRetry: () => setAttempt((n) => n + 1) } : null
                    }
                    columns={[
                      {
                        id: 'mesa',
                        header: 'Mesa',
                        cell: (s) => (
                          <RowButton
                            onClick={() => setDetailSession(s.session_id)}
                            aria-haspopup="dialog"
                            className="flex min-w-0 flex-col"
                          >
                            <span className="truncate font-medium text-foreground">
                              {tableName(s)}
                            </span>
                            <span className="type-small font-normal text-muted-foreground">
                              {s.alias && s.table_label ? `Mesa ${s.table_label} · ` : null}
                              <span className="type-amount">{shortDateTime(s.paid_at)}</span>
                              {s.paid_at ? ` · ${elapsed(s.opened_at, s.paid_at)}` : null}
                            </span>
                          </RowButton>
                        ),
                      },
                      {
                        id: 'comensales',
                        header: 'Comensales',
                        align: 'end',
                        mobile: 'meta',
                        cell: (s) => (
                          <span className="inline-flex flex-wrap justify-end gap-1.5">
                            {s.party_size !== null ? (
                              <Badge icon={Users}>
                                {formatNumber(s.party_size)}{' '}
                                {s.party_size === 1 ? 'persona' : 'personas'}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {s.staff_count > 1 ? (
                              <Badge appearance="outline">{s.staff_count} mozos</Badge>
                            ) : null}
                          </span>
                        ),
                      },
                      {
                        id: 'total',
                        header: 'Total',
                        numeric: true,
                        cell: (s) => (
                          <span className="inline-flex flex-col items-end">
                            <Amount cents={s.total_cents} decimals={0} className="font-medium" />
                            {s.staff_count > 1 ? (
                              <span className="type-caption font-normal text-muted-foreground">
                                su parte <Amount cents={s.share_cents} decimals={0} />
                              </span>
                            ) : null}
                          </span>
                        ),
                      },
                    ]}
                    empty={
                      <EmptyState
                        size="sm"
                        title="Sin mesas en este período"
                        description="Probá con un período más largo."
                      />
                    }
                  />
                </Section>
              </>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <StaffSessionDetailDrawer
        open={detailSession !== null}
        onOpenChange={(next) => {
          if (!next) setDetailSession(null)
        }}
        sessionId={detailSession}
        onBack={() => setDetailSession(null)}
        backLabel={name}
      />
    </>
  )
}
