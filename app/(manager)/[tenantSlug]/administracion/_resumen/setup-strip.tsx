'use client'

import { ArrowRight, ChevronDown, Circle } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import type { SetupStep } from '@/lib/accounting/home'
import { cn } from '@/lib/utils'

const ROW =
  'group flex w-full items-start gap-3 rounded-xl p-3 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

const QUIET_LINK =
  'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9'

/**
 * La franja «Puesta en marcha · N de M», arriba de «Hoy te toca» mientras
 * falte algo. Es UNA lista (`buildSetup`) donde antes había tres cosas que no
 * se conocían entre sí: los dos avisos de arriba (saldos iniciales y CUIT),
 * «Primeros pasos» y el «Día 1» de la guía. Muestra lo próximo que conviene
 * hacer y «Ver todo» lleva a la guía con la lista completa.
 *
 * Se puede plegar y volver a abrir. Lo recuerda la misma cookie que usaba
 * «Ocultar» de Primeros pasos (la lee el servidor, así no parpadea al cargar);
 * antes ocultar era para siempre, ahora queda el renglón con el avance.
 *
 * Quien solo lee recibe los pasos sin acciones (lo decide `buildSetup`): acá
 * son renglones quietos.
 */
export function SetupStrip({
  title,
  done,
  total,
  next,
  guideHref,
  cookieName,
  initialCollapsed,
}: {
  /** «Puesta en marcha · 4 de 12». */
  title: string
  done: number
  total: number
  /** Hasta tres pasos pendientes, en el orden que conviene. */
  next: readonly SetupStep[]
  guideHref: string
  cookieName: string
  initialCollapsed: boolean
}) {
  const { openAction, readOnly } = useAccounting()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const listId = useId()

  const toggle = () => {
    const value = !collapsed
    setCollapsed(value)
    try {
      // Un año; solo para este bar. No es un dato sensible: si se pierde, vuelve a abrirse.
      // biome-ignore lint/suspicious/noDocumentCookie: cookie no-httpOnly leída por el server en el primer render (mismo patrón que hub_sidebar); Cookie Store API aún no es universal
      document.cookie = value
        ? `${cookieName}=1; path=/; max-age=31536000; samesite=lax`
        : `${cookieName}=; path=/; max-age=0; samesite=lax`
    } catch {
      // Sin cookies: queda así hasta recargar.
    }
  }

  const segments = Array.from({ length: Math.max(0, total) }, (_, i) => i)

  return (
    <div className="@container rounded-2xl bg-secondary/50 p-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="font-serif text-base font-semibold leading-snug tracking-tight">{title}</h3>
        {total > 0 ? (
          <div
            role="img"
            aria-label={`${done} de ${total} pasos hechos`}
            className="flex items-center gap-1"
          >
            {segments.map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-4 rounded-full',
                  i < done ? 'bg-primary' : 'bg-foreground/15',
                )}
              />
            ))}
          </div>
        ) : null}
        <div className="-mr-2 ml-auto flex items-center">
          <Link href={guideHref} className={QUIET_LINK}>
            Ver todo
          </Link>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={toggle}
            className={cn(QUIET_LINK, 'gap-1 text-muted-foreground hover:no-underline')}
          >
            {collapsed ? 'Mostrar' : 'Plegar'}
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                !collapsed && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>

      <div id={listId} hidden={collapsed}>
        <p className="text-sm text-muted-foreground">
          {readOnly ? 'Lo que todavía falta:' : 'Lo próximo que conviene hacer:'}
        </p>
        <ul className="-mx-3 mt-1.5 grid gap-x-2 gap-y-0.5 @min-[52rem]:grid-cols-3">
          {next.map((step) => {
            const action = readOnly ? null : step.action
            const body = (
              <>
                <Circle
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                  strokeWidth={2.25}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug text-foreground text-pretty">
                    {step.title}
                  </span>
                  {step.detail ? (
                    <span className="mt-0.5 block text-sm leading-snug text-muted-foreground text-pretty">
                      {step.detail}
                    </span>
                  ) : null}
                  {action ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      {action.label}
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 transition-[translate] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 motion-reduce:transition-none"
                      />
                    </span>
                  ) : null}
                </span>
              </>
            )
            return (
              <li key={step.id} className="flex">
                {action === null ? (
                  <div className="flex w-full items-start gap-3 p-3">{body}</div>
                ) : action.kind === 'href' ? (
                  <Link href={action.href} className={ROW}>
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAction(action.sheet, action.params)}
                    className={ROW}
                  >
                    {body}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
