import type { OnboardingHowTo } from '@/lib/accounting/onboarding'
import { HowToFor } from './how-to-slot'

/**
 * «Cómo se hace» de un paso de «Cómo arrancar»: los pasos numerados, el ejemplo concreto y, si el
 * paso es subir un archivo, la mini guía «¿Cómo lo bajo?». El paso ya viene plegado en su fila: acá
 * no se pliega de nuevo. La mini guía, con sus maquetas, se arma recién cuando se abre el paso
 * (`showHowTo`): la página tiene varias y casi nunca se abren todas.
 */
export function HowSteps({
  steps,
  example,
  howTo,
  showHowTo,
}: {
  steps: readonly string[]
  example: string | null
  howTo?: OnboardingHowTo
  showHowTo: boolean
}) {
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold tabular-nums text-muted-foreground"
            >
              {index + 1}
            </span>
            <span className="min-w-0 text-foreground text-pretty">{step}</span>
          </li>
        ))}
      </ol>
      {example ? <p className="text-muted-foreground text-pretty">{example}</p> : null}
      {howTo && showHowTo ? <HowToFor source={howTo} /> : null}
    </div>
  )
}
