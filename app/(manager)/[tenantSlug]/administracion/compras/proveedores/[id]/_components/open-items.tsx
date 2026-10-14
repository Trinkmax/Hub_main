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
 * «del 10/09 · de un total de $ 1.210.000»: en una hoja ancha, en un renglón; en una
 * angosta (el celular), la fecha arriba y el total abajo, sin el punto. Cada parte va
 * entera: antes se partía «del» solo en un renglón y «10/09 · de un total…» en el otro.
 */
function DateAndTotal({ date, totalCents }: { date: string; totalCents: number | null }) {
  return (
    <span className="tabular-nums">
      <span className="whitespace-nowrap">del {formatDayMonth(date)}</span>
      {totalCents !== null ? (
        <>
          <span className="@max-[28rem]/ledger:hidden"> · </span>
          <span className="whitespace-nowrap @max-[28rem]/ledger:block">
            de un total de {formatCentsShort(totalCents)}
          </span>
        </>
      ) : null}
    </span>
  )
}

/**
 * Las compras sin pagar de un proveedor, como renglones de su libreta: en el
 * margen, cuándo vence (las mismas palabras que en la portada); en el medio, el
 * papel y de cuándo es; a la derecha, lo que falta pagar y [Pagar], que abre
 * «Pagar» con ESA compra tildada (`?partida=`).
 *
 * Si ya se pagó una parte, «de un total de $ X» va con la fecha y no debajo del
 * importe: así el bloque de la derecha mide lo mismo en todos los renglones. En
 * una hoja angosta (el celular) el importe baja a la línea de [Pagar], en TODOS
 * los renglones: el papel se lee entero en un renglón y los importes quedan en
 * columna, sin unos al lado del nombre y otros debajo.
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
        // El motor anota «Sin comprobante»: la palabra del dueño es «Sin factura».
        const note =
          memo && memo !== item.documentLabel.trim()
            ? memo.replace(/^sin comprobante\b/i, 'Sin factura')
            : null
        const amount = (
          <Amount cents={item.openCents} decimals={exact(item.openCents)} className="text-base" />
        )
        return (
          <LedgerRow
            key={item.lineId}
            rail={<LedgerRail {...rail} />}
            title={<VoucherText text={item.documentLabel} />}
            href={documentHref(tenantSlug, item.documentId)}
            meta={
              <>
                <DateAndTotal
                  date={item.entryDate}
                  totalCents={partial ? item.amountCents : null}
                />
                {note ? <span> · {note}</span> : null}
              </>
            }
            // Con [Pagar], en una hoja angosta el importe no va acá: baja a la línea del botón.
            amount={
              canWrite ? <span className="@max-[28rem]/ledger:hidden">{amount}</span> : amount
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
            // Hoja angosta: «$ 710.000 ………… [Pagar]», el importe a la izquierda de su botón.
            menu={
              canWrite ? (
                <span className="mr-auto text-sm font-medium tabular-nums @[28rem]/ledger:hidden">
                  {amount}
                </span>
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
          meta={
            <DateAndTotal
              date={item.entryDate}
              totalCents={item.openCents !== item.amountCents ? item.amountCents : null}
            />
          }
          amount={
            <Amount cents={item.openCents} decimals={exact(item.openCents)} className="text-base" />
          }
        />
      ))}
    </LedgerList>
  )
}
