'use client'

import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

function pesos(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
}

/**
 * «¿Son $129 o $129.000?»: la pregunta que faltaba en la caja.
 *
 * Aparece cuando el monto no llega a $1.000 (`suggestThousands`). En HUB se
 * cargaron cuentas sin los ceros («129» por $129.000), sumaron 0 puntos y la
 * pantalla igual festejaba: nadie se enteraba hasta que reclamaba el cliente.
 * Hasta que alguien elige, el botón de sumar queda apagado.
 */
export function MissingZerosCheck({
  id,
  typedCents,
  suggestedCents,
  typedPoints,
  onFix,
  onKeep,
}: {
  id?: string
  typedCents: number
  suggestedCents: number
  /** Lo que sumaría el monto tal cual. `null` = el bar no tiene una tasa enunciable. */
  typedPoints: number | null
  onFix: () => void
  /** Sin esto no se ofrece dejar el monto chico (donde no se cargan visitas sin puntos). */
  onKeep?: () => void
}) {
  const typed = pesos(typedCents)
  const suggested = pesos(suggestedCents)
  const consequence =
    typedPoints === 0
      ? 'Así como está no suma puntos.'
      : typedPoints
        ? `Así como está suma ${typedPoints.toLocaleString('es-AR')} ${typedPoints === 1 ? 'punto' : 'puntos'}.`
        : null

  return (
    // fieldset sin min-w-0 toma min-content y desborda en un celular angosto.
    <fieldset
      id={id}
      aria-live="polite"
      className="min-w-0 rounded-xl border border-warning/50 bg-warning/10 p-3"
    >
      <legend className="sr-only">Revisar el monto</legend>
      <p className="flex items-start gap-2 text-base font-semibold text-warning-text">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          ¿Son <span className="tabular-nums">{typed}</span> o{' '}
          <span className="tabular-nums">{suggested}</span>?
        </span>
      </p>
      {consequence ? (
        <p className="mt-0.5 pl-6 text-sm text-muted-foreground">{consequence}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 pl-6">
        <Button type="button" onClick={onFix} className="h-11 rounded-xl px-4 tabular-nums">
          {`Son ${suggested}`}
        </Button>
        {onKeep ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onKeep}
            className="h-11 rounded-xl px-4 tabular-nums"
          >
            {`Son ${typed}`}
          </Button>
        ) : null}
      </div>
    </fieldset>
  )
}
