import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una opción para elegir, del tamaño que merece una decisión: el dibujo o el
 * ícono, el título y, en una línea, QUÉ CAMBIA si la elegís («Entra al Libro
 * IVA y suma crédito»). Es un radio de verdad: un `<label>` con su
 * `<input type="radio">` adentro, así que anda con flechas, con Tab, sin
 * JavaScript y adentro de un `<form>` nativo. Agrupalas con el mismo `name`
 * dentro de un `fieldset` o un `role="radiogroup"` con su etiqueta.
 *
 * Acepta todas las props de un `<input type="radio">` (`name`, `value`,
 * `checked` + `onChange`, `defaultChecked`, `disabled`, `required`…).
 *
 * La elegida se marca con relleno, borde y tilde: nunca solo con el contorno.
 *
 * Cuándo NO: para más de cuatro o cinco opciones (ahí va un buscador), para
 * opciones sin consecuencia que explicar (alcanza `ChoiceChips`), ni para
 * prender y apagar algo (eso es un `Switch`).
 */
export function ChoiceCard({
  title,
  consequence,
  art,
  badge,
  layout = 'row',
  className,
  ...input
}: {
  title: ReactNode
  /** Qué pasa si elegís esta, en una línea. Tiene que ser CIERTO. */
  consequence: ReactNode
  /** El dibujo o ícono de la izquierda (arriba, con `layout="stack"`). */
  art?: ReactNode
  /** Al lado del título: «Lo más común», un `StatusPill`. */
  badge?: ReactNode
  /** `row`: dibujo a la izquierda. `stack`: dibujo arriba, para grillas de 2 a 4. */
  layout?: 'row' | 'stack'
  /** Va al `<label>` (ancho, columna de la grilla). */
  className?: string
} & Omit<ComponentProps<'input'>, 'type' | 'title' | 'className' | 'children'>) {
  const stack = layout === 'stack'
  return (
    <label className={cn('relative block cursor-pointer', className)}>
      <input type="radio" className="peer sr-only" {...input} />
      <span
        className={cn(
          'flex h-full min-h-16 rounded-2xl border bg-card p-3.5 shadow-xs transition-[background-color,border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
          'hover:border-primary/40 hover:bg-cream-tint',
          'peer-checked:border-primary peer-checked:bg-accent/50 peer-checked:ring-2 peer-checked:ring-primary/25',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-disabled:hover:border-border peer-disabled:hover:bg-card',
          stack ? 'flex-col gap-3 pr-11' : 'items-center gap-3.5 pr-12',
        )}
      >
        {art ? (
          <span aria-hidden className="flex shrink-0 items-center justify-center">
            {art}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium leading-snug">{title}</span>
            {badge}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground text-pretty">
            {consequence}
          </span>
        </span>
      </span>
      {/* La marca es hermana del input (y no hija del cuerpo) para que
          `peer-checked` la alcance sin depender de `:has()`. Vacía = se puede
          elegir; llena con tilde = elegida. */}
      <span
        aria-hidden
        className={cn(
          'adm-choice-mark pointer-events-none absolute right-3.5 flex size-5.5 items-center justify-center rounded-full border-2 border-border bg-card text-transparent transition-[background-color,border-color,color] duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
          'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-disabled:opacity-50',
          stack ? 'top-3.5' : 'top-1/2 -translate-y-1/2',
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-3.5">
          <path
            className="adm-tick"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  )
}
