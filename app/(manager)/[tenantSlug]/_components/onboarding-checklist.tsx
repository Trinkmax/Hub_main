import { ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'
import { SETUP_STEPS, type SetupStatus, setupDone } from '@/lib/onboarding/steps'
import { DismissChecklistButton } from './dismiss-checklist-button'

/**
 * «Tu bar en marcha»: los primeros pasos de un bar nuevo, en el Resumen. Es la ÚNICA guía de
 * arranque (antes había además un asistente en una pantalla aparte). Cada paso se tilda solo cuando
 * el bar ya lo hizo, y la lista desaparece cuando están todos o cuando el dueño la oculta.
 */
export function OnboardingChecklist({
  tenantSlug,
  steps,
}: {
  tenantSlug: string
  steps: SetupStatus
}) {
  if (setupDone(steps)) return null
  const completed = SETUP_STEPS.filter((step) => steps[step.key]).length

  return (
    <section
      aria-label="Tu bar en marcha"
      className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Empezá por acá
            </p>
            <h2 className="mt-1 font-serif text-lg font-semibold tracking-tight">
              Tu bar en marcha
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {completed === 0
                ? `Son ${SETUP_STEPS.length} pasos. Se tildan solos a medida que los hacés.`
                : `${completed} de ${SETUP_STEPS.length} pasos hechos.`}
            </p>
          </div>
          <DismissChecklistButton tenantSlug={tenantSlug} />
        </div>

        <ul className="mt-4 grid gap-2 lg:grid-cols-2">
          {SETUP_STEPS.map((step) => {
            const done = steps[step.key]
            return (
              <li key={step.key}>
                <Link
                  href={step.href(tenantSlug)}
                  className="group flex h-full items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3 transition-colors hover:border-border hover:bg-background/80"
                >
                  {done ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Circle
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                    >
                      {step.title}
                      {done ? <span className="sr-only"> (hecho)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground text-pretty">{step.description}</p>
                  </div>
                  {done ? null : (
                    <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-medium text-primary group-hover:underline sm:inline-flex">
                      {step.cta}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
