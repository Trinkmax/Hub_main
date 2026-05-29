'use client'

import { ArrowLeft, Phone, User as UserIcon, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import type { StaffSessionDetail } from '@/lib/staff-performance/queries'

function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function StaffSessionDetailDrawer({
  open,
  onOpenChange,
  sessionId,
  onBack,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionId: string | null
  onBack: () => void
}) {
  const [detail, setDetail] = useState<StaffSessionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !sessionId) return
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
          setError('No se pudo cargar el detalle.')
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
  }, [open, sessionId])

  const itemsByCategory = (detail?.items ?? []).reduce((acc, it) => {
    const arr = acc.get(it.category_name) ?? []
    arr.push(it)
    acc.set(it.category_name, arr)
    return acc
  }, new Map<string, StaffSessionDetail['items']>())

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
              <ArrowLeft className="size-3.5" aria-hidden />
              Volver
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <>
              <header className="space-y-1">
                <h3 className="font-serif text-2xl font-semibold tracking-tight">
                  {detail.alias ?? `Mesa ${detail.table_label ?? ''}`}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {detail.alias && detail.table_label ? (
                    <span className="mr-1">Mesa {detail.table_label} · </span>
                  ) : null}
                  Abierta {fmtDateTime(detail.opened_at)} →{' '}
                  {detail.paid_at ? fmtDateTime(detail.paid_at) : 'sin cierre'}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {detail.party_size !== null ? (
                    <Badge variant="secondary" className="gap-1">
                      <Users className="size-3" aria-hidden />
                      {detail.party_size} pax
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {detail.staff_user_ids.length} mozo
                    {detail.staff_user_ids.length === 1 ? '' : 's'} atribuid
                    {detail.staff_user_ids.length === 1 ? 'o' : 'os'}
                  </Badge>
                </div>
              </header>

              <section className="card-hairline rounded-xl border border-border/70 bg-card/85 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total cobrado
                </p>
                <p className="font-serif text-3xl font-semibold tabular-nums">
                  {fmt(detail.total_cents)}
                </p>
              </section>

              {detail.customers.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Comensales registrados ({detail.customers.length})
                  </h4>
                  <ul className="space-y-1.5">
                    {detail.customers.map((c) => (
                      <li
                        key={`${c.phone ?? ''}-${c.first_name ?? ''}-${c.last_name ?? ''}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <UserIcon className="size-3.5 text-muted-foreground" aria-hidden />
                        <span className="font-medium">
                          {c.first_name ?? ''} {c.last_name ?? ''}
                        </span>
                        {c.phone ? (
                          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="size-3" aria-hidden />
                            {c.phone}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Productos llevados ({detail.items.length})
                </h4>
                {detail.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin productos cargados.</p>
                ) : (
                  <div className="space-y-4">
                    {Array.from(itemsByCategory.entries()).map(([category, items]) => (
                      <div key={category}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary/70">
                          {category}
                        </p>
                        <ul className="space-y-1">
                          {items.map((it) => (
                            <li
                              key={it.menu_item_id}
                              className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-sm"
                            >
                              <span className="grow truncate">{it.name}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                ×{it.quantity}
                              </span>
                              <span className="w-20 shrink-0 text-right font-medium tabular-nums">
                                {fmt(it.line_total_cents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
