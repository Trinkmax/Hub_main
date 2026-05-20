'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatARS } from '@/lib/commissions/calculate'
import { markCommissionPaid } from '@/lib/salon/actions'
import type { CommissionBreakdownEntry } from '@/lib/salon/queries'

export function ManagerCommissionsBreakdown({
  tenantSlug,
  entries,
}: {
  tenantSlug: string
  entries: CommissionBreakdownEntry[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const unpaid = useMemo(() => entries.filter((e) => e.paid_at === null), [entries])

  const totals = useMemo(() => {
    let payable = 0
    let paid = 0
    let pending = 0
    for (const e of entries) {
      payable += e.payable_cents
      if (e.paid_at) paid += e.payable_cents
      else pending += e.payable_cents
    }
    return { payable, paid, pending }
  }, [entries])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === unpaid.length) setSelected(new Set())
    else setSelected(new Set(unpaid.map((e) => e.id)))
  }

  function payNow() {
    if (selected.size === 0) return
    startTransition(async () => {
      const r = await markCommissionPaid(tenantSlug, {
        ledger_ids: Array.from(selected),
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success(r.message ?? 'Marcadas como pagadas.')
        setSelected(new Set())
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total" value={formatARS(totals.payable)} />
        <Stat label="Cobrado" value={formatARS(totals.paid)} tone="muted" />
        <Stat label="Pendiente" value={formatARS(totals.pending)} tone="amber" />
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-amber-50/80 px-3 py-2 text-sm backdrop-blur dark:bg-amber-950/30">
          <span>
            {selected.size} {selected.size === 1 ? 'entry seleccionada' : 'entries seleccionadas'}
          </span>
          <Button size="sm" onClick={payNow} disabled={pending} className="gap-2">
            <Check className="size-4" />
            Marcar como cobradas
          </Button>
        </div>
      ) : null}

      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={selected.size > 0 && selected.size === unpaid.length}
                  onCheckedChange={selectAll}
                  aria-label="Seleccionar todas"
                />
              </th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2 text-right">Personas</th>
              <th className="px-3 py-2 text-right">Tarifa</th>
              <th className="px-3 py-2 text-right">Base</th>
              <th className="px-3 py-2 text-right">Bonus</th>
              <th className="px-3 py-2 text-right">Cobra</th>
              <th className="px-3 py-2 text-right">Split</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {entries.map((e) => {
              const isPaid = !!e.paid_at
              const noActual = e.reservation.actual_guests === null
              return (
                <tr key={e.id} className={isPaid ? 'opacity-70' : ''}>
                  <td className="px-3 py-2 align-middle">
                    {!isPaid ? (
                      <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {e.reservation.reservation_date}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/${tenantSlug}/reservas/${e.reservation.id}`}
                      className="hover:underline"
                    >
                      {e.reservation.guest_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {e.guests_billed}
                    {noActual ? (
                      <span
                        className="ml-1 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                        title="Sin cantidad real cargada"
                      >
                        est
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatARS(e.base_rate_per_guest_cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatARS(e.base_total_cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {e.bonus_total_cents > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        +{formatARS(e.bonus_total_cents)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {formatARS(e.payable_cents)}
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">
                    {e.split_factor_denominator === 1
                      ? '100%'
                      : `${e.split_factor_numerator}/${e.split_factor_denominator}`}
                  </td>
                  <td className="px-3 py-2">
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        <Check className="size-3" />
                        Cobrada
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'muted' | 'amber' }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === 'amber'
          ? 'border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20'
          : 'border-border/60 bg-card/60'
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
