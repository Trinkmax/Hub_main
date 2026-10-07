import { ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'

type Step = {
  done: boolean
  title: string
  description: string
  href: string
  cta: string
}

export type OnboardingSteps = {
  capacitiesReady: boolean
  templatesReady: boolean
  eventScheduledReady: boolean
  firstReservationReady: boolean
  firstClosedReady: boolean
}

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
        'Cuántas personas entran en Planta Alta y Planta Baja. Es la base de las barras de capacidad en el panel operativo.',
      href: `/${tenantSlug}/configuracion/salon`,
      cta: 'Configurar capacidad',
    },
    {
      done: steps.templatesReady,
      title: 'Creá los templates de eventos',
      description:
        'Sushi Libre, Pizza Libre, Ramen, etc. — el catálogo de formatos que después se programan en fechas concretas.',
      href: `/${tenantSlug}/eventos/templates`,
      cta: 'Crear templates',
    },
    {
      done: steps.eventScheduledReady,
      title: 'Programá el primer evento del mes',
      description:
        'Elegí una fecha y un template (ej: Sushi Libre el sábado 27). Después las reservas pueden engancharse a ese evento.',
      href: `/${tenantSlug}/eventos/programados`,
      cta: 'Programar evento',
    },
    {
      done: steps.firstReservationReady,
      title: 'Cargá la primera reserva',
      description:
        'Reemplaza al Google Form. Probá el flow completo de < 30 segundos con autocomplete + capacidad + comisión en vivo.',
      href: `/${tenantSlug}/reservas/nuevo`,
      cta: 'Nueva reserva',
    },
    {
      done: steps.firstClosedReady,
      title: 'Cerrá la primera mesa',
      description:
        'Marcá Llegó → Sentar → Cerrar en el panel operativo. Eso genera la primera comisión y alimenta las estadísticas.',
      href: `/${tenantSlug}/salon/reservas-operativo`,
      cta: 'Abrir panel',
    },
  ]

  const completed = items.filter((s) => s.done).length

  // Si está todo listo, no renderear el bloque
  if (completed === items.length) return null

  return (
    <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Empezá por acá
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">
              Configurá tu bar en {items.length} pasos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {completed} de {items.length} pasos completados
            </p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border bg-card">
            <span className="font-display text-lg font-semibold tabular-nums">
              {Math.round((completed / items.length) * 100)}%
            </span>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {items.map((item) => (
            <li key={item.title}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3 transition-colors hover:border-border hover:bg-background/80"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-medium text-primary group-hover:underline sm:inline-flex">
                  {item.done ? 'Listo' : item.cta}
                  <ArrowUpRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
