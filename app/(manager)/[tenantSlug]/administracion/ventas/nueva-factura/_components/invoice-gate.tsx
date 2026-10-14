'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useId } from 'react'
import { ChoiceCard } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'

export type GateAnswer = 'in_close' | 'apart'

/**
 * El paso 0 de la «Factura aparte»: «¿Esta venta ya está en un cierre del
 * día?». Si ya está, no se carga acá (quedaría dos veces): se anota en el
 * cierre, en «¿Qué facturaste?». Reemplaza el cartel azul que lo decía de
 * pasada.
 *
 * Es estado de pantalla: no viaja con la factura.
 */
export function InvoiceGate({
  value,
  onChange,
  closeHref,
}: {
  value: GateAnswer | null
  onChange: (answer: GateAnswer) => void
  /** A dónde se carga el cierre del día. */
  closeHref: string
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={`${id}-q`}
      className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <h2
        id={`${id}-q`}
        className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance"
      >
        ¿Esta venta ya está en un cierre del día?
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
        Lo de todas las noches se factura con el cierre, también los eventos. Acá va solo lo que se
        factura aparte.
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-q`} className="mt-4 grid gap-2 sm:grid-cols-2">
        <ChoiceCard
          name={`${id}-gate`}
          value="in_close"
          checked={value === 'in_close'}
          onChange={() => onChange('in_close')}
          title="Sí, ya está en un cierre"
          consequence="No la cargues acá: se anota en el cierre, en «¿Qué facturaste?»."
        />
        <ChoiceCard
          name={`${id}-gate`}
          value="apart"
          checked={value === 'apart'}
          onChange={() => onChange('apart')}
          title="No, se factura aparte"
          consequence="Un evento, un catering o un sponsoreo."
        />
      </div>
      {value === 'in_close' ? (
        <div className="mt-4 flex flex-col items-start gap-2 rounded-xl bg-secondary/50 p-3.5 text-sm">
          <p className="text-pretty">
            Entonces no hace falta cargar nada acá. Abrí el cierre de ese día y, en el paso 3, anotá
            de qué número a qué número facturaste.
          </p>
          <Button asChild className="h-11 gap-2">
            <Link href={closeHref}>
              Ir al cierre
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  )
}
