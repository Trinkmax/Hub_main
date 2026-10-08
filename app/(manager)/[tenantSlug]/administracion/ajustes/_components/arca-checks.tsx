'use client'

import { Circle, CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { guideStepById } from '@/components/administracion/guias/arca-guide-model'
import { useGuideNav } from '@/components/administracion/guias/guide-nav'
import type { ArcaCheckTone, ArcaTestView } from '@/lib/arca/views'
import { cn } from '@/lib/utils'
import { GuideLink } from './arca-shared'

const TONE: Readonly<
  Record<ArcaCheckTone, { icon: typeof CircleCheck; className: string; sr: string }>
> = {
  ok: { icon: CircleCheck, className: 'text-success', sr: 'Bien.' },
  warning: { icon: TriangleAlert, className: 'text-warning', sr: 'Aviso.' },
  error: { icon: CircleX, className: 'text-destructive', sr: 'No anduvo.' },
}

/**
 * Los 7 chequeos de «Probar conexión» (diseño §2.6) con ✓, aviso o ✗, el texto en palabras
 * simples de cada uno y, si algo falló, el link al paso de la guía que lo arregla. Los que no se
 * llegaron a correr (la prueba se corta en el primero grave) quedan en gris. El estado va
 * también en texto para lectores.
 */
export function ArcaChecksList({
  test,
  guideHref = '',
  className,
}: {
  test: ArcaTestView
  /** Dónde está la guía (`''` si ya estamos en ella: el link abre el paso sin salir). */
  guideHref?: string
  className?: string
}) {
  const nav = useGuideNav()
  return (
    <ul className={cn('divide-y divide-border/60 rounded-lg border border-border/80', className)}>
      {test.checks.map((check) => {
        const tone = TONE[check.tone]
        const Icon = tone.icon
        const step = check.step ? guideStepById(check.step) : null
        return (
          <li key={check.key} className="flex items-start gap-3 px-3 py-3 text-sm">
            <Icon className={cn('mt-0.5 size-4 shrink-0', tone.className)} aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p
                className={cn(
                  'font-medium text-pretty',
                  check.tone === 'error' && 'text-destructive',
                )}
              >
                <span className="sr-only">{tone.sr} </span>
                {check.label}
              </p>
              <p className="text-muted-foreground text-pretty">{check.message}</p>
              {step && !check.ok ? (
                <GuideLink
                  href={`${guideHref}#paso-${step.n}`}
                  onClick={(event) => {
                    if (guideHref || !nav) return
                    event.preventDefault()
                    nav.reveal(step.id)
                  }}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-7"
                >
                  Cómo se arregla: paso {step.n}
                </GuideLink>
              ) : null}
              {check.code && !check.ok ? (
                <p className="text-xs text-muted-foreground">
                  Código para soporte: <span className="font-mono">{check.code}</span>
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
      {test.notRun.map((pending) => (
        <li
          key={pending.key}
          className="flex items-start gap-3 px-3 py-3 text-sm text-muted-foreground"
        >
          <Circle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-pretty">{pending.label}</p>
            <p className="text-xs">No se llegó a probar: arreglá lo de arriba y volvé a probar.</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
