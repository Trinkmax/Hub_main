import { ArrowRight, BookOpen, Receipt, Settings2, Store } from 'lucide-react'
import Link from 'next/link'
import { ActionTile } from '@/components/administracion/kit/action-tile'
import { Panel } from '@/components/administracion/kit/panel'
import { Button } from '@/components/ui/button'
import type { SetupStep } from '@/lib/accounting/home'
import { stepHref } from '../_lib/setup-next'
import { SetupRail } from './setup-rail'

/**
 * «Listo»: la puesta en marcha ya terminó (con o sin saldos iniciales). Es lo
 * que se ve al volver a `/configurar` más adelante, así que no puede ser un
 * callejón: dice que ya está, muestra lo próximo de verdad —los mismos pasos
 * pendientes que la portada de Ajustes y la franja del Resumen, de
 * `buildSetup`— y deja a mano lo de todos los días.
 *
 * Sin pendientes, «Lo próximo» no va. Server-safe.
 */
export function SetupDone({
  tenantSlug,
  next = [],
  guideHref,
}: {
  tenantSlug: string
  /** Hasta tres pasos pendientes de esta área (`doneNextSteps`). */
  next?: readonly SetupStep[]
  /** «Ver todo lo que falta» (la guía «Cómo arrancar»). */
  guideHref?: string
}) {
  const base = `/${tenantSlug}/administracion`
  return (
    <div className="space-y-6">
      {/* Sin el «Después: …» fijo del riel: acá lo que sigue es «Lo próximo», que sale de los
          datos (el renglón fijo lo contradecía: decía «sumar a tus socios» con todos adentro). */}
      <SetupRail current="done" orientation="horizontal" after={false} className="max-w-md" />

      <div>
        <h2 className="flex items-start gap-3 font-serif text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="mt-0.5 size-7 shrink-0 text-success sm:size-8"
          >
            <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" />
            <path
              className="adm-tick adm-tick-draw"
              d="M7 12.5l3.5 3.5L17 8.5"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Administración ya está configurada.
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          Todo lo que cargues desde ahora suma en las cajas, las cuentas y los libros.
        </p>
      </div>

      {next.length > 0 ? (
        <Panel
          title="Lo próximo"
          action={
            guideHref ? (
              <Link
                href={guideHref}
                className="inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
              >
                Ver todo lo que falta
              </Link>
            ) : undefined
          }
        >
          <ol className="divide-y divide-border/60">
            {next.map((step) => {
              const href = stepHref(step)
              return (
                <li
                  key={step.id}
                  className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.title}</p>
                    {step.detail ? (
                      <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
                        {step.detail}
                      </p>
                    ) : null}
                  </div>
                  {href && step.action ? (
                    <Button
                      asChild
                      variant="outline"
                      className="h-11 shrink-0 gap-2 self-start rounded-full px-4 sm:self-center"
                    >
                      <Link href={href}>
                        {step.action.label}
                        <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </Panel>
      ) : null}

      <section aria-labelledby="cfg-dia-a-dia" className="space-y-3">
        <h2 id="cfg-dia-a-dia" className="text-sm font-medium text-muted-foreground">
          Lo de todos los días
        </h2>
        <div className="grid gap-2.5">
          <ActionTile
            icon={Store}
            title="Cargá el cierre de ayer"
            hint="Lo que se vendió y cómo te pagaron"
            href={`${base}/ventas/cierre`}
          />
          <ActionTile
            icon={Receipt}
            title="Cargá un gasto"
            hint="El hielo, la verdulería, un flete"
            href={`${base}?accion=gasto`}
          />
          <ActionTile
            icon={BookOpen}
            title="Mirá la guía"
            hint="Qué cargar, dónde y cómo"
            href={`${base}/guias`}
          />
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" className="h-11 gap-2">
          <Link href={`${base}/ajustes`}>
            <Settings2 className="size-4" aria-hidden />
            Ir a Ajustes
          </Link>
        </Button>
        <Button asChild className="h-11 min-w-[160px]">
          <Link href={base}>Ir al Resumen</Link>
        </Button>
      </div>
    </div>
  )
}
