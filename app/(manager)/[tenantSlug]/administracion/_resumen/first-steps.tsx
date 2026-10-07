'use client'

import { ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import type { AccSummary } from '@/lib/accounting/queries/summary'
import { firstStepsCookieName } from './first-steps-cookie'

type Step = {
  key: string
  done: boolean
  title: string
  description: string
  cta: string
} & ({ href: string } | { onClick: () => void })

/**
 * «Primeros pasos» de Administración (H.4), con la forma de «Empezá por acá»
 * del inicio del panel. Se va sola cuando están todos hechos; «Ocultar» la
 * guarda en una cookie (el servidor ya no la dibuja: nada que parpadee).
 */
export function FirstSteps({ base, steps }: { base: string; steps: AccSummary['firstSteps'] }) {
  const { tenantSlug, openAction, readOnly } = useAccounting()
  const [hidden, setHidden] = useState(false)

  if (readOnly || hidden) return null

  const items: Step[] = [
    {
      key: 'gasto',
      done: steps.firstExpense,
      title: 'Cargá tu primer gasto',
      description: 'Lo de todos los días: el hielo, la verdulería, unas Cocas a la vuelta.',
      cta: 'Nuevo gasto',
      onClick: () => openAction('gasto'),
    },
    {
      key: 'cierre',
      done: steps.firstDailyClose,
      title: 'Cargá el cierre de ayer',
      description: 'Lo que se vendió y cómo te pagaron: efectivo, QR, tarjetas, plataformas.',
      cta: 'Cierre del día',
      href: `${base}/ventas/cierre`,
    },
    {
      key: 'socio',
      done: steps.partnerGranted,
      title: 'Dale acceso a tu socio',
      description: 'Administración es privada: solo la ven los dueños que habilites.',
      cta: 'Ir a Accesos',
      href: `${base}/ajustes?tab=accesos`,
    },
    {
      key: 'contadora',
      done: steps.accountantAdded,
      title: 'Sumá a la contadora',
      description: 'Ve y exporta los libros, el IVA y las cuentas. No carga ni cambia nada.',
      cta: 'Ir a Accesos',
      href: `${base}/ajustes?tab=accesos`,
    },
  ]

  const completed = items.filter((s) => s.done).length
  if (completed === items.length) return null

  const hide = () => {
    setHidden(true)
    try {
      // Un año; solo para este bar. No es un dato sensible: si se pierde, vuelve a aparecer.
      // biome-ignore lint/suspicious/noDocumentCookie: cookie no-httpOnly leída por el server en el primer render (mismo patrón que hub_sidebar); Cookie Store API aún no es universal
      document.cookie = `${firstStepsCookieName(tenantSlug)}=1; path=/; max-age=31536000; samesite=lax`
    } catch {
      // Sin cookies: se oculta hasta recargar.
    }
  }

  return (
    <section
      aria-labelledby="primeros-pasos-titulo"
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
              Primeros pasos
            </p>
            <h2
              id="primeros-pasos-titulo"
              className="mt-1 font-display text-lg font-semibold tracking-tight"
            >
              Dejá Administración andando
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {completed} de {items.length} pasos hechos
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 text-muted-foreground md:h-8"
            onClick={hide}
          >
            Ocultar
          </Button>
        </div>

        <ul className="mt-5 space-y-2">
          {items.map((item) => {
            const body = (
              <>
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {item.title}
                    {item.done ? <span className="sr-only"> (hecho)</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
                {item.done ? null : (
                  <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-medium text-primary sm:inline-flex">
                    {item.cta}
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </span>
                )}
              </>
            )
            const className =
              'group flex w-full items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3 text-left transition-colors hover:border-border hover:bg-background/80 outline-none focus-visible:ring-2 focus-visible:ring-ring'
            return (
              <li key={item.key}>
                {'href' in item ? (
                  <Link href={item.href} className={className}>
                    {body}
                  </Link>
                ) : (
                  <button type="button" onClick={item.onClick} className={className}>
                    {body}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
