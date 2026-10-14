import { ArrowRight, Percent } from 'lucide-react'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { ivaStrip } from '@/lib/accounting/home'
import { getIvaPosition, type IvaPosition, settleQuery } from '@/lib/accounting/queries'
import { monthName } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { PanelLink } from './block-states'
import type { HomeData } from './home-data'

/**
 * Los renglones de la cuenta del IVA, solo si cierran con el resultado que se
 * muestra (a pagar menos a favor). La liquidación tiene saldos que se arrastran
 * de dos maneras; si por algo la suma simple no diera, no se dibuja una cuenta
 * que no cierra: queda el link a la posición completa.
 */
function ivaMath(
  position: IvaPosition,
): { carried: number; withheld: number; wholePesos: boolean } | null {
  const carried = position.technicalBalancePrevCents + position.freeBalancePrevCents
  const withheld = position.perceptionsCents + position.withholdingsCents
  const debit = position.debitFiscal.totalCents
  const credit = position.creditFiscal.totalCents
  const result = debit - credit - carried - withheld
  if (result !== position.toPayCents - position.inFavorCents) return null
  // La cuenta se muestra para poder rehacerla: si redondeando cada renglón a pesos la suma a
  // la vista da un peso de diferencia con el resultado, los renglones van con centavos.
  const pesos = (cents: number) => Math.round(cents / 100)
  const wholePesos =
    pesos(debit) - pesos(credit) - pesos(carried) - pesos(withheld) === pesos(result)
  return { carried, withheld, wholePesos }
}

/**
 * Todavía no hay nada con factura en el mes: ni ventas, ni compras, ni saldos que vengan de
 * antes. Ahí «no hay nada que pagar» afirmaría una cuenta que nadie hizo (0 − 0).
 */
function nothingLoaded(position: IvaPosition): boolean {
  return (
    position.debitFiscal.totalCents === 0 &&
    position.creditFiscal.totalCents === 0 &&
    position.technicalBalancePrevCents === 0 &&
    position.freeBalancePrevCents === 0 &&
    position.perceptionsCents === 0 &&
    position.withholdingsCents === 0
  )
}

/** El nombre de contadora, escrito al lado en gris (sin subrayado: no hay nada más que abrir). */
function Named({ idea, name }: { idea: string; name: string }) {
  return (
    <>
      {idea} <span className="text-muted-foreground/80">({name})</span>
    </>
  )
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
  const money = math?.wholePesos === false ? formatCents : formatCentsShort

  // El bar recién arrancado: en vez de «no hay nada que pagar · Estimado», qué va a aparecer.
  if (strip.kind === 'zero' && position && nothingLoaded(position)) {
    const name = monthName(Number(month.slice(5, 7)))
    return (
      <section aria-label="IVA del mes" className={frame}>
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground text-pretty">
          <Percent className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">
              {name ? `IVA de ${name}` : 'IVA del mes'}: todavía no hay nada cargado con factura.
            </span>{' '}
            Cuando cargues ventas o compras con factura, acá va el estimado del mes.
          </span>
        </p>
      </section>
    )
  }

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
        // Angosto a propósito: a todo el ancho el rótulo quedaba a 900 px de su número.
        className="mt-1 max-w-xl"
        note={
          strip.provisional
            ? 'Mientras el mes está abierto es una estimación: cambia con cada factura que cargues.'
            : undefined
        }
      >
        {position && math ? (
          <>
            <MathRow
              label={<Named idea="IVA de lo que vendiste con factura" name="IVA débito fiscal" />}
              value={money(position.debitFiscal.totalCents)}
            />
            <MathRow
              op="−"
              label={<Named idea="IVA de tus compras con Factura A" name="IVA crédito fiscal" />}
              value={money(position.creditFiscal.totalCents)}
            />
            {math.withheld !== 0 ? (
              <MathRow
                op="−"
                label="Percepciones y retenciones que ya te cobraron"
                value={money(math.withheld)}
              />
            ) : null}
            {math.carried !== 0 ? (
              <MathRow
                op="−"
                label="Saldo a favor que venía de meses anteriores"
                value={money(math.carried)}
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
              value={money(strip.amountCents)}
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
