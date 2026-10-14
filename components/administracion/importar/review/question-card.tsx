import type { ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'

/**
 * La pregunta en la mano: UNA pregunta en criollo, el contexto en gris y dos o
 * tres respuestas grandes. Reemplaza al recuadro ámbar con seis botones iguales
 * de la revisión anterior, donde no se sabía cuál era la respuesta.
 *
 * - `ask` (riel ámbar): espera una respuesta de la persona.
 * - `info` (riel gris): algo que hay que saber o que no se resuelve acá (un
 *   archivo de otro origen, una hoja que no se puede armar).
 *
 * `inset` la deja sin superficie propia, para ir ADENTRO de otra (un paso de la
 * subida, un renglón abierto): nada de tarjetas dentro de tarjetas.
 *
 * Es propia de «Importar» (no va al kit). Server-safe: las respuestas son los
 * `children` (botones, píldoras o un selector), que arma quien la usa.
 */
export function QuestionCard({
  eyebrow,
  question,
  context,
  children,
  footer,
  tone = 'ask',
  headingLevel = 'h3',
  inset = false,
  id,
  role,
  tabIndex,
  ref,
  className,
}: {
  /** «Pregunta 1 de 3 · Otros impuestos». */
  eyebrow?: ReactNode
  question: ReactNode
  context?: ReactNode
  /** Las respuestas. */
  children?: ReactNode
  /** Lo callado de abajo: «No es nuestro», «Deshacer lo que contesté». */
  footer?: ReactNode
  tone?: 'ask' | 'info'
  headingLevel?: 'h2' | 'h3'
  inset?: boolean
  id?: string
  role?: 'alert' | 'status'
  /** `-1` para poder llevarle el foco (un error que aparece). */
  tabIndex?: number
  ref?: Ref<HTMLDivElement>
  className?: string
}) {
  const Heading = headingLevel
  return (
    <div
      id={id}
      ref={ref}
      role={role}
      tabIndex={tabIndex}
      data-tone={tone}
      className={cn(
        'relative scroll-mt-28 overflow-hidden rounded-2xl py-4 pr-4 pl-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-5 sm:pr-5 sm:pl-6',
        inset ? 'bg-secondary/50' : 'card-hairline border bg-card shadow-xs',
        className,
      )}
    >
      {/* El riel: ámbar si espera una respuesta, gris si solo avisa. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          tone === 'ask' ? 'bg-warning' : 'bg-adm-neutral',
        )}
      />
      {eyebrow ? (
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <Heading className="font-serif text-xl font-semibold leading-snug tracking-tight text-pretty [overflow-wrap:anywhere] sm:text-2xl">
        {question}
      </Heading>
      {context ? (
        <div className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {context}
        </div>
      ) : null}
      {children ? <div className="mt-4 space-y-3">{children}</div> : null}
      {footer ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Las respuestas de una pregunta: en fila con lugar, apiladas y a todo el ancho
 * en el celular (`ANSWER_BUTTON` les da la medida).
 */
export function QuestionAnswers({
  children,
  layout = 'row',
}: {
  children: ReactNode
  layout?: 'row' | 'stack'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        layout === 'row' && 'sm:flex-row sm:flex-wrap sm:items-center',
      )}
    >
      {children}
    </div>
  )
}

/** La medida de un botón de respuesta: 48 px y todo el ancho en el celular, 44 px con lugar. */
export const ANSWER_BUTTON = 'h-12 w-full sm:h-11 sm:w-auto'

/** El link callado de abajo de una pregunta («No es nuestro», «Lo dejo para después»). */
export const QUIET_ANSWER =
  'inline-flex min-h-11 cursor-pointer items-center rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:pointer-fine:min-h-9'
