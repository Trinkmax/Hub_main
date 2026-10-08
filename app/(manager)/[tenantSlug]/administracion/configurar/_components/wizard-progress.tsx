import { Stepper } from '@/components/ui/stepper'

/**
 * `label` es lo que entra en el `Stepper` (una palabra, como el resto de los pasos del panel:
 * con el nombre largo se cortaba en «Datos…»); `name` es el paso dicho entero.
 */
const STEPS = [
  { label: 'Datos', name: 'Datos de la SAS' },
  { label: 'Cajas', name: 'Cajas y cobros' },
  { label: 'Saldos', name: 'Saldos iniciales' },
  { label: 'Listo', name: 'Listo' },
] as const

const STEPPER_STEPS = STEPS.map(({ label }) => ({ label }))

/**
 * Los pasos de la puesta en marcha con el `Stepper` del panel. En el celular
 * el stepper muestra solo los círculos: abajo va en palabras en qué paso está.
 */
export function WizardProgress({ current }: { current: number }) {
  const step = STEPS[current]
  return (
    <nav aria-label="Pasos de la puesta en marcha" className="space-y-2">
      <Stepper steps={STEPPER_STEPS} current={current} />
      <p className="text-xs text-muted-foreground sm:hidden" aria-live="polite">
        Paso {current + 1} de {STEPS.length}
        {step ? ` · ${step.name}` : ''}
      </p>
      <p className="sr-only max-sm:hidden">
        Paso {current + 1} de {STEPS.length}
        {step ? `: ${step.name}` : ''}
      </p>
    </nav>
  )
}
