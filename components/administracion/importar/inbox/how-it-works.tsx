import type { ReactNode } from 'react'

/**
 * «Así funciona»: los tres pasos de traer un archivo, dibujados y unidos por
 * una línea (bajalo de allá → subilo acá → revisá y cargá), con la agenda
 * debajo. Se muestra mientras el bar NUNCA cargó nada desde un archivo: es lo
 * primero que ve un bar que recién arranca, y tiene que enseñar el recorrido
 * antes de pedir nada.
 *
 * Dibujos de trazo con el color del texto (sin logos de marca). Decorativos: lo
 * que enseñan está escrito al lado. Server-safe.
 */

function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-10 text-primary"
    >
      {children}
    </svg>
  )
}

const STEPS: ReadonlyArray<{ title: string; text: string; art: ReactNode }> = [
  {
    title: 'Bajalo de allá',
    text: 'De ARCA, de Mercado Pago o del home banking.',
    art: (
      <>
        {/* Una pantalla de otra página, con la flecha de «bajar». */}
        <rect x="7" y="8" width="34" height="23" rx="3" />
        <path d="M7 14h34" />
        <path d="M24 18v9M20 23.5l4 4 4-4" />
        <path d="M17 40h14M24 31v9" />
      </>
    ),
  },
  {
    title: 'Subilo acá',
    text: 'Lo leo en tu compu. Todavía no se carga nada.',
    art: (
      <>
        {/* La hoja entrando en la bandeja. */}
        <path d="M16 6h12l6 6v14H16z" />
        <path d="M28 6v6h6" />
        <path d="M20.5 16h7M20.5 20.5h9" />
        <path d="M6 28h8l3 5h14l3-5h8v12H6z" />
      </>
    ),
  },
  {
    title: 'Revisá y cargá',
    text: 'Te pregunto solo lo que no sé.',
    art: (
      <>
        {/* Dos hojas: una con tilde, otra con la pregunta. */}
        <rect x="6" y="10" width="20" height="26" rx="2.5" />
        <path d="m11.5 23 3.5 3.5 6-7" />
        <rect x="24" y="14" width="18" height="24" rx="2.5" className="fill-card" />
        <path d="M30 23.5a3.2 3.2 0 1 1 4.6 2.9c-.9.5-1.4 1.1-1.4 2.1" />
        <path d="M33.2 32.6v.2" />
      </>
    ),
  },
]

export function HowItWorks({
  startNote,
  agenda,
}: {
  /** «Tus números arrancan el 12/10: todavía no hay nada atrasado.» */
  startNote?: string | null
  /** «Lo próximo: Mercado Pago, el lunes 19/10; …» */
  agenda: string
}) {
  return (
    <section aria-labelledby="asi-funciona" className="rounded-2xl bg-secondary/50 p-4 sm:p-5">
      <h2
        id="asi-funciona"
        className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        Así funciona
      </h2>
      <ol className="relative mt-3 grid gap-4 sm:grid-cols-3 sm:gap-6">
        {/* La línea que une los tres pasos (en compu, de izquierda a derecha). */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-7 right-[16.6%] left-[16.6%] hidden border-t-2 border-dashed border-adm-track sm:block"
        />
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative flex items-center gap-3.5 sm:flex-col sm:items-center sm:gap-2.5 sm:text-center"
          >
            <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card shadow-xs">
              <Art>{step.art}</Art>
              <span className="absolute -top-2 -left-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground">
                {index + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block font-serif text-lg font-semibold leading-snug tracking-tight">
                {step.title}
              </span>
              <span className="block text-sm leading-snug text-muted-foreground text-pretty">
                {step.text}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-border/60 pt-3 text-sm text-muted-foreground text-pretty">
        {startNote ? <span className="font-medium text-foreground">{startNote} </span> : null}
        {agenda}
      </p>
    </section>
  )
}
