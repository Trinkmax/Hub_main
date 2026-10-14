import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Panel, PanelLink, PanelSection, Term } from '@/components/administracion/kit'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import type { PartyDetail } from '@/lib/accounting/queries/parties'
import { formatCuit } from '@/lib/fiscal'

export const IVA_LABELS: Readonly<Record<string, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos',
}

const COMMISSION_VAT_LABELS: Readonly<Record<PartyDetail['commissionVatMode'], string>> = {
  per_settlement: 'Viene en cada liquidación',
  monthly_invoice: 'Llega una vez por mes',
  none: 'No te dan factura',
}

function rate(bp: number | null): string {
  return bp !== null ? vatRateLabel(bp) : '—'
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="min-w-0 text-sm text-muted-foreground text-pretty">{label}</dt>
      <dd className="shrink-0 text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * «Datos» de quien te debe: los mismos datos de siempre, agrupados con
 * palabras de dueño (cuándo te paga, cuánto te descuenta, la factura de su
 * comisión) y, al final, lo que mira la contadora. Las palabras de contadora
 * van con la idea primero y su nombre entre paréntesis (`Term`).
 *
 * No se edita acá: las tasas y los plazos se cambian en Ajustes › Medios de
 * cobro.
 */
export function PartyData({
  party,
  isCustomer,
  base,
  canWrite,
}: {
  party: PartyDetail
  isCustomer: boolean
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  const term =
    party.paymentTermDays > 0
      ? `A los ${party.paymentTermDays} ${party.paymentTermDays === 1 ? 'día' : 'días'}`
      : 'Al contado'
  return (
    <Panel
      footer={
        canWrite ? (
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Con estas tasas se precargan los descuentos al anotar un cobro. Se cambian en{' '}
            <PanelLink
              href={`${base}/ajustes?tab=participes`}
              className="inline-flex min-h-0 text-xs"
            >
              Ajustes › Medios de cobro
              <ArrowRight aria-hidden className="size-3" />
            </PanelLink>
          </p>
        ) : undefined
      }
    >
      <PanelSection title="Cuándo te paga">
        <dl>
          <Line label={isCustomer ? 'Plazo para pagarte' : 'Plazo desde la venta'} value={term} />
        </dl>
      </PanelSection>

      {isCustomer ? null : (
        <>
          <PanelSection title="Cuánto te descuenta">
            <dl className="divide-y divide-border/40">
              <Line label="Comisión" value={rate(party.commissionBp)} />
              <Line
                label={
                  <Term name="Retención de Ingresos Brutos" inline>
                    Lo que te retiene de Ingresos Brutos
                  </Term>
                }
                value={rate(party.iibbWithholdingBp)}
              />
              <Line
                label={
                  <Term name="Retención de IVA" inline>
                    Lo que te retiene de IVA
                  </Term>
                }
                value={rate(party.vatWithholdingBp)}
              />
              <Line
                label={
                  <Term name="Retención de Ganancias" inline>
                    Lo que te retiene de Ganancias
                  </Term>
                }
                value={rate(party.incomeTaxWithholdingBp)}
              />
              <Line
                label={
                  <Term name="SIRCUPA" inline>
                    Lo que te retiene la cuenta bancaria
                  </Term>
                }
                value={rate(party.sircupaBp)}
              />
            </dl>
          </PanelSection>
          <PanelSection title="La factura de su comisión">
            <dl>
              <Line label="Cómo te la da" value={COMMISSION_VAT_LABELS[party.commissionVatMode]} />
            </dl>
          </PanelSection>
        </>
      )}

      <PanelSection title="Para la contadora">
        <dl className="divide-y divide-border/40">
          <Line label="Razón social" value={party.name} />
          <Line label="CUIT" value={party.taxId ? formatCuit(party.taxId) : 'Sin cargar'} />
          <Line
            label="Condición frente al IVA"
            value={IVA_LABELS[party.ivaCondition] ?? 'Sin datos'}
          />
          <Line label="Cuenta contable" value={party.receivableAccountName ?? '—'} />
        </dl>
      </PanelSection>

      {party.notes ? (
        <PanelSection title="Notas">
          <p className="text-sm leading-relaxed text-pretty">{party.notes}</p>
        </PanelSection>
      ) : null}
    </Panel>
  )
}
