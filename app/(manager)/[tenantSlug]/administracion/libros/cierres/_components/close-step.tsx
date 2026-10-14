import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { PanelLink } from '@/components/administracion/kit/panel-states'
import { formatCents, formatCentsShort } from '@/lib/money'
import { IVA_LABELS, type IvaLike, ivaSimpleMath } from '../../_lib/iva-story'
import type { IvaClosePlan } from '../_lib/review'

/**
 * El cuerpo del paso 2 de «Fin de mes» cuando el mes se puede cerrar: qué pasa
 * con el IVA al cerrar (una oración, con «¿Cómo se calcula?» al lado) y el
 * botón «Cerrar». El número grande del IVA está en el papel del mes: acá no se
 * repite. Server-safe (el botón llega armado).
 */
export function CloseStepBody({
  plan,
  position,
  ivaHref,
  children,
}: {
  plan: IvaClosePlan
  /** La posición del mes, para la cuenta de cuatro renglones (los del Resumen). */
  position: IvaLike | null
  /** «Ver la cuenta completa» → El IVA del mes. */
  ivaHref: string
  /** `CloseMonthButton`. */
  children: ReactNode
}) {
  const math = position?.applies && !position.isZero ? ivaSimpleMath(position) : null
  // Si redondeando a pesos la suma a la vista no da el resultado, los renglones van con centavos.
  const money = math?.wholePesos === false ? formatCents : formatCentsShort
  return (
    <div className="space-y-4">
      {plan.text ? (
        <div className="space-y-1.5 rounded-xl bg-secondary/50 p-3 sm:p-4">
          <p className="text-sm leading-relaxed text-pretty">
            {plan.text.lead}
            {plan.text.amount ? (
              <span className="whitespace-nowrap font-semibold tabular-nums">
                {plan.text.amount}
              </span>
            ) : null}
            {plan.text.tail}
          </p>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
            {math && position ? (
              <Explain className="min-w-0 flex-1 basis-64">
                <MathRow label={IVA_LABELS.debit} value={money(math.debit)} />
                <MathRow op="−" label={IVA_LABELS.credit} value={money(math.credit)} />
                {math.withheld !== 0 ? (
                  <MathRow op="−" label={IVA_LABELS.withheld} value={money(math.withheld)} />
                ) : null}
                {math.carried !== 0 ? (
                  <MathRow op="−" label={IVA_LABELS.carried} value={money(math.carried)} />
                ) : null}
                <MathRow
                  op="="
                  label={math.result < 0 ? IVA_LABELS.inFavor : IVA_LABELS.toPay}
                  value={money(Math.abs(math.result))}
                />
              </Explain>
            ) : null}
            <PanelLink href={ivaHref} className="text-xs sm:text-xs">
              Ver la cuenta completa
              <ArrowRight className="size-3.5" aria-hidden />
            </PanelLink>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  )
}
