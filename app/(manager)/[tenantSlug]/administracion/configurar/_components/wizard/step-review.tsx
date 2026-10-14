'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketLabel,
  TicketNote,
  TicketRule,
} from '@/components/administracion/kit/ticket'
import { Button } from '@/components/ui/button'
import { formatIsoDay } from '@/lib/dates'
import { Callout } from '../../../ajustes/_components/form-bits'
import type { WizardState } from '../../_lib/wizard'
import { enabledMethodCount, puntosSummary, treasuryNames } from '../../_lib/wizard-steps'

/**
 * Paso 5 de la puesta en marcha · «Revisá y arrancá».
 *
 * Todo lo elegido, en palabras, sobre un ticket: es lo que se va a crear. Hasta
 * acá no se guardó nada; el botón de este paso es el ÚNICO guardado del
 * asistente (`bootstrapAccounting`, con el envío de siempre). Es `submit`: un
 * Enter en cualquier campo de los pasos de arriba no llega hasta acá.
 */

/** Un renglón del ticket con texto (no un importe): el rótulo arriba y el dato abajo, entero. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1.5">
      <TicketLabel>{label}</TicketLabel>
      <p className="mt-0.5 text-sm font-medium text-pretty [overflow-wrap:anywhere]">{children}</p>
    </div>
  )
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

export function StepReview({
  state,
  pending,
  saved,
  banner,
  formError,
  continueHref,
}: {
  state: WizardState
  pending: boolean
  /** Ya se guardó: la página está pasando sola a los saldos iniciales. */
  saved: boolean
  banner: {
    tone: 'error' | 'info'
    message: string
    action?: { label: string; href: string }
  } | null
  formError: string | null
  /** A dónde seguir si la pantalla no cambia sola después de guardar. */
  continueHref: string
}) {
  const methods = enabledMethodCount(state)
  const boxes = treasuryNames(state)
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start md:gap-8">
      <Ticket aria-label="Lo que se va a armar" className="mx-auto w-full max-w-sm">
        <TicketHeader title="Puesta en marcha" subtitle="Lo que se va a armar" />
        <div className="mt-4">
          <TicketRule />
        </div>
        <Line label="Razón social">{state.legalName.trim() || 'Sin razón social'}</Line>
        <Line label="Cargás desde el">
          {state.booksStartDate ? formatIsoDay(state.booksStartDate) : 'Falta elegir el día'}
        </Line>
        <Line label="Cajas y cuentas">{boxes.length > 0 ? joinNames(boxes) : 'Ninguna'}</Line>
        <Line label="Medios prendidos">
          {methods === 0 ? 'Ninguno' : `${methods} ${methods === 1 ? 'medio' : 'medios'}`}
        </Line>
        <Line label="Puntos de venta">{puntosSummary(state)}</Line>
        <TicketRule />
        <TicketNote>Vas a quedar como quien da los accesos.</TicketNote>
      </Ticket>

      <div className="grid content-start gap-4">
        <p className="text-sm leading-relaxed text-pretty">
          Hasta acá no se guardó nada: al tocar el botón se arma todo junto.
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          Después siguen los saldos iniciales: cuánta plata había en cada caja y cuánto se debía el
          día que elegiste.
        </p>
        {banner ? (
          <Callout
            tone={banner.tone}
            action={
              banner.action ? (
                <Button asChild variant="outline" className="h-11">
                  <Link href={banner.action.href}>{banner.action.label}</Link>
                </Button>
              ) : undefined
            }
          >
            {banner.message}
          </Callout>
        ) : null}
        {formError ? <Callout tone="error">{formError}</Callout> : null}
        {saved ? (
          <div role="status" className="rounded-xl bg-secondary/50 p-4">
            <p className="font-serif text-lg font-semibold tracking-tight">
              Listo: Administración quedó configurada.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Abriendo los saldos iniciales…{' '}
              <Link
                href={continueHref}
                className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Seguir con los saldos iniciales
              </Link>
            </p>
          </div>
        ) : (
          <div>
            <Button
              type="submit"
              className="h-12 w-full min-w-[220px] px-6 text-base sm:w-auto"
              disabled={pending}
            >
              {pending ? 'Configurando…' : 'Guardar y arrancar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
