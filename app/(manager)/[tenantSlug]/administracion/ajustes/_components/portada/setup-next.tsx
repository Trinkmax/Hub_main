import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { HeroPanel } from '@/components/administracion/kit/hero'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import type { SetupStep } from '@/lib/accounting/home'
import { type SetupNextView, stepHref, stepPlaceLinks } from '../../../configurar/_lib/setup-next'

/**
 * «Puesta en marcha» en la portada de Ajustes: lo próximo que conviene hacer.
 *
 * Los pasos son los de `buildSetup` —la misma función de la franja del
 * Resumen—, así que el mismo paso se llama igual, dice lo mismo y lleva al
 * mismo lugar en las dos pantallas. Acá no hay «N de M»: ese número se dice
 * una sola vez, en el Resumen; la lista entera es «Cómo arrancar».
 *
 * - Falta algo que deforma los números (los saldos iniciales, la CUIT, algún
 *   medio de cobro): un paso en grande, con su botón.
 * - Solo queda lo que puede esperar: una línea, sin cartel de «falta».
 * - No queda nada: una línea con tilde.
 *
 * Es solo para quien carga. La contadora ve `SetupPills`.
 */

const LINK =
  'rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «A · B · C», cada uno un link. En fila van por el nombre de su lugar («Datos de la SAS ·
 * Cajas y cuentas · Accesos»), el mismo de las tarjetas de abajo: así no se mezcla una orden
 * con nombres sueltos.
 */
function StepLinks({ steps }: { steps: readonly SetupStep[] }) {
  return (
    <>
      {stepPlaceLinks(steps).map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 ? <span aria-hidden> · </span> : null}
          {item.href ? (
            <Link href={item.href} className={LINK}>
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </Fragment>
      ))}
    </>
  )
}

export function SetupNext({ view, guideHref }: { view: SetupNextView; guideHref: string }) {
  if (view.kind === 'complete') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        La puesta en marcha está completa.
      </p>
    )
  }

  if (view.kind === 'later') {
    return (
      <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground text-pretty">
        Para completar cuando puedas: <StepLinks steps={view.steps} />
        {view.more > 0 ? <span> y {view.more} más</span> : null}.{' '}
        <Link href={guideHref} className={LINK}>
          Ver todo
        </Link>
      </p>
    )
  }

  const href = stepHref(view.step)
  return (
    <HeroPanel
      tone="crema"
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Puesta en marcha
        </p>
        <h2 className="mt-1.5 font-serif text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
          {view.step.title}
        </h2>
        {view.step.detail ? (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
            {view.step.detail}
          </p>
        ) : null}
        {view.after.length > 0 ? (
          <p className="mt-3 hidden text-sm text-muted-foreground text-pretty lg:block">
            Después: <StepLinks steps={view.after} />
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 lg:items-end">
        {href && view.step.action ? (
          <Button asChild className="h-12 gap-2 px-6 text-base">
            <Link href={href}>
              {view.step.action.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        ) : null}
        {view.after.length > 0 ? (
          <p className="text-sm text-muted-foreground text-pretty lg:hidden">
            Después: <StepLinks steps={view.after} />
          </p>
        ) : null}
        <Link
          href={guideHref}
          className={`${LINK} inline-flex min-h-11 items-center text-sm font-normal text-muted-foreground sm:min-h-0`}
        >
          Ver todo lo que falta
        </Link>
      </div>
    </HeroPanel>
  )
}

/** Lo que ve la contadora en lugar del bloque: qué falta, en hasta dos píldoras. Ningún botón. */
export function SetupPills({ steps }: { steps: readonly SetupStep[] }) {
  const pending = steps.filter((s) => !s.done).slice(0, 2)
  if (pending.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {pending.map((step) => (
        <li key={step.id}>
          <StatusPill tone="warn">{step.title}</StatusPill>
        </li>
      ))}
    </ul>
  )
}
