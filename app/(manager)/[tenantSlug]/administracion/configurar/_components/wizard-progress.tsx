import { Stepper, type StepperStep } from '@/components/ui/stepper'

const STEPS: StepperStep[] = [
  { label: 'Datos de la SAS' },
  { label: 'Cajas y cobros' },
  { label: 'Saldos iniciales' },
  { label: 'Listo' },
]

/**
 * Los pasos de la puesta en marcha con el `Stepper` del panel. En el celular
 * el stepper muestra solo los círculos: abajo va en palabras en qué paso está.
 */
export function WizardProgress({ current }: { current: number }) {
  const step = STEPS[current]
  return (
    <nav aria-label="Pasos de la puesta en marcha" className="space-y-2">
      <Stepper steps={STEPS} current={current} />
      <p className="text-xs text-muted-foreground sm:hidden" aria-live="polite">
        Paso {current + 1} de {STEPS.length}
        {step ? ` · ${step.label}` : ''}
      </p>
      <p className="sr-only max-sm:hidden">
        Paso {current + 1} de {STEPS.length}
        {step ? `: ${step.label}` : ''}
      </p>
    </nav>
  )
}
