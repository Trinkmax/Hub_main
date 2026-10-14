import { HandCoins } from 'lucide-react'
import { Amount } from '@/components/administracion/amount'
import {
  EmptyTeach,
  LedgerGroup,
  LedgerList,
  LedgerRail,
  LedgerRow,
  type LedgerTone,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import type { OpenItemRow } from '@/lib/accounting/queries/parties'
import { formatDayMonth, MONTH_NAMES_SHORT, WEEKDAY_NAMES_SHORT, weekdayOf } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { groupOpenItems, itemArrival } from '../../../_lib/incoming'

const ROW_ACTION = 'h-11 rounded-full px-4 md:pointer-fine:h-9'

/** El margen de una partida: el día que llega (o que tenía que llegar). */
function ArrivalRail({ dueDate, today }: { dueDate: string | null; today: string }) {
  if (!dueDate) return <LedgerRail value="—" />
  if (dueDate === today) return <LedgerRail label="llega" value="hoy" tone="ok" />
  const tone: LedgerTone = dueDate < today ? 'late' : 'muted'
  return (
    <LedgerRail
      label={MONTH_NAMES_SHORT[Number(dueDate.slice(5, 7)) - 1] ?? ''}
      value={dueDate.slice(8, 10)}
      unit={WEEKDAY_NAMES_SHORT[weekdayOf(dueDate)] ?? ''}
      tone={tone}
    />
  )
}

/**
 * «Lo pendiente» de quien te debe: sus ventas sin cobrar, agrupadas por cuándo
 * llegan (ya tendría que haber llegado · llega esta semana · más adelante),
 * cada grupo con su subtotal. Cada partida lleva a su comprobante y tiene su
 * «Ya entró», que abre la hoja de cobrar con esa venta tildada. Debajo, lo que
 * tiene a favor (sin botón: se usa al cobrar).
 *
 * Quien solo mira ve las mismas partidas sin ningún botón.
 */
export function OpenItems({
  name,
  partyId,
  debtItems,
  creditItems,
  methodNames,
  today,
  base,
  isCustomer,
  canCollect,
}: {
  /** Cómo se llama quien te debe. */
  name: string
  partyId: string
  debtItems: readonly OpenItemRow[]
  creditItems: readonly OpenItemRow[]
  /** El nombre de cada medio de cobro, por id. */
  methodNames: ReadonlyMap<string, string>
  today: string
  /** `/<bar>/administracion`. */
  base: string
  isCustomer: boolean
  canCollect: boolean
}) {
  if (debtItems.length === 0 && creditItems.length === 0) {
    return (
      <EmptyTeach icon={HandCoins} title="No hay nada pendiente">
        {name} no te debe nada y no tiene saldos a favor.
      </EmptyTeach>
    )
  }
  const groups = groupOpenItems(debtItems, today)
  const itemTitle = (item: OpenItemRow): string => {
    const method = item.salesMethodId ? methodNames.get(item.salesMethodId) : undefined
    return method ? `${method} · venta del ${formatDayMonth(item.entryDate)}` : item.documentLabel
  }

  return (
    <LedgerList aria-label={`Lo pendiente de ${name}`}>
      {groups.map((group) => (
        <LedgerGroup
          key={group.key}
          title={group.title}
          count={group.items.length}
          aside={formatCentsShort(group.totalCents)}
          footer={
            group.key === 'late' && canCollect && group.items.length > 1 ? (
              <ActionButton
                action="cobrar"
                params={{ cliente: partyId }}
                variant="outline"
                className={ROW_ACTION}
              >
                Ya entró todo lo atrasado
              </ActionButton>
            ) : undefined
          }
        >
          {group.items.map((item) => {
            const title = itemTitle(item)
            return (
              <LedgerRow
                key={item.lineId}
                href={`${base}/comprobantes/${item.documentId}`}
                title={title}
                rail={<ArrivalRail dueDate={item.dueDate} today={today} />}
                meta={
                  [
                    title === item.documentLabel ? null : item.documentLabel,
                    // La leyenda suele ser el mismo medio que ya dice el título.
                    item.memo && !title.startsWith(item.memo) ? item.memo : null,
                    isCustomer
                      ? item.dueDate
                        ? item.dueDate < today
                          ? `venció el ${formatDayMonth(item.dueDate)}`
                          : `vence el ${formatDayMonth(item.dueDate)}`
                        : null
                      : itemArrival(item.dueDate, today),
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                amount={
                  <Amount
                    cents={item.openCents}
                    decimals={0}
                    className="font-serif text-lg font-semibold"
                  />
                }
                action={
                  canCollect ? (
                    <ActionButton
                      action="cobrar"
                      params={{ cliente: partyId, partida: item.lineId }}
                      variant="outline"
                      className={ROW_ACTION}
                      aria-label={`Ya entró: ${title}`}
                    >
                      Ya entró
                    </ActionButton>
                  ) : undefined
                }
              />
            )
          })}
        </LedgerGroup>
      ))}
      {creditItems.length > 0 ? (
        <LedgerGroup
          title={isCustomer ? 'Saldos a favor del cliente' : 'Lo que le debemos'}
          count={creditItems.length}
          aside={formatCentsShort(creditItems.reduce((sum, item) => sum + item.openCents, 0))}
          footer={
            isCustomer
              ? 'Se usan al anotar un cobro («Usar saldo a favor»).'
              : 'Se descuenta en la próxima liquidación, al anotar el cobro.'
          }
        >
          {creditItems.map((item) => (
            <LedgerRow
              key={item.lineId}
              href={`${base}/comprobantes/${item.documentId}`}
              title={item.documentLabel}
              rail={
                <LedgerRail
                  label={MONTH_NAMES_SHORT[Number(item.entryDate.slice(5, 7)) - 1] ?? ''}
                  value={item.entryDate.slice(8, 10)}
                  unit={WEEKDAY_NAMES_SHORT[weekdayOf(item.entryDate)] ?? ''}
                />
              }
              meta={item.memo ?? undefined}
              amount={
                <Amount
                  cents={item.openCents}
                  decimals={0}
                  className="font-serif text-lg font-semibold"
                />
              }
            />
          ))}
        </LedgerGroup>
      ) : null}
    </LedgerList>
  )
}
