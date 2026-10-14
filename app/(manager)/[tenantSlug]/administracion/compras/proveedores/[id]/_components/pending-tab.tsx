import { Panel, PanelSection } from '@/components/administracion/kit'
import type { PartyPosition } from '@/lib/accounting/queries/parties'
import { ApplyCreditButton } from './apply-credit-button'
import { CreditItems, DebtItems } from './open-items'

/**
 * «Lo que le debés»: lo accionable de la hoja de un proveedor, lo primero que
 * se ve debajo de la tapa (antes estaba en la segunda pestaña, «Pendientes»).
 * Una compra sin pagar por renglón, con su vencimiento en el margen y [Pagar].
 *
 * Debajo, en el mismo panel, «A tu favor»: lo que se descuenta solo en el
 * próximo pago, con [Usarlo ahora] (reemplaza al aviso azul de arriba).
 *
 * Sin deuda NO se dibuja el panel: la tapa ya dice «No le debés nada» y trae
 * [Cargarle una compra] (y «Dejarle plata a cuenta» en su ⋯); repetirlo acá
 * eran tres «nada» apilados y dos botones principales iguales. Si no le debés
 * pero tenés algo a favor, el panel es solo eso: «A tu favor».
 *
 * Una compra sin factura se debe igual: suma acá, tiene su vencimiento y se
 * paga igual que las demás.
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
  const creditNote =
    'Una nota de crédito o plata que le adelantaste. Se descuenta sola en el próximo pago.'

  if (debts.length === 0) {
    if (credits.length === 0) return null
    return (
      <Panel id="le-debes" title="A tu favor" description={creditNote}>
        <CreditItems tenantSlug={tenantSlug} items={credits} />
      </Panel>
    )
  }

  return (
    <Panel
      id="le-debes"
      title="Lo que le debés"
      description={
        debts.length === 1
          ? 'Una compra sin pagar.'
          : `${debts.length} compras sin pagar, la que vence antes primero.`
      }
    >
      <DebtItems
        tenantSlug={tenantSlug}
        partyId={partyId}
        items={debts}
        totalCents={position.debtCents}
        today={today}
        canWrite={canWrite}
      />

      {credits.length > 0 ? (
        <PanelSection
          title="A tu favor"
          description={creditNote}
          action={<ApplyCreditButton pairs={pairs} />}
          className="mt-5"
        >
          <CreditItems tenantSlug={tenantSlug} items={credits} />
        </PanelSection>
      ) : null}
    </Panel>
  )
}
