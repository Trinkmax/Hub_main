import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StepperStep = {
  label: string
  description?: string
}

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: StepperStep[]
  current: number
  className?: string
}) {
  return (
    <ol
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2 sm:gap-1 sm:p-3',
        className,
      )}
    >
      {steps.map((step, index) => {
        const status = index < current ? 'done' : index === current ? 'current' : 'upcoming'
        const isLast = index === steps.length - 1
        return (
          <li
            key={step.label}
            className={cn(
              'flex flex-1 items-center gap-2 sm:gap-3',
              !isLast && 'pr-2 sm:pr-3',
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors',
                status === 'done' && 'border-success bg-success text-success-foreground',
                status === 'current' && 'border-primary bg-primary text-primary-foreground',
                status === 'upcoming' && 'border-border bg-secondary/40 text-muted-foreground',
              )}
            >
              {status === 'done' ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="hidden min-w-0 flex-1 sm:block">
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  status === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {step.label}
              </p>
              {step.description ? (
                <p className="truncate text-[11px] text-muted-foreground">{step.description}</p>
              ) : null}
            </div>
            {!isLast ? (
              <span
                className={cn(
                  'hidden h-px flex-1 sm:block',
                  index < current ? 'bg-success/60' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
