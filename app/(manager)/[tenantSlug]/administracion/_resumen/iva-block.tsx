import { ArrowRight, Percent } from 'lucide-react'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Term } from '@/components/administracion/kit/term'
import { ivaStrip } from '@/lib/accounting/home'
import { getIvaPosition, type IvaPosition, settleQuery } from '@/lib/accounting/queries'
import { formatCentsShort } from '@/lib/money'
import { PanelLink } from './block-states'
import type { HomeData } from './home-data'

/**
 * Los renglones de la cuenta del IVA, solo si cierran con el resultado que se
 * muestra (a pagar menos a favor). La liquidación tiene saldos que se arrastran
 * de dos maneras; si por algo la suma simple no diera, no se dibuja una cuenta
 * que no cierra: queda el link a la posición completa.
 */
function ivaMath(position: IvaPosition): { carried: number; withheld: number } | null {
  const carried = position.technicalBalancePrevCents + position.freeBalancePrevCents
  const withheld = position.perceptionsCents + position.withholdingsCents
  const result =
    position.debitFiscal.totalCents - position.creditFiscal.totalCents - carried - withheld
  return result === position.toPayCents - position.inFavorCents ? { carried, withheld } : null
}

/**
 * La franja del IVA del mes: una línea, al final. Antes ocupaba un cuarto de
 * la primera fila, al lado de la plata, y para un socio no es lo primero: es
 * un número estimado que confirma la contadora.
 */
export async function IvaBlock({ data }: { data: HomeData }) {
  const [summaryResult, settingsResult] = await Promise.all([data.summary, data.settings])
  // Sin resumen o sin ajustes no hay con qué decirlo: el héroe ya avisa el error.
  if (!summaryResult.ok || !settingsResult.ok || !settingsResult.data) return null

  const strip = ivaStrip(summaryResult.data.ivaMonth, {
    registered: settingsResult.data.ivaCondition === 'responsable_inscripto',
  })
  const frame = 'rounded-2xl border border-border/70 bg-card/60 px-4 py-3.5 sm:px-5'

  // No es responsable inscripta, o la base todavía no lo calcula: no hay número que mostrar.
  if (!('amountCents' in strip)) {
    return (
      <section aria-label="IVA del mes" className={frame}>
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground text-pretty">
          <Percent className="mt-0.5 size-4 shrink-0" aria-hidden />
          {strip.sentence}
        </p>
      </section>
    )
  }

  // Solo acá hace falta el detalle (22 ms): con IVA del mes ya existe su período.
  const month = summaryResult.data.ivaMonth?.month ?? data.today
  const positionResult = await settleQuery(getIvaPosition(data.tenantId, month))
  const position = positionResult.ok ? positionResult.data : null
  const math = position ? ivaMath(position) : null

  return (
    <section aria-label="IVA del mes" className={frame}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Percent className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">{strip.sentence}</p>
          <StatusPill tone={strip.provisional ? 'info' : 'muted'}>
            {strip.provisional ? 'Estimado' : 'Mes cerrado'}
          </StatusPill>
          {strip.provisional ? (
            <span className="text-sm text-muted-foreground">Lo confirma la contadora.</span>
          ) : null}
        </div>
        <PanelLink href={`${data.base}/libros/posicion-iva`}>
          Ver el detalle
          <ArrowRight className="size-3.5" aria-hidden />
        </PanelLink>
      </div>
      <Explain
        className="mt-1"
        note={
          strip.provisional
            ? 'Mientras el mes está abierto es una estimación: cambia con cada factura que cargues.'
            : undefined
        }
      >
        {position && math ? (
          <>
            <MathRow
              label={
                <Term name="IVA débito fiscal" inline>
                  IVA de lo que vendiste con factura
                </Term>
              }
              value={formatCentsShort(position.debitFiscal.totalCents)}
            />
            <MathRow
              op="−"
              label={
                <Term name="IVA crédito fiscal" inline>
                  IVA de tus compras con Factura A
                </Term>
              }
              value={formatCentsShort(position.creditFiscal.totalCents)}
            />
            {math.withheld !== 0 ? (
              <MathRow
                op="−"
                label="Percepciones y retenciones que ya te cobraron"
                value={formatCentsShort(math.withheld)}
              />
            ) : null}
            {math.carried !== 0 ? (
              <MathRow
                op="−"
                label="Saldo a favor que venía de meses anteriores"
                value={formatCentsShort(math.carried)}
              />
            ) : null}
            <MathRow
              op="="
              label={
                strip.kind === 'in_favor'
                  ? 'Te queda a favor'
                  : strip.kind === 'to_pay'
                    ? 'A pagar'
                    : 'Nada que pagar'
              }
              value={formatCentsShort(strip.amountCents)}
            />
          </>
        ) : (
          <p className="text-pretty">
            Es el IVA de lo que vendiste con factura, menos el IVA de tus compras con Factura A y lo
            que ya te cobraron de más. La cuenta completa está en la posición de IVA.
          </p>
        )}
      </Explain>
    </section>
  )
}
