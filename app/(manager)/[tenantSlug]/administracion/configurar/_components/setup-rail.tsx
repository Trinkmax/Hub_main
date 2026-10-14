import { StepRail } from '@/components/administracion/kit/step'
import { cn } from '@/lib/utils'
import { setupRailItems } from '../_lib/wizard-steps'

/**
 * El riel de la puesta en marcha: los seis pasos, de «Datos de la SAS» a
 * «Saldos iniciales», con el avance de verdad. Es el mismo en las tres
 * pantallas de `/configurar`: en el asistente lo lleva el paso que se está
 * cargando; con el bar ya configurado, los cinco primeros van tildados y toca
 * el sexto; al terminar, los seis.
 *
 * Antes eran cuatro pasos en un `Stepper`, y la pantalla 2 escondía tres
 * temas y unas treinta decisiones: el avance mentía.
 *
 * `orientation="auto"` (el asistente): riel al costado en la compu, puntos y
 * «Paso 2 de 6 · …» en el celular. `horizontal`: siempre los puntos.
 */
export function SetupRail({
  current,
  summaries,
  doneUpTo,
  orientation = 'auto',
  className,
}: {
  /** El paso que toca (1 a 6), o `'done'` con todo hecho. */
  current: number | 'done'
  /** Lo que quedó cargado en cada paso, para mostrarlo bajo su nombre. */
  summaries?: Readonly<Record<number, string | null | undefined>>
  /** El último paso ya resuelto, cuando se volvió atrás a cambiar uno anterior. */
  doneUpTo?: number
  orientation?: 'auto' | 'horizontal'
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <StepRail
        label="Pasos de la puesta en marcha"
        orientation={orientation}
        steps={setupRailItems(current, summaries, doneUpTo)}
      />
      <p
        className={cn(
          'text-xs text-muted-foreground text-pretty',
          orientation === 'auto' ? 'mt-2 lg:mt-1' : 'mt-2',
        )}
      >
        Después: sumar a tus socios y conectar ARCA, cuando quieras.
      </p>
    </div>
  )
}
