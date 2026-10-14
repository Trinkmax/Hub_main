'use client'

import { ArrowRight, ChevronDown, Circle } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import type { HomeAction, SetupStep } from '@/lib/accounting/home'
import { cn } from '@/lib/utils'
import { SETUP_OPEN_VALUE } from './first-steps-cookie'

const ROW =
  'group flex w-full items-start gap-3 rounded-xl p-3 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

const QUIET_LINK =
  'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9'

/**
 * La franja «Puesta en marcha · N de M», debajo de las tarjetas de «Hoy te
 * toca» mientras falte algo. Es UNA lista (`buildSetup`) donde antes había
 * tres cosas que no se conocían entre sí: los dos avisos de arriba (saldos
 * iniciales y CUIT), «Primeros pasos» y el «Día 1» de la guía.
 *
 * Ocupa un renglón: el avance, lo que sigue («Sigue: …», que es la acción) y
 * «Ver todo», que lleva a la guía con la lista completa. Desplegada muestra
 * los tres próximos pasos con su detalle; en el celular siempre es un solo
 * paso. Arriba de las tarjetas y abierta empujaba la primera acción del día
 * fuera de la primera pantalla.
 *
 * Lo que la pantalla ya ofrece en otro lado (los saldos iniciales en el héroe,
 * el cierre y el gasto en sus tarjetas) no se repite acá: lo saca
 * `setupNext`.
 *
 * Desplegada o no, lo recuerda la misma cookie que usaba «Ocultar» de Primeros
 * pasos (la lee el servidor, así no parpadea al cargar).
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
  /** «Puesta en marcha · 4 de 12» (o solo «Puesta en marcha» si no se sabe el avance). */
  title: string
  done: number
  /** 0 = no se sabe el avance: no se dibuja la barra. */
  total: number
  /** Hasta tres pasos pendientes que la pantalla no ofrece en otro lado, en el orden que conviene. */
  next: readonly SetupStep[]
  guideHref: string
  cookieName: string
  initialCollapsed: boolean
}) {
  const { openAction, readOnly } = useAccounting()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const listId = useId()
  const first = next[0]
  const canExpand = next.length > 1

  const toggle = () => {
    const value = !collapsed
    setCollapsed(value)
    try {
      // Un año; solo para este bar. No es un dato sensible: si se pierde, vuelve al renglón.
      // biome-ignore lint/suspicious/noDocumentCookie: cookie no-httpOnly leída por el server en el primer render (mismo patrón que hub_sidebar); Cookie Store API aún no es universal
      document.cookie = value
        ? `${cookieName}=; path=/; max-age=0; samesite=lax`
        : `${cookieName}=${SETUP_OPEN_VALUE}; path=/; max-age=31536000; samesite=lax`
    } catch {
      // Sin cookies: queda así hasta recargar.
    }
  }

  /** Un paso como algo que se toca (o como texto quieto, para quien solo lee). */
  const stepControl = (
    action: HomeAction | null,
    className: string,
    quietClassName: string,
    body: ReactNode,
  ) => {
    if (action === null) return <div className={quietClassName}>{body}</div>
    if (action.kind === 'href') {
      return (
        <Link href={action.href} className={className}>
          {body}
        </Link>
      )
    }
    return (
      <button
        type="button"
        onClick={() => openAction(action.sheet, action.params)}
        className={className}
      >
        {body}
      </button>
    )
  }

  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((done * 100) / total))) : 0

  return (
    <div className="@container rounded-2xl bg-secondary/50 px-4 py-2 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4">
        {/* En angosto: el título y «Ver todo» en un renglón, la barra debajo a todo el ancho
            y después lo que sigue. Con lugar, todo en una sola fila. */}
        <h3 className="order-1 font-serif text-base font-semibold leading-snug tracking-tight whitespace-nowrap">
          {title}
        </h3>
        {total > 0 ? (
          // Una barra continua: dieciséis rayitas sueltas se salían de la franja en 360 px.
          <div
            role="img"
            aria-label={`${done} de ${total} pasos hechos`}
            className="order-3 h-1.5 basis-full overflow-hidden rounded-full bg-foreground/12 @min-[52rem]:order-2 @min-[52rem]:w-36 @min-[52rem]:basis-auto"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        ) : null}

        {/* Lo que sigue, que es la acción. Desplegada no se repite: está primero en la lista
            (salvo en angosto, donde la lista no se muestra). */}
        {first
          ? stepControl(
              readOnly ? null : first.action,
              cn(
                'group order-4 flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring @min-[52rem]:order-3 @min-[52rem]:min-h-9 @min-[52rem]:w-auto @min-[52rem]:flex-1',
                !collapsed && canExpand && '@min-[40rem]:hidden',
              ),
              cn(
                'order-4 flex min-h-9 w-full min-w-0 items-center gap-1.5 text-sm @min-[52rem]:order-3 @min-[52rem]:w-auto @min-[52rem]:flex-1',
                !collapsed && canExpand && '@min-[40rem]:hidden',
              ),
              <>
                <span className="shrink-0 text-muted-foreground">
                  {readOnly ? 'Falta:' : 'Sigue:'}
                </span>
                <span className="min-w-0 truncate font-medium text-foreground underline-offset-4 group-hover:underline">
                  {first.title}
                </span>
                {readOnly || first.action === null ? null : (
                  <ArrowRight
                    aria-hidden
                    className="size-3.5 shrink-0 text-primary transition-[translate] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                )}
              </>,
            )
          : null}

        <div className="order-2 -mr-2 ml-auto flex shrink-0 items-center @min-[52rem]:order-4">
          <Link href={guideHref} className={QUIET_LINK}>
            Ver todo
          </Link>
          {canExpand ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-controls={listId}
              onClick={toggle}
              className={cn(
                QUIET_LINK,
                'hidden gap-1 text-muted-foreground hover:no-underline @min-[40rem]:inline-flex',
              )}
            >
              {collapsed ? `Mostrar los próximos ${next.length}` : 'Plegar'}
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-4 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                  !collapsed && 'rotate-180',
                )}
              />
            </button>
          ) : null}
        </div>
      </div>

      {canExpand ? (
        <div id={listId} hidden={collapsed} className="pb-1">
          {/* En angosto (el celular) siempre es un solo paso: el renglón de arriba. */}
          <ul className="-mx-3 hidden gap-x-2 gap-y-0.5 @min-[40rem]:grid @min-[52rem]:grid-cols-3">
            {next.map((step) => {
              const action = readOnly ? null : step.action
              return (
                <li key={step.id} className="flex">
                  {stepControl(
                    action,
                    ROW,
                    'flex w-full items-start gap-3 p-3',
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
                    </>,
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
