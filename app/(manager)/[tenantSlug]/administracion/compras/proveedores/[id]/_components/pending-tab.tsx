import { CircleCheck } from 'lucide-react'
import Link from 'next/link'
import { EmptyTeach, Panel, PanelSection } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
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
 * Una compra sin factura se debe igual: suma acá, tiene su vencimiento y se
 * paga igual que las demás.
 */
export function PendingTab({
  tenantSlug,
  partyId,
  partyName,
  position,
  pairs,
  today,
  canWrite,
  canBuy,
  newPurchaseHref,
}: {
  tenantSlug: string
  partyId: string
  /** Como se lo nombra: el de fantasía, si tiene. */
  partyName: string
  position: PartyPosition
  /** Lo que «Usarlo ahora» imputa (`creditPairs`). */
  pairs: ReadonlyArray<{ debitLineId: string; creditLineId: string; amountCents: number }>
  today: string
  canWrite: boolean
  /** Está activo: se le puede cargar una compra. */
  canBuy: boolean
  newPurchaseHref: string
}) {
  const debts = position.debtItems
  const credits = position.creditItems

  return (
    <Panel
      id="le-debes"
      title="Lo que le debés"
      description={
        debts.length > 0
          ? debts.length === 1
            ? 'Una compra sin pagar.'
            : `${debts.length} compras sin pagar, la que vence antes primero.`
          : undefined
      }
    >
      {debts.length > 0 ? (
        <DebtItems
          tenantSlug={tenantSlug}
          partyId={partyId}
          items={debts}
          totalCents={position.debtCents}
          today={today}
          canWrite={canWrite}
        />
      ) : (
        <EmptyTeach
          plain
          icon={CircleCheck}
          title={`No le debés nada a ${partyName}`}
          action={
            canWrite && canBuy ? (
              <Button asChild className="h-11 rounded-full px-5">
                <Link href={newPurchaseHref}>Cargarle una compra</Link>
              </Button>
            ) : undefined
          }
          secondary={
            canWrite ? (
              <ActionButton
                action="pagar"
                params={{ proveedor: partyId }}
                variant="link"
                className="h-auto min-h-11 p-0 text-muted-foreground underline-offset-4 hover:text-foreground md:min-h-0"
              >
                Dejarle plata a cuenta
              </ActionButton>
            ) : undefined
          }
        >
          Cuando te deje algo para pagar después, lo cargás y aparece acá.
        </EmptyTeach>
      )}

      {credits.length > 0 ? (
        <PanelSection
          title="A tu favor"
          description="Una nota de crédito o plata que le adelantaste. Se descuenta sola en el próximo pago."
          action={<ApplyCreditButton pairs={pairs} />}
          className="mt-5"
        >
          <CreditItems tenantSlug={tenantSlug} items={credits} />
        </PanelSection>
      ) : null}
    </Panel>
  )
}
