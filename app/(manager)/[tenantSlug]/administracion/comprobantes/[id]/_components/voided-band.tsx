import type { ReactNode } from 'react'

/**
 * Lo que se le hace a un papel anulado: la palabra «ANULADO» cruzada encima,
 * en diagonal, y el papel apagado debajo. No es un sello (los sellos dicen qué
 * papel es) ni una píldora: es la banda de la ficha. El motivo, quién y cuándo
 * los cuenta el bloque de la plata, al lado.
 *
 * `later`: se anuló con fecha posterior porque su mes estaba cerrado; el papel
 * queda en su mes y la banda lo dice en un segundo renglón.
 *
 * La tinta es el rojo de siempre mezclado con la del papel, y va con los
 * tokens del modo claro (`force-light`): el papel es claro también en oscuro.
 *
 * Cuándo NO: sobre algo que no sea un `Ticket`; para un comprobante vigente;
 * para un estado de pago («Vencida» es una píldora).
 */
export function VoidedBand({ later = false, children }: { later?: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <div className="opacity-60">{children}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        {/* `force-light` fija también el color del texto: va en un envoltorio sin caja, y la
            tinta de la banda en el hijo. */}
        <span className="force-light contents">
          <span className="inline-flex -rotate-12 flex-col items-center rounded-md border-[3px] border-double border-current px-5 py-1.5 text-center font-bold uppercase leading-tight tracking-[0.2em] text-[color:color-mix(in_oklch,var(--destructive)_82%,var(--adm-paper-ink))] mix-blend-multiply">
            <span className="text-2xl">Anulado</span>
            {later ? (
              <span className="text-[10px] tracking-[0.16em]">con fecha posterior</span>
            ) : null}
          </span>
        </span>
      </div>
      <p className="sr-only">
        {later
          ? 'Este comprobante se anuló con fecha posterior.'
          : 'Este comprobante está anulado.'}
      </p>
    </div>
  )
}
