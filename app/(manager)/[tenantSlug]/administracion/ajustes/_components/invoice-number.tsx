import { CornerLeftUp } from 'lucide-react'
import { PaperSheet } from '@/components/administracion/kit/paper'
import { padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'

/**
 * La cabecera de una factura con su número señalado: «0003-00001234», con los
 * cuatro primeros dígitos rodeados y la nota «esto es el punto de venta». Es
 * la respuesta a «¿qué número tengo que poner?»: el dueño mira cualquier
 * factura de las que entrega hoy y copia los cuatro de adelante.
 *
 * - `number`: el punto de venta a mostrar. `null` = todavía no hay ninguno: se
 *   dibuja «????» punteado (lo que hay que averiguar).
 * - `size="md"`: el papel entero, sobre `PaperSheet` (el mismo papel que usa
 *   Ventas en «Factura aparte»). `size="sm"`: la miniatura de la portada.
 *
 * El «00001234» es de ejemplo y lo dice el contexto que la monta (va rotulada
 * «Ejemplo» en el estado vacío). Decorativa para lectores: la oración de al
 * lado lo explica con palabras.
 *
 * Cuándo NO: para mostrar el número de una factura real (eso es texto), ni
 * como campo (el número se escribe en su `Input`).
 */
export function InvoiceNumber({
  number,
  size = 'md',
  className,
}: {
  number: number | null
  size?: 'md' | 'sm'
  className?: string
}) {
  const point = number === null ? '????' : padPv(number, 4)
  const unknown = number === null

  if (size === 'sm') {
    return (
      <div
        aria-hidden
        className={cn(
          'flex h-[64px] w-[56px] flex-col rounded-[3px] border border-adm-paper-rule bg-adm-paper px-1.5 pt-1.5 text-adm-paper-ink shadow-2xs',
          className,
        )}
      >
        <span className="font-mono text-[6px] leading-none font-semibold tracking-[0.14em] uppercase opacity-70">
          Factura B
        </span>
        <span className="mt-1 h-px w-full bg-adm-paper-rule" />
        <span
          className={cn(
            'mt-1.5 self-start rounded-[5px] px-1 py-0.5 font-mono text-[12px] leading-none font-semibold tabular-nums',
            unknown
              ? 'border border-dashed border-adm-paper-ink/60 opacity-70'
              : 'ring-[1.5px] ring-destructive',
          )}
        >
          {point}
        </span>
        <span className="mt-1 font-mono text-[7px] leading-none tabular-nums opacity-55">
          -00001234
        </span>
        <span className="mt-auto mb-1.5 h-px w-3/4 bg-adm-paper-rule" />
      </div>
    )
  }

  return (
    <PaperSheet
      size="sm"
      title="Factura B"
      aside="N.º de comprobante"
      aria-label="Ejemplo de la cabecera de una factura, con el punto de venta señalado"
      className={cn('w-full max-w-[19rem]', className)}
    >
      <div aria-hidden>
        <p className="flex items-baseline font-mono text-xl leading-none font-semibold tabular-nums sm:text-2xl">
          <span
            className={cn(
              'rounded-lg px-1.5 py-1',
              unknown
                ? 'border-2 border-dashed border-adm-paper-ink/50 text-muted-foreground'
                : 'ring-2 ring-destructive',
            )}
          >
            {point}
          </span>
          <span className="text-muted-foreground">-00001234</span>
        </p>
        <p className="mt-2 flex items-center gap-1 pl-3 text-xs font-medium">
          <CornerLeftUp className="size-3.5 shrink-0 text-destructive" />
          esto es el punto de venta
        </p>
        <div className="mt-3 space-y-1.5">
          <span className="block h-1.5 w-4/5 rounded-full bg-adm-paper-rule/70" />
          <span className="block h-1.5 w-3/5 rounded-full bg-adm-paper-rule/70" />
        </div>
      </div>
    </PaperSheet>
  )
}
