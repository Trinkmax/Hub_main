'use client'

import { ChevronDown, History } from 'lucide-react'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import {
  formatDate,
  formatDateTime,
  formatPoints,
  ledgerLabel,
  redemptionStatusMeta,
} from './wallet-format'

// Historial colapsable: canjes + movimientos de puntos. Client island por el
// toggle (no hay primitivo Accordion de shadcn instalado, lo hacemos nativo
// con un <button> + región controlada, accesible vía aria-expanded/controls).

type Redemption = WalletData['redemptions'][number]
type LedgerEntry = WalletData['ledger'][number]

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const positive = entry.delta >= 0
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight">{ledgerLabel(entry.reason)}</p>
        <time dateTime={entry.createdAt} className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(entry.createdAt)}
        </time>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          positive ? 'text-success' : 'text-destructive',
        )}
      >
        {positive ? '+' : '−'}
        {formatPoints(Math.abs(entry.delta))}
      </span>
    </li>
  )
}

function RedemptionRow({ item }: { item: Redemption }) {
  const meta = redemptionStatusMeta(item.status)
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight">{item.rewardName}</p>
        <time dateTime={item.redeemedAt} className="text-xs text-muted-foreground tabular-nums">
          {formatDate(item.redeemedAt)} · −{formatPoints(item.pointsSpent)} pts
        </time>
      </div>
      <Badge variant={meta.variant} className="shrink-0">
        {meta.label}
      </Badge>
    </li>
  )
}

export function HistoryAccordion({
  redemptions,
  ledger,
}: {
  redemptions: Redemption[]
  ledger: LedgerEntry[]
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonId = useId()

  if (redemptions.length === 0 && ledger.length === 0) return null

  return (
    <div className="card-hairline overflow-hidden rounded-2xl border bg-card">
      <h2>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-(--cream-tint) focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <History className="size-4 text-muted-foreground" aria-hidden="true" />
            Movimientos
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-base)]',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      </h2>

      {open ? (
        <section
          id={panelId}
          aria-labelledby={buttonId}
          className="animate-in fade-in slide-in-from-top-1 duration-[var(--duration-base)]"
        >
          <Separator />

          {redemptions.length > 0 ? (
            <div>
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Canjes
              </p>
              <ul className="divide-y divide-border/60">
                {redemptions.map((item) => (
                  <RedemptionRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ) : null}

          {ledger.length > 0 ? (
            <div>
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Puntos
              </p>
              <ul className="divide-y divide-border/60 pb-1">
                {ledger.map((entry) => (
                  <LedgerRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
