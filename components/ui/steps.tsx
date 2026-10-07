import { Check } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Pasos de un asistente (kit HUB §3.3; antes `Stepper`). Server-safe.
 *
 * Un `<ol>` con `aria-current="step"` en el actual. Círculos de 24 px:
 *
 * | Paso      | Cómo se ve                                                     |
 * |-----------|----------------------------------------------------------------|
 * | Hecho     | `bg-success-soft` con check en `text-success-text` (5,93:1)    |
 * | Actual    | `bg-primary text-primary-foreground`                           |
 * | Por venir | `bg-card border border-input`: el borde (3,56:1) dibuja el círculo |
 *
 * Conectores de un pelo (un borde: sobrevive al alto contraste). En el
 * celular se ve solo el actual: «Paso 2 de 4 · Ítems».
 */

export type StepsStep = {
  label: string
  description?: string
}

export type StepStatus = 'done' | 'current' | 'upcoming'

export type StepsProps = Omit<React.ComponentProps<'ol'>, 'children'> & {
  steps: ReadonlyArray<StepsStep>
  /** Índice del paso actual, desde 0. Los anteriores quedan hechos. */
  current: number
}

export function stepStatus(index: number, current: number): StepStatus {
  if (index < current) return 'done'
  if (index === current) return 'current'
  return 'upcoming'
}

/**
 * El paso que se ve en el celular: el actual, acotado a la lista (con todo
 * hecho, el último; con `current` negativo, el primero). `-1` si no hay pasos.
 */
export function visibleStepIndex(current: number, total: number): number {
  if (total <= 0) return -1
  return Math.min(total - 1, Math.max(0, Math.trunc(current)))
}

/** «Paso 2 de 4 · Ítems»: el contexto del celular, donde los otros pasos no se ven. */
export function stepCaption(steps: ReadonlyArray<StepsStep>, current: number): string {
  const index = visibleStepIndex(current, steps.length)
  const step = steps[index]
  if (!step) return ''
  return `Paso ${index + 1} de ${steps.length} · ${step.label}`
}

const CIRCLE_CLASSES: Readonly<Record<StepStatus, string>> = {
  done: 'bg-success-soft text-success-text',
  current: 'bg-primary text-primary-foreground forced-colors:border-[Highlight]',
  upcoming: 'border-input bg-card text-muted-foreground',
}

function Steps({ steps, current, className, ...props }: StepsProps) {
  const total = steps.length
  const visible = visibleStepIndex(current, total)

  return (
    <ol data-slot="steps" className={cn('flex w-full items-center gap-3', className)} {...props}>
      {steps.map((step, index) => {
        const status = stepStatus(index, current)
        const isLast = index === total - 1
        const onMobile = index === visible
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: los pasos son fijos y posicionales; dos pasos pueden llamarse igual
            key={index}
            data-slot="step"
            data-status={status}
            aria-current={status === 'current' ? 'step' : undefined}
            className={cn(
              'min-w-0 items-center gap-3',
              onMobile ? 'flex flex-1' : 'hidden sm:flex',
              isLast ? 'sm:flex-none' : 'sm:flex-1',
            )}
          >
            <span
              aria-hidden="true"
              data-slot="step-marker"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border border-transparent type-caption type-amount font-semibold forced-colors:border-[CanvasText]',
                CIRCLE_CLASSES[status],
              )}
            >
              {status === 'done' ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
            </span>

            <span className="min-w-0">
              {onMobile ? (
                <span
                  data-slot="step-caption"
                  className="block truncate type-label text-foreground sm:hidden"
                >
                  {stepCaption(steps, current)}
                </span>
              ) : null}
              <span className="hidden min-w-0 sm:block">
                <span
                  className={cn(
                    'block truncate type-label',
                    status === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {step.label}
                  {status === 'done' ? <span className="sr-only"> (listo)</span> : null}
                </span>
                {step.description ? (
                  <span className="block truncate type-caption text-muted-foreground">
                    {step.description}
                  </span>
                ) : null}
              </span>
            </span>

            {isLast ? null : (
              <span
                aria-hidden="true"
                data-slot="step-connector"
                className="hidden h-0 min-w-4 flex-1 border-t border-border sm:block"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export { Steps }
