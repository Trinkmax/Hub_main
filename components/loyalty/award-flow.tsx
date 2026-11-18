'use client'

import { CheckCircle2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CustomerByQr } from '@/lib/customers/queries'
import type { EarnRate } from '@/lib/points/earn-rate'
import { AwardForm, type AwardResultData } from './award-form'
import { CustomerHeader } from './customer-header'
import { PunchStamper } from './punch-stamper'

function fmtPesos(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`
}

/**
 * El socio ya está identificado: cuánto gastó → puntos, y sellar sus tarjetas.
 *
 * Es UNA sola pieza para todos los caminos que llegan a un socio: el escáner del salón, el escáner
 * del panel y «Buscar persona» (el dueño lo elige de la lista, sin QR). Antes había dos copias casi
 * iguales (la caja del panel y el salón) que se iban separando.
 */
export function AwardFlow({
  tenantSlug,
  customer,
  earnRate,
  onReset,
  resetLabel,
  resetIcon,
  nextLabel,
  nextIcon,
}: {
  tenantSlug: string
  customer: CustomerByQr
  /** Tasa vigente del bar. `null` = todavía no se sabe (o no se puede enunciar sin mentir). */
  earnRate: EarnRate | null
  /** Volver a empezar: otro código, otra persona. */
  onReset: () => void
  /** Texto del «volver» mientras se carga el monto. */
  resetLabel: string
  resetIcon?: React.ReactNode
  /** Texto del botón grande después de acreditar. */
  nextLabel: string
  nextIcon?: React.ReactNode
}) {
  const [result, setResult] = useState<AwardResultData | null>(null)

  if (result) {
    return (
      <div className="space-y-4">
        <div className="card-hairline rounded-2xl border border-primary/40 bg-primary/8 p-6 text-center">
          <CheckCircle2 className="mx-auto size-11 text-primary" aria-hidden />
          {/* «+0» con un tilde verde parecía un éxito a medias que «tarda unos
              minutos»: los puntos son en el acto, así que si no sumó se dice. */}
          <p className="mt-3 font-display text-4xl font-semibold tabular-nums leading-none">
            {result.points_awarded > 0
              ? `+${result.points_awarded.toLocaleString('es-AR')}`
              : 'Sin puntos'}
          </p>
          <p className="mt-1 text-sm font-medium">
            {result.points_awarded > 0
              ? `${result.points_awarded === 1 ? 'punto' : 'puntos'} para ${customer.first_name}`
              : `La visita de ${customer.first_name} quedó cargada`}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {fmtPesos(result.amount_cents)} · ahora tiene{' '}
            <strong className="font-semibold tabular-nums text-foreground">
              {result.new_balance.toLocaleString('es-AR')}
            </strong>{' '}
            puntos
          </p>
        </div>

        {/* Sellar es otra acción de la misma visita: obligar a re-escanear el QR
            era pura fricción. */}
        <PunchStamper
          tenantSlug={tenantSlug}
          customerId={customer.id}
          customerName={customer.first_name}
        />

        <Button onClick={onReset} size="xl" className="h-14 w-full gap-2">
          {nextIcon}
          {nextLabel}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <CustomerHeader customer={customer} />

      <AwardForm
        tenantSlug={tenantSlug}
        customerId={customer.id}
        customerFirstName={customer.first_name}
        earnRate={earnRate}
        onAwarded={setResult}
        onCancel={onReset}
      />

      <PunchStamper
        tenantSlug={tenantSlug}
        customerId={customer.id}
        customerName={customer.first_name}
      />

      <Button variant="ghost" onClick={onReset} className="h-12 w-full gap-2">
        {resetIcon ?? <RotateCcw className="size-4" aria-hidden />}
        {resetLabel}
      </Button>
    </div>
  )
}
