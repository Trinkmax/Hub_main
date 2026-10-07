import { Steps, type StepsProps, type StepsStep } from '@/components/ui/steps'

/*
 * Compatibilidad (kit HUB §3.9): `Stepper` es `Steps` con otro nombre. Las
 * props son las mismas (`steps`, `current`, `className`), así los asistentes
 * de difusiones y de visitas no cambian. Cada lote importa `Steps` de
 * `@/components/ui/steps` y este archivo se borra con el último.
 */

/** @deprecated Usá `StepsStep` de `@/components/ui/steps`. */
export type StepperStep = StepsStep

/** @deprecated Usá `StepsProps` de `@/components/ui/steps`. */
export type StepperProps = StepsProps

/** @deprecated Usá `Steps` de `@/components/ui/steps` (mismas props). */
export const Stepper = Steps
