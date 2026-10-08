'use client'

import { ArrowRight, Loader2, PartyPopper, PlugZap } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { guideStepById } from '@/components/administracion/guias/arca-guide-model'
import { useGuideNav } from '@/components/administracion/guias/guide-nav'
import { Button } from '@/components/ui/button'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { testArcaConnection } from '@/lib/arca/actions'
import type { ArcaEnvironment } from '@/lib/arca/endpoints'
import type { ArcaConnectionView, ArcaTestView } from '@/lib/arca/views'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ArcaChecksList } from './arca-checks'
import { ArcaFailureNotice, GuideLink, useArcaRun, useFocusWhen } from './arca-shared'
import { Callout } from './form-bits'

/** Los estados con certificado: los únicos que se pueden probar (igual que el servidor). */
const TESTABLE = new Set(['cert_ready', 'connected', 'error'])

/** ¿Se puede probar esta conexión? */
export function canTestConnection(connection: ArcaConnectionView | null): boolean {
  return Boolean(connection?.certificate) && TESTABLE.has(connection?.status ?? '')
}

/**
 * «Probar conexión» (paso 9 y la pestaña): corre los 7 chequeos con ARCA (puede tardar hasta un
 * minuto), muestra cada uno con ✓ o ✗ en palabras simples y, si algo falla, a qué paso ir. Con
 * todo bien: «¡Listo! ARCA quedó conectado» y lo que conviene hacer después. Arranca mostrando
 * la última prueba, si sigue vigente.
 */
export function ArcaTestAction({
  slug,
  environment,
  connection,
  guideHref = '',
  showNextSteps = false,
  className,
}: {
  slug: string
  environment: ArcaEnvironment
  connection: ArcaConnectionView | null
  /** Dónde está la guía (`''` si ya estamos en ella). */
  guideHref?: string
  /** Los próximos pasos cuando queda conectado (en la guía). */
  showNextSteps?: boolean
  className?: string
}) {
  const nav = useGuideNav()
  const [test, setTest] = useState<ArcaTestView | null>(connection?.lastTest ?? null)
  // Si la conexión cambió por otro lado (un certificado nuevo deja la prueba vieja sin valor),
  // se muestra lo que dice la base.
  const lastAt = connection?.lastTest?.at ?? null
  const [seenAt, setSeenAt] = useState(lastAt)
  if (lastAt !== seenAt) {
    setSeenAt(lastAt)
    setTest(connection?.lastTest ?? null)
  }
  const [ran, setRan] = useState(0)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const { pending, run } = useArcaRun()
  const resultRef = useFocusWhen<HTMLDivElement>(ran > 0 ? ran : null)
  const base = `/${slug}/administracion`
  const ready = canTestConnection(connection)

  const start = () => {
    setFailure(null)
    run(() => testArcaConnection(slug, { environment }), {
      quiet: true,
      onSuccess: (view, message) => {
        setTest(view)
        setRan((n) => n + 1)
        if (view.status === 'connected') toast.success(message)
        else toast.error(message)
      },
      onFailure: setFailure,
    })
  }

  const problem = test && test.status === 'error' ? test.firstProblem : null
  const problemStep = problem?.step ? guideStepById(problem.step) : null

  return (
    <div className={cn('space-y-4', className)}>
      {!ready ? (
        <Callout tone="info" title="Primero, el certificado">
          Cuando subas el certificado (paso 6) vas a poder probar la conexión acá.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          type="button"
          className="h-11 w-full gap-2 sm:w-auto md:h-10"
          onClick={start}
          disabled={pending || !ready}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <PlugZap className="size-4" aria-hidden />
          )}
          {pending ? 'Probando…' : test ? 'Probar de nuevo' : 'Probar conexión'}
        </Button>
        {test && !pending ? (
          <p className="text-xs text-muted-foreground">Última prueba: {formatDateTime(test.at)}</p>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {pending ? 'Probando la conexión con ARCA. Puede tardar hasta un minuto.' : ''}
      </p>
      {pending ? (
        <div className="flex items-start gap-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" aria-hidden />
          <p className="text-pretty">
            Estamos hablando con ARCA y revisando todo, uno por uno. Puede tardar hasta un minuto:
            no cierres esta página.
          </p>
        </div>
      ) : null}

      {test && !pending ? (
        <div ref={resultRef} tabIndex={-1} className="space-y-3 rounded-lg outline-none">
          {test.status === 'connected' ? (
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4">
              <PartyPopper className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="font-serif text-lg font-semibold tracking-tight text-success">
                  ¡Listo! ARCA quedó conectado.
                </p>
                <p className="text-sm text-muted-foreground text-pretty">
                  {test.checks.some((c) => c.tone === 'warning')
                    ? 'Anda todo. Mirá los avisos en amarillo: no frenan, pero conviene revisarlos.'
                    : 'Todos los chequeos dieron bien.'}
                </p>
              </div>
            </div>
          ) : problem ? (
            <Callout
              tone="error"
              title={problem.title ?? 'La prueba encontró un problema'}
              action={
                problemStep ? (
                  <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                    <GuideLink
                      href={`${guideHref}#paso-${problemStep.n}`}
                      onClick={(event) => {
                        if (guideHref || !nav) return
                        event.preventDefault()
                        nav.reveal(problemStep.id)
                      }}
                    >
                      Cómo se arregla
                      <ArrowRight className="size-4" aria-hidden />
                    </GuideLink>
                  </Button>
                ) : null
              }
            >
              {problem.message}
            </Callout>
          ) : null}

          <ArcaChecksList test={test} guideHref={guideHref} />

          {test.status === 'connected' && showNextSteps ? (
            <div className="space-y-2 rounded-lg border border-border bg-background/60 p-4 text-sm">
              <p className="font-medium">Y ahora:</p>
              <ul className="space-y-1.5">
                <li>
                  <Link
                    href={`${base}/compras?tab=proveedores`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Probá «Completar con ARCA»
                  </Link>{' '}
                  al cargar un proveedor: ponés la CUIT y se completa el resto.
                </li>
                <li>
                  <Link
                    href={`${base}/ajustes?tab=arca`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Prendé «Emitir facturas desde la plataforma»
                  </Link>{' '}
                  cuando vayas a facturar un evento.
                </li>
                <li>
                  <Link
                    href={`${base}/importar/arca`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Traé las compras del mes pasado
                  </Link>{' '}
                  desde «Mis Comprobantes» de ARCA.
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <ArcaFailureNotice failure={failure} slug={slug} guideHref={guideHref} />
    </div>
  )
}
