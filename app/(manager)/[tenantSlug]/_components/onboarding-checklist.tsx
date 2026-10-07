import { ChevronRight, Circle, CircleCheck } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ReloadLink } from '@/components/ui/reload-link'
import { Section } from '@/components/ui/section'
import { cn } from '@/lib/utils'

type Step = {
  done: boolean
  title: string
  description: string
  href: string
  cta: string
  /**
   * El destino es el salón, otro workspace (su propio <html> y su Toaster): se
   * entra recargando, con ReloadLink y no con <Link> (kit §7.a.4, riesgo 19).
   */
  leavesPanel?: boolean
}

export type OnboardingSteps = {
  capacitiesReady: boolean
  templatesReady: boolean
  eventScheduledReady: boolean
  firstReservationReady: boolean
  firstClosedReady: boolean
}

/**
 * Fila-link de la lista (kit §3.0): hover `--hover` y presionado `--active` sin
 * escala ni transición (es ancha), foco «adentro» porque va pegada a otras.
 */
const ROW_CLASSES = cn(
  'flex min-h-11 items-start gap-3 px-4 py-3 sm:px-6',
  'hover:bg-hover active:bg-active',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ring)',
)

export function OnboardingChecklist({
  tenantSlug,
  steps,
}: {
  tenantSlug: string
  steps: OnboardingSteps
}) {
  const items: Step[] = [
    {
      done: steps.capacitiesReady,
      title: 'Definí la capacidad del salón',
      description:
        'Cuántas personas entran en Planta Alta y en Planta Baja. Con eso se arman las barras de capacidad del operativo.',
      href: `/${tenantSlug}/configuracion/salon`,
      cta: 'Configurar capacidad',
    },
    {
      done: steps.templatesReady,
      title: 'Creá los formatos de tus eventos',
      description:
        'Sushi Libre, Pizza Libre, Ramen…: los formatos que después programás en fechas concretas.',
      href: `/${tenantSlug}/eventos/templates`,
      cta: 'Crear formatos',
    },
    {
      done: steps.eventScheduledReady,
      title: 'Programá tu próximo evento',
      description:
        'Elegí una fecha y un formato (por ejemplo, Sushi Libre el sábado). Las reservas se pueden enganchar a ese evento.',
      href: `/${tenantSlug}/eventos/programados`,
      cta: 'Programar evento',
    },
    {
      done: steps.firstReservationReady,
      title: 'Cargá la primera reserva',
      description:
        'Se carga en menos de 30 segundos: el cliente se autocompleta y ves el cupo y la comisión mientras la cargás.',
      href: `/${tenantSlug}/reservas/nuevo`,
      cta: 'Nueva reserva',
    },
    {
      // Se completa con la primera reserva que llegó (o que ya se sentó o cerró):
      // desde el rediseño del panel de mozos, el salón solo marca «Llegó».
      done: steps.firstClosedReady,
      title: 'Recibí la primera reserva',
      description:
        'Cuando llegue, marcá «Llegó» en las reservas del salón: ahí queda registrada la comisión.',
      href: `/${tenantSlug}/salon/reservas-operativo`,
      cta: 'Ir al salón',
      leavesPanel: true,
    },
  ]

  const completed = items.filter((s) => s.done).length

  // Con todo listo, el bloque no se dibuja.
  if (completed === items.length) return null

  return (
    <Section title="Configurá tu bar" description="Cada paso te lleva a la pantalla donde se hace.">
      <Card padding="none" className="gap-0 overflow-clip">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <Progress
            value={(completed / items.length) * 100}
            label="Configuración del bar"
            valueText={`${completed} de ${items.length} pasos listos`}
            className="flex-1"
          />
          <span
            aria-hidden="true"
            className="shrink-0 type-caption tabular-nums text-muted-foreground"
          >
            {completed} de {items.length} listos
          </span>
        </div>

        <ol className="divide-y divide-border">
          {items.map((item) => {
            const content = (
              <>
                {item.done ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-success-text"
                  />
                ) : (
                  <Circle
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-subtle-foreground"
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'type-label text-pretty',
                      item.done ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {item.done ? <span className="sr-only">Listo: </span> : null}
                    {item.title}
                  </span>
                  <span className="type-small text-pretty text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                {/* Refuerzo visual: el nombre del link ya lo dan el título y el «Listo:» de arriba. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'hidden shrink-0 self-center type-label sm:inline',
                    item.done ? 'text-muted-foreground' : 'text-primary',
                  )}
                >
                  {item.done ? 'Listo' : item.cta}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 self-center text-muted-foreground"
                />
              </>
            )
            return (
              <li key={item.title}>
                {item.leavesPanel ? (
                  <ReloadLink href={item.href} className={ROW_CLASSES}>
                    {content}
                  </ReloadLink>
                ) : (
                  <Link href={item.href} className={ROW_CLASSES}>
                    {content}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </Card>
    </Section>
  )
}
