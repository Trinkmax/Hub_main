import { StepRail } from '@/components/administracion/kit/step'
import { cn } from '@/lib/utils'
import { setupRailItems } from '../_lib/wizard-steps'

/**
 * El riel de la puesta en marcha: los cinco pasos, de «Datos de la SAS» a
 * «Saldos iniciales», con el avance de verdad. Es el mismo en las tres
 * pantallas de `/configurar`: en el asistente lo lleva el paso que se está
 * cargando; con el bar ya configurado, los cuatro primeros van tildados y toca
 * el quinto; al terminar, los cinco.
 *
 * Antes eran cuatro pasos en un `Stepper`, y la pantalla 2 escondía tres
 * temas y unas treinta decisiones: el avance mentía.
 *
 * `orientation="auto"` (el asistente): riel al costado en la compu, puntos y
 * «Paso 2 de 5 · …» en el celular. `horizontal`: siempre los puntos.
 */
export function SetupRail({
  current,
  summaries,
  doneUpTo,
  orientation = 'auto',
  after = true,
  className,
}: {
  /** El paso que toca (1 a 5), o `'done'` con todo hecho. */
  current: number | 'done'
  /** Lo que quedó cargado en cada paso, para mostrarlo bajo su nombre. */
  summaries?: Readonly<Record<number, string | null | undefined>>
  /** El último paso ya resuelto, cuando se volvió atrás a cambiar uno anterior. */
  doneUpTo?: number
  orientation?: 'auto' | 'horizontal'
  /**
   * El renglón «Después: sumar a tus socios y conectar ARCA…». Es un texto fijo: con todo
   * hecho no va (ahí lo que sigue sale de los datos, en «Lo próximo»).
   */
  after?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <StepRail
        label="Pasos de la puesta en marcha"
        orientation={orientation}
        steps={setupRailItems(current, summaries, doneUpTo)}
      />
      {after ? (
        <p
          className={cn(
            'text-xs text-muted-foreground text-pretty',
            orientation === 'auto' ? 'mt-2 lg:mt-1' : 'mt-2',
          )}
        >
          Después: sumar a tus socios y conectar ARCA, cuando quieras.
        </p>
      ) : null}
    </div>
  )
}
