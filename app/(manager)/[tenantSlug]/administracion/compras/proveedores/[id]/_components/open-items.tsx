import Link from 'next/link'
import { PRow, PTable, PTd, PTh, PTotalRow, ROW_ACTION } from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import type { OpenItemRow } from '@/lib/accounting/queries/parties'
import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ROW_ACTIONS_CELL, ROW_BUTTON, ROW_LINK } from '../../../_components/planilla-bits'
import { dueRail, type RailWords, railText } from '../../../_lib/libreta'
import { documentHref } from '../../../_lib/links'

/** Con centavos solo si los tiene: la cuenta no redondea lo que se debe. */
function exact(cents: number): string {
  return cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
}

const RAIL_TONE: Readonly<Record<RailWords['tone'], string>> = {
  late: 'text-destructive',
  warn: 'text-warning-text',
  muted: 'text-muted-foreground',
  ok: 'text-success',
}

/** La nota de una compra, si dice algo más que su nombre. El motor anota «Sin comprobante». */
function noteOf(item: OpenItemRow): string | null {
  const memo = item.memo?.trim()
  return memo && memo !== item.documentLabel.trim()
    ? memo.replace(/^sin comprobante\b/i, 'Sin factura')
    : null
}

/**
 * Las compras sin pagar de un proveedor: Comprobante · Del · Vence · Falta y, al pasar, [Pagar], que
 * abre «Pago» con ESA compra tildada (`?partida=`). Toda la fila lleva a su ficha. Si ya se pagó una
 * parte, «de un total de $ X» va debajo del nombre.
 *
 * La contadora ve las filas sin el botón (`canWrite={false}`).
 */
export function DebtItems({
  tenantSlug,
  partyId,
  items,
  totalCents,
  today,
  canWrite,
}: {
  tenantSlug: string
  partyId: string
  items: readonly OpenItemRow[]
  /** Σ de lo pendiente: la fila del total. */
  totalCents: number
  today: string
  canWrite: boolean
}) {
  return (
    <PTable label="Compras sin pagar" minWidth={canWrite ? 620 : 520}>
      <thead>
        <tr>
          <PTh>Comprobante</PTh>
          <PTh>Del</PTh>
          <PTh>Vence</PTh>
          <PTh align="right">Falta</PTh>
          {canWrite ? (
            <PTh>
              <span className="sr-only">Acciones</span>
            </PTh>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const rail = dueRail(item.dueDate, today)
          const note = noteOf(item)
          const partial = item.openCents !== item.amountCents
          return (
            <PRow key={item.lineId} className="relative">
              <PTd>
                <Link href={documentHref(tenantSlug, item.documentId)} className={ROW_LINK}>
                  <VoucherText text={item.documentLabel} />
                </Link>
                {partial || note ? (
                  <span className="block text-xs text-muted-foreground">
                    {partial ? `de un total de ${formatCentsShort(item.amountCents)}` : null}
                    {partial && note ? ' · ' : null}
                    {note}
                  </span>
                ) : null}
              </PTd>
              <PTd className="whitespace-nowrap text-muted-foreground">
                {formatDayMonth(item.entryDate)}
              </PTd>
              <PTd className={cn('whitespace-nowrap', RAIL_TONE[rail.tone])}>{railText(rail)}</PTd>
              <PTd align="right" className="font-medium">
                {exact(item.openCents)}
              </PTd>
              {canWrite ? (
                <PTd className={ROW_ACTIONS_CELL}>
                  <span className={cn('inline-flex', ROW_ACTION)}>
                    <ActionButton
                      action="pagar"
                      params={{ proveedor: partyId, partida: item.lineId }}
                      variant="outline"
                      size="sm"
                      className={ROW_BUTTON}
                      aria-label={`Pagar ${item.documentLabel}`}
                    >
                      Pagar
                    </ActionButton>
                  </span>
                </PTd>
              ) : null}
            </PRow>
          )
        })}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd colSpan={3}>Total</PTd>
          <PTd align="right">{exact(totalCents)}</PTd>
          {canWrite ? <PTd /> : null}
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}

/**
 * Lo que el proveedor tiene a tu favor (una nota de crédito, plata que le adelantaste): se descuenta
 * solo en el próximo pago.
 */
export function CreditItems({
  tenantSlug,
  items,
}: {
  tenantSlug: string
  items: readonly OpenItemRow[]
}) {
  return (
    <PTable label="A tu favor" minWidth={420}>
      <thead>
        <tr>
          <PTh>Comprobante</PTh>
          <PTh>Del</PTh>
          <PTh align="right">A favor</PTh>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <PRow key={item.lineId} className="relative">
            <PTd>
              <Link href={documentHref(tenantSlug, item.documentId)} className={ROW_LINK}>
                <VoucherText text={item.documentLabel} />
              </Link>
              {item.openCents !== item.amountCents ? (
                <span className="block text-xs text-muted-foreground">
                  de un total de {formatCentsShort(item.amountCents)}
                </span>
              ) : null}
            </PTd>
            <PTd className="whitespace-nowrap text-muted-foreground">
              {formatDayMonth(item.entryDate)}
            </PTd>
            <PTd align="right" className="font-medium text-success">
              {exact(item.openCents)}
            </PTd>
          </PRow>
        ))}
      </tbody>
    </PTable>
  )
}
