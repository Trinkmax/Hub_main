'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { documentHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Meter } from '@/components/administracion/charts/meter'
import { StatusPill } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { capitalizeFirst } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { NextUpView, SheetSetup } from '../_lib/planilla-words'

/**
 * «Lo que sigue»: la acción del momento, al lado del número de arriba. Una
 * sola cosa por estado (qué estado es lo decide `nextUpView`, en el server):
 * pagar el que sigue, los tres pasos para arrancar, lo primero que vence el
 * mes que viene, o que ya no queda nada.
 *
 * Es el ÚNICO botón primario de la planilla. Usado de corrido es el repaso
 * del mes: pagás, la hoja de carga se cierra, el número baja y el botón ya
 * nombra el siguiente. «Pagar» abre «Nuevo gasto» con ese gasto fijo ya puesto
 * (`?accion=gasto&gasto-fijo=`), o «Pagar» con su proveedor si la factura ya
 * estaba cargada.
 *
 * A quien solo mira no se le dibuja ningún botón ni link de carga.
 */

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground'
const LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'

function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl bg-secondary/50 p-4', className)}>{children}</div>
}

/** El círculo de un paso: tilde si está hecho, número relleno si toca, número gris si falta. */
function StepDot({ n, state }: { n: number; state: 'done' | 'current' | 'todo' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        state === 'done' && 'border-success/40 bg-success/12 text-success',
        state === 'current' &&
          'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
        state === 'todo' && 'border-border bg-card text-muted-foreground',
      )}
    >
      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : n}
    </span>
  )
}

function SetupSteps({
  setup,
  fillHref,
  miscHref,
}: {
  setup: SheetSetup
  fillHref: string
  miscHref: string
}) {
  const withAmount = setup.total - setup.missing
  const first = setup.missing === 0 ? 'done' : 'current'
  const second = setup.misc === 0 ? 'done' : first === 'done' ? 'current' : 'todo'
  const third = setup.everPaid ? 'done' : 'todo'
  const word = (state: 'done' | 'current' | 'todo') =>
    state === 'done' ? 'Hecho' : state === 'current' ? 'Te toca' : 'Falta'

  return (
    <Box>
      <p className={LABEL}>Para arrancar</p>
      <ol className="mt-3 space-y-4">
        <li className="flex gap-3">
          <StepDot n={1} state={first} />
          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="font-medium leading-snug">
              <span className="sr-only">Paso 1, {word(first).toLowerCase()}: </span>
              Poné cuánto pagás y qué día vence
            </p>
            <div className="space-y-1.5">
              <Meter
                valueCents={withAmount}
                totalCents={setup.total}
                ariaLabel={`${withAmount} de ${setup.total} con monto`}
              />
              <p className="text-sm text-muted-foreground">
                <span className="tabular-nums">
                  {withAmount} de {setup.total}
                </span>{' '}
                con monto.
                {setup.sameDay !== null ? ` Hoy todos dicen el día ${setup.sameDay}.` : ''}
              </p>
            </div>
            <Button asChild className="h-12 w-full rounded-xl text-base">
              <Link href={fillHref}>Completar la planilla</Link>
            </Button>
          </div>
        </li>
        <li className="flex gap-3">
          <StepDot n={2} state={second} />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              <span className="sr-only">Paso 2, {word(second).toLowerCase()}: </span>
              Decí en qué se gastan
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
              {setup.misc === 0 ? (
                'Cada uno ya tiene su categoría.'
              ) : (
                <>
                  {setup.misc === 1 ? '1 está' : `${setup.misc} están`} en «Gastos varios».{' '}
                  <Link href={miscHref} className={LINK}>
                    Ordenarlos
                  </Link>
                </>
              )}
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepDot n={3} state={third} />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              <span className="sr-only">Paso 3, {word(third).toLowerCase()}: </span>
              Pagalos desde acá
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
              Cuando pagues uno, tocá Pagar en su renglón: queda tildado y baja lo que te falta.
            </p>
          </div>
        </li>
      </ol>
    </Box>
  )
}

export function NextUp({
  view,
  canWrite,
  fillHref,
  miscHref,
  nextMonthHref,
  nextMonthLabel,
  className,
}: {
  view: NextUpView
  canWrite: boolean
  /** «Completar la planilla». */
  fillHref: string
  /** «Completar», parado en los de «Gastos varios». */
  miscHref: string
  /** La hoja del mes que viene. */
  nextMonthHref: string
  /** «Ver noviembre». */
  nextMonthLabel: string
  className?: string
}) {
  const { tenantSlug, readOnly, openAction } = useAccounting()
  const writes = canWrite && !readOnly

  switch (view.kind) {
    case 'none':
      return null
    case 'setup':
      return writes ? (
        <div className={className}>
          <SetupSteps setup={view.setup} fillHref={fillHref} miscHref={miscHref} />
        </div>
      ) : null
    case 'setup_readonly':
      return (
        <Box className={className}>
          <p className={LABEL}>Todavía sin montos</p>
          <p className="mt-2 text-sm text-pretty">{view.text}</p>
        </Box>
      )
    case 'first_due':
      return (
        <Box className={className}>
          <p className={LABEL}>Lo primero que vence</p>
          <p className="mt-2 font-serif text-xl font-semibold leading-snug tracking-tight text-balance">
            {view.when}
          </p>
          <p className="mt-1 text-sm tabular-nums">{view.detail}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{view.daysText}</p>
        </Box>
      )
    case 'all_paid':
      return (
        <Box className={className}>
          <p className={LABEL}>Lo que sigue</p>
          <p className="mt-2 font-serif text-xl font-semibold leading-snug tracking-tight text-balance">
            {view.text}
          </p>
          {view.nextMonth ? (
            <p className="mt-2 text-sm">
              <Link href={nextMonthHref} className={LINK}>
                {nextMonthLabel}
              </Link>
            </p>
          ) : null}
        </Box>
      )
    case 'review':
      return (
        <Box className={className}>
          <p className={LABEL}>Lo que sigue</p>
          <p className="mt-2 text-sm text-pretty">{view.text}</p>
        </Box>
      )
    case 'pay': {
      const { action } = view
      const amount = view.amountCents === null ? null : formatCentsShort(view.amountCents)
      return (
        <Box className={className}>
          <p className={LABEL}>Lo que sigue</p>
          <p
            className="mt-2 line-clamp-2 font-serif text-xl font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]"
            title={view.name}
          >
            {view.name}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {view.status.tone ? (
              <StatusPill tone={view.status.tone}>{view.status.label}</StatusPill>
            ) : (
              <span className="text-sm text-muted-foreground">{view.status.label}</span>
            )}
            {view.status.detail ? (
              <span className="text-xs text-muted-foreground">
                {capitalizeFirst(view.status.detail)}
              </span>
            ) : null}
          </p>
          {view.billed ? (
            <p className="mt-2 text-sm text-pretty">Ya cargaste la factura: falta pagarla.</p>
          ) : null}
          {writes ? (
            action.kind === 'document' ? (
              <Button asChild className="mt-3 h-12 w-full rounded-xl text-base">
                <Link href={documentHref(tenantSlug, action.documentId)}>
                  Ver la factura y pagarla
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                className="mt-3 h-12 w-full rounded-xl text-base"
                onClick={() =>
                  action.kind === 'gasto'
                    ? openAction('gasto', { 'gasto-fijo': action.recurringId })
                    : openAction('pagar', { proveedor: action.partyId })
                }
              >
                {amount ? `Pagar ${amount}` : 'Pagar'}
              </Button>
            )
          ) : null}
          {writes && amount === null ? (
            <p className="mt-2 text-xs text-muted-foreground">Sin monto: lo ponés al pagar.</p>
          ) : null}
          {view.after ? (
            <p className="mt-2.5 text-xs text-muted-foreground text-pretty">{view.after}</p>
          ) : null}
        </Box>
      )
    }
  }
}
