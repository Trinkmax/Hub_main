import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * «¿Cómo se calcula?»: la cuenta de un número, plegada al lado del número.
 * Nadie tiene que confiar en una cifra que no puede rehacer. Es un `<details>`
 * nativo (anda sin JavaScript y con teclado), con el mismo aspecto que el de
 * «Cómo nos fue».
 *
 * Adentro van renglones `MathRow` (y, si hace falta, una oración). `note` es
 * la aclaración del pie: de dónde sale el dato o qué NO incluye.
 *
 * Cuándo NO: para esconder algo que hay que ver sí o sí (un aviso, un
 * vencimiento), ni para un número que no sale de una cuenta. Uno por número:
 * si la pantalla necesita cinco, el problema es la pantalla.
 */
export function Explain({
  label = '¿Cómo se calcula?',
  children,
  note,
  className,
}: {
  label?: string
  children: ReactNode
  note?: ReactNode
  className?: string
}) {
  return (
    <details className={cn('group/explain text-sm', className)}>
      <summary
        className={cn(
          'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground',
          'outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          'pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/explain:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="mt-2 rounded-xl bg-secondary/50 p-3 sm:p-4">
        <div className="space-y-1.5">{children}</div>
        {note ? (
          <p className="mt-3 border-t border-border/60 pt-2.5 text-xs leading-relaxed text-muted-foreground text-pretty">
            {note}
          </p>
        ) : null}
      </div>
    </details>
  )
}

const OP_WORD = { '+': 'más', '−': 'menos', '=': 'igual a' } as const

/**
 * Un renglón de la cuenta: qué es, cuánto es y, adelante, si suma, resta o es
 * el resultado. El renglón «=» va separado por una raya y en negrita. El signo
 * tiene su propia columna, así nunca queda pegado al número.
 *
 * `value` llega ya formateado (`formatCents`, `formatCentsShort` o un `Amount`).
 *
 * Cuándo NO: fuera de un `Explain` o de la cuenta de un ticket.
 */
export function MathRow({
  label,
  value,
  op,
}: {
  label: ReactNode
  value: ReactNode
  op?: '+' | '−' | '='
}) {
  const result = op === '='
  return (
    <div
      className={cn(
        'flex items-baseline gap-2',
        result && 'mt-1 border-t border-border/60 pt-2 font-semibold',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'w-3 shrink-0 text-center font-mono',
          result ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {op ?? ''}
      </span>
      {op ? <span className="sr-only">{OP_WORD[op]}</span> : null}
      <span className={cn('min-w-0 flex-1 text-pretty', !result && 'text-muted-foreground')}>
        {label}
      </span>
      <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-foreground">
        {value}
      </span>
    </div>
  )
}
