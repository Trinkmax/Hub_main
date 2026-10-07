'use client'

import { Cake, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useId } from 'react'
import { RadioCards, type RadioCardsItem } from '@/components/ui/radio-cards'
import type { CakeOptionSummary } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/** El valor del radio para "todavía no saben": Radix necesita un string. */
const UNDECIDED = '__sin-definir__'

/**
 * El desplegable de tortas: se abre cuando la reserva dice que lleva torta.
 *
 * Por qué tarjetas y no un `<select>`: la torta la hace el bar, y quien carga la
 * reserva la está eligiendo POR TELÉFONO con el cliente del otro lado. Tiene que
 * poder leerle los tres bizcochuelos con sus rellenos de un vistazo. Un combo
 * esconde justo lo que hay que dictar.
 *
 * Son las `RadioCards` del kit: un solo tab stop, las flechas mueven y eligen,
 * y la elegida lleva borde verde y el punto del radio relleno.
 *
 * "Todavía no saben" es una opción de verdad, no la ausencia de una: la reserva
 * entra hoy y el sabor se decide la semana que viene. Sin esa tarjeta, "no
 * elegí" y "eligieron y se borró" se ven igual.
 */
export function CakeOptionPicker({
  options,
  value,
  onChange,
  cakeCount,
  manageHref,
  className,
}: {
  /** El menú del bar, ya filtrado a las activas (más la elegida, si está de baja). */
  options: CakeOptionSummary[]
  value: string | null
  onChange: (id: string | null) => void
  /** Cuántas tortas trae la mesa: cambia el copy, no la elección. */
  cakeCount: number
  /** Config del catálogo. Solo se muestra si quien mira puede editarlo (dueño). */
  manageHref?: string
  className?: string
}) {
  // El hook va ANTES del early return: si no, React rompe el orden.
  const titleId = useId()

  if (options.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-border-strong p-4 type-body',
          className,
        )}
      >
        <p className="font-medium">Todavía no cargaste el menú de tortas.</p>
        <p className="mt-0.5 type-small text-muted-foreground">
          Cargá los bizcochuelos y rellenos que hace el bar y van a aparecer acá para elegir.
        </p>
        {manageHref ? (
          <Link
            href={manageHref}
            className="mt-2 inline-flex items-center gap-1.5 type-label text-primary underline underline-offset-[3px] hover:decoration-2"
          >
            <Settings2 className="size-3.5" aria-hidden />
            Cargar tortas
          </Link>
        ) : null}
      </div>
    )
  }

  const items: RadioCardsItem[] = [
    ...options.map((opt) => ({
      value: opt.id,
      label: opt.base,
      // El nombre es cómo la llama el bar en la cocina: "la opción 2".
      meta: opt.name,
      description: opt.fillings.length > 0 ? opt.fillings.join(' · ') : undefined,
    })),
    {
      value: UNDECIDED,
      label: 'Todavía no saben cuál',
      description: 'Lo definimos después',
      icon: Cake,
    },
  ]

  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id={titleId} className="type-label text-foreground">
          Qué torta va
          {/* Se elige UNA opción para la mesa. Si las dos tortas fueran de
              sabores distintos, va en el comentario de la reserva — decirlo acá
              evita que alguien crea que eligió dos y se guardó una. */}
          {cakeCount > 1 ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · las {cakeCount} del mismo sabor
            </span>
          ) : null}
        </p>
        {manageHref ? (
          <Link
            href={manageHref}
            className="inline-flex items-center gap-1 type-caption text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
          >
            <Settings2 className="size-3" aria-hidden />
            Editar menú
          </Link>
        ) : null}
      </div>

      <RadioCards
        aria-labelledby={titleId}
        size="sm"
        items={items}
        value={value ?? UNDECIDED}
        onValueChange={(next) => onChange(next === UNDECIDED ? null : next)}
      />
    </div>
  )
}
