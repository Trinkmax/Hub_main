import type { ReactNode } from 'react'

/**
 * Lo que se le hace a un papel anulado: la palabra «ANULADO» cruzada encima,
 * en diagonal, y la tinta del papel apagada debajo. No es un sello (los sellos
 * dicen qué papel es) ni una píldora: es la banda de la ficha. El motivo, quién
 * y cuándo los cuenta el bloque de la plata, al lado.
 *
 * `later`: se anuló con fecha posterior porque su mes estaba cerrado; el papel
 * queda en su mes y la banda lo dice en un segundo renglón.
 *
 * Se apaga lo ESCRITO, no el papel: el papel sigue siendo un objeto claro (en
 * claro no se funde con la página y en oscuro no queda una losa gris). La
 * banda lleva el fondo del papel, así tapa lo que tiene debajo en vez de
 * mezclarse con los números.
 *
 * Dónde cae: sobre los renglones, nunca sobre el sello (que dice qué papel era)
 * ni sobre el total. El papel la pone con `VoidedMark` en el medio de sus
 * renglones; si no la puso (el ticket del cierre es de Ventas), va a un 40 % del
 * alto, que en ese ticket largo son sus renglones.
 *
 * La tinta es el rojo de siempre, con los tokens del modo claro
 * (`force-light`): el papel es claro también en oscuro.
 *
 * Cuándo NO: sobre algo que no sea un `Ticket`; para un comprobante vigente;
 * para un estado de pago («Vencida» es una píldora).
 */

/** La palabra cruzada. */
function Mark({ later }: { later: boolean }) {
  return (
    // `force-light` fija también el color del texto: va en un envoltorio sin caja, y la tinta
    // de la banda en el hijo.
    <span className="force-light contents">
      <span className="inline-flex -rotate-[9deg] flex-col items-center rounded-md border-[3px] border-double border-current bg-adm-paper/90 px-5 py-1.5 text-center font-bold uppercase leading-tight tracking-[0.2em] text-destructive">
        <span className="text-2xl">Anulado</span>
        {later ? <span className="text-[10px] tracking-[0.16em]">con fecha posterior</span> : null}
      </span>
    </span>
  )
}

/**
 * La banda puesta por el papel, en el medio de lo que la envuelve (sus
 * renglones). El envoltorio tiene que ser `relative` y llevar `data-voided-rows`.
 */
export function VoidedMark({ later = false }: { later?: boolean }) {
  return (
    <div
      aria-hidden
      data-void-mark
      className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center"
    >
      <Mark later={later} />
    </div>
  )
}

export function VoidedBand({
  later = false,
  placed = false,
  children,
}: {
  later?: boolean
  /** El papel ya puso su `VoidedMark`: acá solo se apaga la tinta. */
  placed?: boolean
  children: ReactNode
}) {
  return (
    <div className="relative">
      {/* `.adm-ticket` es el papel del kit: se atenúan sus hijos (y los renglones que envuelven
          la banda, de a uno) y su fondo queda entero. La banda no se atenúa. */}
      <div className="[&_.adm-ticket>*:not([data-voided-rows])]:opacity-55 [&_[data-voided-rows]>*:not([data-void-mark])]:opacity-55">
        {children}
      </div>
      {placed ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[40%] flex -translate-y-1/2 justify-center"
        >
          <Mark later={later} />
        </div>
      )}
      <p className="sr-only">
        {later
          ? 'Este comprobante se anuló con fecha posterior.'
          : 'Este comprobante está anulado.'}
      </p>
    </div>
  )
}
