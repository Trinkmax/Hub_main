import { Gift, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import { MINUS_SIGN } from '@/lib/money/format'
import type { LedgerEntry, RedemptionListEntry } from '@/lib/points/queries'
import { REDEMPTION_STATUS, type RedemptionStatus } from '../../_components/customer-meta'

/** «+10» o «−5»: el signo siempre a la vista (el color acompaña, nunca es la única señal). */
function signedPoints(delta: number): string {
  if (delta > 0) return `+${formatNumber(delta)}`
  if (delta < 0) return `${MINUS_SIGN}${formatNumber(Math.abs(delta))}`
  return '0'
}

/**
 * La cuenta de puntos del cliente: movimientos (lo que sumó y gastó) y canjes.
 * Server Component; cada lista es una `DataTable` con tarjetas en el celular.
 */
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
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
      <Section
        title="Movimientos"
        headingLevel={3}
        actions={
          <Badge tone="gold" size="md" className="type-amount">
            Saldo: {formatNumber(balance)} pts
          </Badge>
        }
      >
        <DataTable<LedgerEntry>
          caption="Movimientos de puntos"
          rows={ledger}
          getRowId={(e) => e.id}
          empty={
            <EmptyState
              size="sm"
              icon={Wallet}
              title="Sin movimientos todavía"
              description="Cada visita que suma puntos y cada canje aparecen acá."
            />
          }
          columns={[
            {
              id: 'detalle',
              header: 'Detalle',
              mobile: 'primary',
              cell: (e) => describeReason(e),
            },
            {
              id: 'fecha',
              header: 'Fecha',
              mobile: 'secondary',
              cell: (e) => (
                <span className="type-amount text-muted-foreground">
                  {formatDateTime(e.created_at)}
                </span>
              ),
            },
            {
              id: 'puntos',
              header: 'Puntos',
              numeric: true,
              width: '6rem',
              cell: (e) => (
                <span
                  className={
                    e.delta > 0
                      ? 'font-semibold text-success-text'
                      : e.delta < 0
                        ? 'font-semibold text-destructive-text'
                        : 'text-muted-foreground'
                  }
                >
                  {signedPoints(e.delta)}
                </span>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Canjes" headingLevel={3}>
        <DataTable<RedemptionListEntry>
          caption="Canjes de recompensas"
          rows={redemptions}
          getRowId={(r) => r.id}
          empty={
            <EmptyState
              size="sm"
              icon={Gift}
              title="Todavía no canjeó nada"
              description="Cuando cambie puntos por una recompensa, el canje queda acá."
            />
          }
          columns={[
            {
              id: 'recompensa',
              header: 'Recompensa',
              mobile: 'primary',
              cell: (r) => r.reward_name,
            },
            {
              id: 'fecha',
              header: 'Fecha',
              mobile: 'secondary',
              cell: (r) => (
                <span className="type-amount text-muted-foreground">
                  {formatDate(r.redeemed_at)}
                </span>
              ),
            },
            {
              id: 'estado',
              header: 'Estado',
              mobile: 'meta',
              cell: (r) => (
                <StatusBadge status={r.status as RedemptionStatus} map={REDEMPTION_STATUS} />
              ),
            },
            {
              id: 'puntos',
              header: 'Puntos',
              numeric: true,
              width: '6rem',
              cell: (r) => (
                <span className="font-semibold text-destructive-text">
                  {signedPoints(-r.points_spent)}
                </span>
              ),
            },
          ]}
        />
      </Section>
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
