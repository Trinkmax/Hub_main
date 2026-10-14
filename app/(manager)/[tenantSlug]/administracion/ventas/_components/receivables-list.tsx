import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { LedgerList, LedgerRail, LedgerRow } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { PartyListRow } from '@/lib/accounting/queries/parties'
import { formatCentsShort } from '@/lib/money'
import { receivableMeta, receivableRail, type WalletBox } from '../_lib/incoming'

export function partyDisplayName(row: Pick<PartyListRow, 'partyName' | 'tradeName'>): string {
  return row.tradeName && row.tradeName !== row.partyName ? row.tradeName : row.partyName
}

/** Lo que tiene a favor: el cliente (anticipos, notas de crédito) o la plataforma («le debemos»). */
function creditText(row: PartyListRow): string | null {
  if (row.creditCents <= 0) return null
  const amount = formatCentsShort(row.creditCents)
  return row.partyKind === 'customer' ? `A favor ${amount}` : `Le debemos ${amount}`
}

const ROW_ACTION = 'h-11 rounded-full px-4 md:pointer-fine:h-9'

/**
 * «Quién te debe»: un renglón por tarjeta, app o cliente con algo abierto. En
 * el margen, desde cuándo está atrasado o para cuándo llega; en el centro,
 * quién es y su estado en palabras; a la derecha, cuánto y la acción del
 * momento: «Ya entró» abre la hoja de cobrar con ese pagador elegido. Una
 * billetera con su caja no se cobra: se cuenta («Contar Mercado Pago»).
 *
 * El renglón entero lleva a la ficha; el botón queda por encima del link.
 * Quien solo mira ve los mismos renglones sin botones.
 */
export function ReceivablesList({
  rows,
  wallets,
  base,
  today,
  canWrite,
}: {
  rows: readonly PartyListRow[]
  /** Los pagadores que son una billetera con su caja. */
  wallets: ReadonlyMap<string, WalletBox>
  /** `/<bar>/administracion`. */
  base: string
  today: string
  canWrite: boolean
}) {
  return (
    <LedgerList aria-label="Quién te debe" bare>
      {rows.map((row) => {
        const wallet = wallets.get(row.partyId) ?? null
        const rail = receivableRail(row, { today, wallet: wallet !== null })
        const name = partyDisplayName(row)
        const kind = PARTY_KIND_LABELS[row.partyKind] ?? 'Cliente'
        const state = receivableMeta(row, { today, walletName: wallet?.name ?? null })
        return (
          <LedgerRow
            key={row.partyId}
            href={`${base}/ventas/clientes/${row.partyId}`}
            title={name}
            muted={!row.active}
            rail={
              rail.kind === 'wallet' ? (
                <LedgerRail icon={Wallet} unit={rail.unit} tone={rail.tone} />
              ) : (
                <LedgerRail
                  label={rail.label}
                  value={rail.value}
                  unit={rail.unit}
                  tone={rail.tone}
                />
              )
            }
            meta={state ? `${kind} · ${state}` : kind}
            amount={
              row.debtCents > 0 ? (
                <Amount
                  cents={row.debtCents}
                  decimals={0}
                  className="font-serif text-lg font-semibold"
                />
              ) : (
                <span className="text-xs font-normal text-muted-foreground">Sin deuda</span>
              )
            }
            amountNote={creditText(row)}
            action={
              canWrite && row.debtCents > 0 ? (
                wallet ? (
                  <ActionButton
                    action="ajustar"
                    params={{ caja: wallet.treasuryId }}
                    variant="outline"
                    className={ROW_ACTION}
                  >
                    Contar {wallet.name}
                  </ActionButton>
                ) : (
                  <ActionButton
                    action="cobrar"
                    params={{ cliente: row.partyId }}
                    variant="outline"
                    className={ROW_ACTION}
                    aria-label={`Ya entró: anotar lo que pagó ${name}`}
                  >
                    Ya entró
                  </ActionButton>
                )
              ) : undefined
            }
          />
        )
      })}
    </LedgerList>
  )
}

/** Los que no tienen nada abierto: solo sus nombres, como links a la ficha. */
export function SettledParties({ rows, base }: { rows: readonly PartyListRow[]; base: string }) {
  if (rows.length === 0) return null
  return (
    <details className="group/fold border-t border-border/60 pt-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[11px] tabular-nums">
          {rows.length}
        </span>
        sin nada pendiente
      </summary>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-sm">
        {rows.map((row) => (
          <li key={row.partyId}>
            <Link
              href={`${base}/ventas/clientes/${row.partyId}`}
              className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-8"
            >
              {partyDisplayName(row)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}
