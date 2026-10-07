import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight, Gift, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { LedgerEntry, RedemptionListEntry } from '@/lib/points/queries'

export function LedgerTab({
  ledger,
  redemptions,
  balance,
}: {
  ledger: LedgerEntry[]
  redemptions: RedemptionListEntry[]
  balance: number
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              <h3 className="font-display text-sm font-semibold tracking-tight">Movimientos</h3>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">
              {balance.toLocaleString('es-AR')} pts
            </span>
          </div>
        </header>
        {ledger.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Sin movimientos todavía.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {ledger.map((e) => {
              const positive = e.delta > 0
              return (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${positive ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}
                  >
                    {positive ? (
                      <ArrowUpRight className="size-3.5" />
                    ) : (
                      <ArrowDownRight className="size-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{describeReason(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(e.created_at), "d 'de' MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}
                  >
                    {positive ? '+' : ''}
                    {e.delta}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Gift className="size-4 text-primary" />
            <h3 className="font-display text-sm font-semibold tracking-tight">Canjes</h3>
          </div>
        </header>
        {redemptions.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aún no canjeó ninguna recompensa.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {redemptions.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <Gift className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.reward_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(r.redeemed_at), "d 'de' MMM yyyy", { locale: es })}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize">
                  {r.status}
                </Badge>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-destructive">
                  −{r.points_spent}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function describeReason(e: LedgerEntry): string {
  if (e.reason === 'rule_engine') {
    const breakdown = e.payload as unknown as { description: string }[]
    if (Array.isArray(breakdown) && breakdown.length > 0) {
      return `Visita · ${breakdown.map((b) => b.description).join(' + ')}`
    }
    return 'Visita'
  }
  if (e.reason === 'reward_redeem') {
    const payload = e.payload as { reward_name?: string }
    return `Canje · ${payload.reward_name ?? 'recompensa'}`
  }
  return e.reason
}
