import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PanelLink, StepCard } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { tabHref } from '../_lib/ventas-view'

/**
 * El bar recién arrancado, sin ningún cierre cargado: en vez de tres bloques
 * vacíos, los tres pasos de cómo se llenan las ventas cuando no hay punto de
 * venta. Cada paso dice qué es, de dónde sale el dato y a dónde se va a hacerlo.
 *
 * El botón dorado del cierre que falta ya está arriba, en la hoja verde: acá
 * los botones van en contorno (un solo botón principal por pantalla). Quien
 * solo mira ve los tres pasos sin ningún botón.
 *
 * Van en fila solo si la columna que los contiene tiene lugar (`@container`):
 * al lado de la noche elegida quedan uno abajo del otro.
 */
export function FirstSteps({
  base,
  month,
  closeHref,
  hasTargets,
  canWrite,
}: {
  /** `/<bar>/administracion`. */
  base: string
  /** El `?mes=` de la URL, si hay. */
  month: string | null
  /** A dónde se carga el primer cierre (el día que falta, si ya se sabe). */
  closeHref: string
  hasTargets: boolean
  canWrite: boolean
}) {
  const steps = [
    {
      n: 1,
      state: 'current' as const,
      title: 'Cada mañana, el cierre de anoche',
      summary:
        'Lo que se vendió y cómo te pagaron: efectivo, QR, tarjetas y apps. Lo sacás del posnet, de Mercado Pago y de cada app.',
      href: closeHref,
      label: 'Cargar el primero',
      write: true,
    },
    {
      n: 2,
      state: hasTargets ? ('done' as const) : ('todo' as const),
      title: 'Una vez por mes, el objetivo',
      summary: 'Para ver en el almanaque si cada noche quedó arriba o abajo.',
      href: tabHref(base, 'proyeccion', { mes: month }),
      label: hasTargets ? 'Ver el objetivo' : 'Poner el objetivo',
      write: !hasTargets,
    },
    {
      n: 3,
      state: 'todo' as const,
      title: 'Cuando te depositan, anotás que entró',
      summary:
        'Las tarjetas y las apps pagan días después. Vas a ver cuánto te deben y cuánto se quedó cada una.',
      href: tabHref(base, 'clientes'),
      label: 'Ver cuándo te paga cada medio',
      write: false,
    },
  ]

  return (
    <section aria-labelledby="ventas-primeros-pasos" className="space-y-4">
      <div className="space-y-1">
        <h2
          id="ventas-primeros-pasos"
          className="font-serif text-xl font-semibold leading-snug tracking-tight text-balance sm:text-2xl"
        >
          Así se llenan las ventas, sin punto de venta
        </h2>
        {canWrite ? null : (
          <p className="text-sm text-muted-foreground text-pretty">
            Cuando los dueños carguen los cierres del día, vas a ver acá lo vendido de cada noche.
          </p>
        )}
      </div>
      <div className="grid gap-4 @[52rem]:grid-cols-3">
        {steps.map((step) => (
          <StepCard
            key={step.n}
            open
            n={step.n}
            state={step.state}
            title={step.title}
            summary={step.summary}
            className="flex flex-col"
          >
            {/* Lo que carga no se le ofrece a quien solo mira; lo que es mirar, sí. */}
            {canWrite || !step.write ? (
              <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-fit">
                <Link href={step.href}>
                  {step.label}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </Button>
            ) : null}
          </StepCard>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        ¿Querés verlo paso a paso?{' '}
        <PanelLink href={`${base}/guias/dia-a-dia#receta-cierre`} className="inline-flex">
          Mirá la guía
          <ArrowRight aria-hidden className="size-3.5" />
        </PanelLink>
      </p>
    </section>
  )
}
