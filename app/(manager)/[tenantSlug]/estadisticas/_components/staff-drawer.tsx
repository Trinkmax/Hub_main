'use client'

import { ChevronRight, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import type { StaffSessionSummary, StaffSummaryRow } from '@/lib/staff-performance/queries'
import { StaffSessionDetailDrawer } from './staff-session-detail-drawer'

function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function elapsed(opened: string, paid: string | null): string {
  if (!paid) return ''
  const ms = new Date(paid).getTime() - new Date(opened).getTime()
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
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

  const [detailSession, setDetailSession] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !staff) return
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
          setError('No se pudieron cargar las mesas.')
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
  }, [open, staff, tenantId, preset])

  return (
    <>
      <Sheet open={open && detailSession === null} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {staff ? (
            <div className="space-y-5">
              <header className="space-y-1">
                <h3 className="font-serif text-2xl font-semibold tracking-tight">
                  {staff.full_name ?? staff.email}
                </h3>
                {staff.full_name ? (
                  <p className="text-sm text-muted-foreground">{staff.email}</p>
                ) : null}
              </header>

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card-hairline rounded-lg border border-border/70 bg-card/85 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Mesas
                  </p>
                  <p className="font-serif text-xl font-semibold tabular-nums">
                    {staff.sessions_count}
                  </p>
                </div>
                <div className="card-hairline rounded-lg border border-border/70 bg-card/85 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Comensales
                  </p>
                  <p className="font-serif text-xl font-semibold tabular-nums">
                    {Math.round(staff.party_size_share)}
                  </p>
                </div>
                <div className="card-hairline rounded-lg border border-border/70 bg-card/85 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Ventas
                  </p>
                  <p className="font-serif text-xl font-semibold tabular-nums">
                    {fmt(staff.revenue_share_cents)}
                  </p>
                </div>
                <div className="card-hairline rounded-lg border border-border/70 bg-card/85 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Ítems
                  </p>
                  <p className="font-serif text-xl font-semibold tabular-nums">
                    {Math.round(staff.items_share)}
                  </p>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mesas atendidas
                </h4>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin mesas en este rango.</p>
                ) : (
                  <ul className="space-y-2">
                    {sessions.map((s) => (
                      <li key={s.session_id}>
                        <button
                          type="button"
                          onClick={() => setDetailSession(s.session_id)}
                          className="card-hairline group flex w-full items-center gap-3 rounded-lg border border-border/70 bg-card/85 p-3 text-left transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
                        >
                          <div className="min-w-0 grow">
                            <p className="truncate font-medium">
                              {s.alias ?? `Mesa ${s.table_label ?? ''}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {s.alias && s.table_label ? (
                                <span className="mr-1">Mesa {s.table_label} · </span>
                              ) : null}
                              {s.paid_at
                                ? new Date(s.paid_at).toLocaleString('es-AR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                              {' · '}
                              {elapsed(s.opened_at, s.paid_at)}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {s.party_size !== null ? (
                                <Badge variant="secondary" className="gap-1">
                                  <Users className="size-3" aria-hidden />
                                  {s.party_size} pax
                                </Badge>
                              ) : null}
                              {s.staff_count > 1 ? (
                                <Badge variant="outline" className="text-[10px]">
                                  ×{s.staff_count} mozos
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-serif text-sm font-semibold tabular-nums">
                              {fmt(s.total_cents)}
                            </p>
                            {s.staff_count > 1 ? (
                              <p className="text-[11px] text-muted-foreground">
                                tu parte {fmt(s.share_cents)}
                              </p>
                            ) : null}
                          </div>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <StaffSessionDetailDrawer
        open={detailSession !== null}
        onOpenChange={(next) => {
          if (!next) setDetailSession(null)
        }}
        sessionId={detailSession}
        onBack={() => setDetailSession(null)}
      />
    </>
  )
}
