import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh, PTotalRow, ROW_ACTION } from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import type { PartyListRow } from '@/lib/accounting/queries/parties'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { receivableArrival, type WalletBox } from '../_lib/incoming'

export function partyDisplayName(row: Pick<PartyListRow, 'partyName' | 'tradeName'>): string {
  return row.tradeName && row.tradeName !== row.partyName ? row.tradeName : row.partyName
}

/** Lo que tiene a favor: el cliente (anticipos, notas de crédito) o la plataforma («le debemos»). */
function creditText(row: PartyListRow): string | null {
  if (row.creditCents <= 0) return null
  const amount = formatCentsShort(row.creditCents)
  return row.partyKind === 'customer' ? `A favor ${amount}` : `Le debemos ${amount}`
}

const NAME_LINK =
  'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «Por cobrar»: un renglón por tarjeta, app o cliente con algo abierto. Quién, cuándo llega y
 * cuánto, y la acción del momento: «Ya entró» abre la hoja de cobrar con ese pagador elegido. Una
 * billetera con su caja no se cobra: se cuenta («Contar Mercado Pago»).
 *
 * El nombre lleva a la ficha. Quien solo mira ve los mismos renglones sin botones.
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
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.debtCents), 0)
  return (
    <PTable minWidth={520} label="Quién te debe">
      <thead>
        <tr>
          <PTh>Quién</PTh>
          <PTh>Llega</PTh>
          <PTh align="right">A cobrar</PTh>
          {canWrite ? (
            <PTh>
              <span className="sr-only">Qué hacer</span>
            </PTh>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const wallet = wallets.get(row.partyId) ?? null
          const name = partyDisplayName(row)
          const arrival = receivableArrival(row, { today, wallet: wallet !== null })
          const credit = creditText(row)
          return (
            <PRow key={row.partyId} className={row.active ? undefined : 'text-muted-foreground'}>
              <PTd>
                <Link href={`${base}/ventas/clientes/${row.partyId}`} className={NAME_LINK}>
                  {name}
                </Link>
                {row.active ? null : (
                  <small className="block text-xs text-muted-foreground">desactivado</small>
                )}
              </PTd>
              <PTd className="whitespace-nowrap">
                {arrival.kind === 'late' ? (
                  <StatusPill tone="late">{arrival.text}</StatusPill>
                ) : arrival.kind === 'date' ? (
                  arrival.text
                ) : (
                  <span className="text-muted-foreground">{arrival.text}</span>
                )}
                {arrival.note ? (
                  <small className="ml-2 text-xs text-muted-foreground">{arrival.note}</small>
                ) : null}
              </PTd>
              <PTd align="right" className="font-medium">
                {row.debtCents > 0 ? formatCentsShort(row.debtCents) : null}
                {credit ? (
                  <small
                    className={cn(
                      'text-xs font-normal text-muted-foreground',
                      row.debtCents > 0 && 'block',
                    )}
                  >
                    {credit}
                  </small>
                ) : null}
              </PTd>
              {canWrite ? (
                <PTd className="w-[9.5rem] whitespace-nowrap text-right">
                  {row.debtCents <= 0 ? null : wallet ? (
                    <ActionButton
                      action="ajustar"
                      params={{ caja: wallet.treasuryId }}
                      variant="outline"
                      size="sm"
                      className={cn('pointer-coarse:h-10', ROW_ACTION)}
                    >
                      Contar {wallet.name}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      action="cobrar"
                      params={{ cliente: row.partyId }}
                      variant="outline"
                      size="sm"
                      className={cn('pointer-coarse:h-10', ROW_ACTION)}
                      aria-label={`Ya entró: anotar lo que pagó ${name}`}
                    >
                      Ya entró
                    </ActionButton>
                  )}
                </PTd>
              ) : null}
            </PRow>
          )
        })}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd colSpan={2}>Total</PTd>
          <PTd align="right">{formatCentsShort(total)}</PTd>
          {canWrite ? <PTd /> : null}
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}

/** Los que no tienen nada abierto: solo sus nombres, como links a la ficha. */
export function SettledParties({ rows, base }: { rows: readonly PartyListRow[]; base: string }) {
  if (rows.length === 0) return null
  return (
    <details className="group/fold min-w-0">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
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
              className="inline-flex min-h-8 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10"
            >
              {partyDisplayName(row)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}
