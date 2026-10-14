import Link from 'next/link'
import type { ReactNode } from 'react'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { formatCents, formatCentsShort } from '@/lib/money'
import { IVA_LABELS, type IvaLike, ivaSimpleMath } from '../../_lib/iva-story'
import type { IvaClosePlan } from '../_lib/review'

/**
 * El cuerpo del paso 2 de «Fin de mes» cuando el mes se puede cerrar: qué pasa
 * con el IVA al cerrar (una oración, con «¿Cómo se calcula?» debajo) y el botón
 * «Cerrar». El número grande del IVA está en el papel del mes: acá no se
 * repite. Server-safe (el botón llega armado).
 *
 * El importe de la oración va en pesos, igual que el papel del mes y los
 * renglones de «¿Cómo se calcula?»; el exacto, con centavos, queda en el
 * diálogo de «Cerrar» y en la cuenta completa.
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
  // Si redondeando a pesos la suma a la vista no da el resultado, los renglones van con centavos
  // (y entonces la oración también: los dos importes tienen que ser el mismo).
  const exact = math?.wholePesos === false
  const money = exact ? formatCents : formatCentsShort
  const amount =
    exact && position && plan.text?.amount
      ? formatCents(position.toPayCents > 0 ? position.toPayCents : position.inFavorCents)
      : (plan.text?.amount ?? null)
  return (
    <div className="space-y-4">
      {plan.text ? (
        <div className="space-y-1 rounded-xl bg-secondary/50 p-3 sm:p-4">
          <p className="text-sm leading-relaxed text-pretty">
            {plan.text.lead}
            {amount ? (
              <span className="whitespace-nowrap font-semibold tabular-nums">{amount}</span>
            ) : null}
            {plan.text.tail}{' '}
            {/* El link va en la oración: suelto en su renglón dejaba un hueco en el celular. */}
            <Link
              href={ivaHref}
              className="rounded-sm font-medium whitespace-nowrap text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver la cuenta completa
            </Link>
          </p>
          {math && position ? (
            // Con el dedo el «¿Cómo se calcula?» mide 44 px de alto para un renglón de 12: sin
            // recortarle el sobrante, la caja quedaba con un hueco en blanco abajo. Solo plegado:
            // abierto, la cuenta necesita su aire hasta el borde de la caja.
            <Explain className="[&:not([open])]:pointer-coarse:-mb-2.5">
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
        </div>
      ) : null}
      {children}
    </div>
  )
}
