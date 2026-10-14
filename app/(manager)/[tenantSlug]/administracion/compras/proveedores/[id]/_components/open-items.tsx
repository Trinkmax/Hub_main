import { Amount } from '@/components/administracion/amount'
import { LedgerList, LedgerRail, LedgerRow } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import type { OpenItemRow } from '@/lib/accounting/queries/parties'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { dueRail } from '../../../_lib/libreta'
import { documentHref } from '../../../_lib/links'

/** Con centavos solo si los tiene. */
function exact(cents: number): 0 | 2 {
  return cents % 100 === 0 ? 0 : 2
}

/**
 * Las compras sin pagar de un proveedor, como renglones de su libreta: en el
 * margen, cuándo vence (las mismas palabras que en la portada); en el medio, el
 * papel y de cuándo es; a la derecha, lo que falta pagar y [Pagar], que abre
 * «Pagar» con ESA compra tildada (`?partida=`).
 *
 * La contadora ve los renglones sin el botón (`canWrite={false}`).
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
  /** Σ de lo pendiente: el pie de la lista. */
  totalCents: number
  today: string
  canWrite: boolean
}) {
  return (
    <LedgerList
      bare
      aria-label="Compras sin pagar"
      footer={
        <p>
          Total: le debés{' '}
          <strong className="font-semibold whitespace-nowrap text-foreground tabular-nums">
            {formatCentsShort(totalCents)}
          </strong>
        </p>
      }
    >
      {items.map((item) => {
        const rail = dueRail(item.dueDate, today)
        const partial = item.openCents !== item.amountCents
        // La nota suele repetir el nombre del papel («Factura A 0003-…»): así no se lee dos veces.
        const memo = item.memo?.trim()
        const note = memo && memo !== item.documentLabel.trim() ? memo : null
        return (
          <LedgerRow
            key={item.lineId}
            rail={<LedgerRail {...rail} />}
            title={<VoucherText text={item.documentLabel} />}
            href={documentHref(tenantSlug, item.documentId)}
            meta={
              <span className="tabular-nums">
                del {formatDayMonth(item.entryDate)}
                {note ? ` · ${note}` : ''}
              </span>
            }
            amount={
              <Amount
                cents={item.openCents}
                decimals={exact(item.openCents)}
                className="text-base"
              />
            }
            amountNote={
              partial ? (
                <span className="whitespace-nowrap">de {formatCentsShort(item.amountCents)}</span>
              ) : undefined
            }
            action={
              canWrite ? (
                <ActionButton
                  action="pagar"
                  params={{ proveedor: partyId, partida: item.lineId }}
                  variant="outline"
                  className="h-11 rounded-full px-5 md:h-9"
                  aria-label={`Pagar ${item.documentLabel}`}
                >
                  Pagar
                </ActionButton>
              ) : undefined
            }
          />
        )
      })}
    </LedgerList>
  )
}

/**
 * Lo que el proveedor tiene a tu favor (una nota de crédito, plata que le
 * adelantaste): se descuenta solo en el próximo pago.
 */
export function CreditItems({
  tenantSlug,
  items,
}: {
  tenantSlug: string
  items: readonly OpenItemRow[]
}) {
  return (
    <LedgerList bare aria-label="A tu favor">
      {items.map((item) => (
        <LedgerRow
          key={item.lineId}
          rail={<LedgerRail label="a tu" value="favor" tone="ok" />}
          title={<VoucherText text={item.documentLabel} />}
          href={documentHref(tenantSlug, item.documentId)}
          meta={<span className="tabular-nums">del {formatDayMonth(item.entryDate)}</span>}
          amount={
            <Amount cents={item.openCents} decimals={exact(item.openCents)} className="text-base" />
          }
          amountNote={
            item.openCents !== item.amountCents ? (
              <span className="whitespace-nowrap">de {formatCentsShort(item.amountCents)}</span>
            ) : undefined
          }
        />
      ))}
    </LedgerList>
  )
}
