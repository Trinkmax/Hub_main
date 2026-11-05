import { Planilla, PlanillaFoot, PlanillaTitle } from '@/components/administracion/planilla'
import type { PartyPosition } from '@/lib/accounting/queries/parties'
import { formatCentsShort } from '@/lib/money'
import { agingMath } from '../../../_lib/supplier-ledger'
import { ApplyCreditButton } from './apply-credit-button'
import { CreditItems, DebtItems } from './open-items'

/**
 * «Lo que le debés»: todo lo que está sin pagar, sea del período que sea, con su [Pagar]. Debajo, «A
 * tu favor»: lo que se descuenta solo en el próximo pago, con [Usarlo ahora].
 *
 * Sin deuda ni nada a favor no se dibuja: el totalizador ya lo dice. Una compra sin factura se debe
 * igual: suma acá, tiene su vencimiento y se paga igual que las demás.
 */
export function PendingTab({
  tenantSlug,
  partyId,
  position,
  pairs,
  today,
  canWrite,
}: {
  tenantSlug: string
  partyId: string
  position: PartyPosition
  /** Lo que «Usarlo ahora» imputa (`creditPairs`). */
  pairs: ReadonlyArray<{ debitLineId: string; creditLineId: string; amountCents: number }>
  today: string
  canWrite: boolean
}) {
  const debts = position.debtItems
  const credits = position.creditItems
  if (debts.length === 0 && credits.length === 0) return null

  // Los tramos de antigüedad que tienen algo (el total ya está en la tabla).
  const tranches = agingMath(position.aging).filter((row) => !row.total)

  return (
    <section id="le-debes" className="grid gap-3.5">
      {debts.length > 0 ? (
        <Planilla>
          <PlanillaTitle title="Lo que le debés" />
          <DebtItems
            tenantSlug={tenantSlug}
            partyId={partyId}
            items={debts}
            totalCents={position.debtCents}
            today={today}
            canWrite={canWrite}
          />
          {tranches.length > 1 ? (
            <PlanillaFoot className="justify-start gap-x-4 text-xs text-muted-foreground">
              {tranches.map((row) => (
                <span key={row.label} className="whitespace-nowrap">
                  {row.label}:{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCentsShort(row.cents)}
                  </span>
                </span>
              ))}
            </PlanillaFoot>
          ) : null}
        </Planilla>
      ) : null}
      {credits.length > 0 ? (
        <Planilla>
          <PlanillaTitle
            title="A tu favor"
            actions={debts.length > 0 ? <ApplyCreditButton pairs={pairs} /> : undefined}
          />
          <CreditItems tenantSlug={tenantSlug} items={credits} />
          <PlanillaFoot className="text-xs text-muted-foreground">
            Una nota de crédito o plata que le adelantaste. Se descuenta sola en el próximo pago.
          </PlanillaFoot>
        </Planilla>
      ) : null}
    </section>
  )
}
