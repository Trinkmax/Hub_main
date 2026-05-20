'use client'

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { cn } from '@/lib/utils'

function shiftYM(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1, 1))
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function ScheduledEventsMonth({
  tenantSlug,
  ym,
  events,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
}) {
  const router = useRouter()

  const grid = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    if (!y || !m) return []
    const firstDay = new Date(Date.UTC(y, m - 1, 1))
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    // Ajuste a Lunes (PG hace Sunday=0; queremos Mon=0)
    const firstDow = (firstDay.getUTCDay() + 6) % 7
    const cells: Array<{ date: string | null; events: ScheduledEventWithTemplate[] }> = []
    for (let i = 0; i < firstDow; i++) cells.push({ date: null, events: [] })
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${ym}-${String(d).padStart(2, '0')}`
      const dayEvents = events.filter((e) => e.event_date === dateStr)
      cells.push({ date: dateStr, events: dayEvents })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, events: [] })
    return cells
  }, [ym, events])

  function gotoMonth(next: string) {
    router.push(`/${tenantSlug}/eventos/programados?month=${next}`)
  }

  return (
    <div className="card-hairline rounded-2xl border bg-card p-3 sm:p-5">
      <header className="mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Mes anterior"
          onClick={() => gotoMonth(shiftYM(ym, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="font-serif text-xl font-semibold capitalize">{formatYM(ym)}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Mes siguiente"
          onClick={() => gotoMonth(shiftYM(ym, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </header>
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {DOW_LABELS.map((d) => (
          <div
            key={d}
            className="px-1 py-1 text-center uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {grid.map((cell, idx) => (
          <div
            key={cell.date ?? `pad-${idx}`}
            className={cn(
              'min-h-[88px] rounded-lg border p-1.5',
              cell.date
                ? 'border-border/60 bg-card/40 hover:bg-secondary/40'
                : 'border-transparent bg-transparent',
            )}
          >
            {cell.date ? (
              <div className="flex h-full flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {Number(cell.date.slice(-2))}
                  </span>
                  <Link
                    href={`/${tenantSlug}/eventos/programados/nuevo?date=${cell.date}`}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
                    aria-label={`Programar evento ${cell.date}`}
                  >
                    <Plus className="size-3" />
                  </Link>
                </div>
                <div className="flex flex-col gap-1">
                  {cell.events.map((e) => (
                    <Link
                      key={e.id}
                      href={`/${tenantSlug}/eventos/programados/${e.id}`}
                      className="block rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-snug transition-transform hover:scale-[1.02]"
                      style={{
                        backgroundColor: `${e.template?.color_hex ?? '#7c3aed'}1f`,
                        color: e.template?.color_hex ?? '#7c3aed',
                      }}
                    >
                      <span className="block truncate">
                        {e.name_override ?? e.template?.name ?? 'Evento'}
                      </span>
                      <span className="block text-[10px] opacity-70 tabular-nums">
                        {e.starts_at_local.slice(0, 5)} · {e.capacity}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
