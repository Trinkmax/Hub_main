'use client'

import Link from 'next/link'
import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from 'react'
import { Amount } from '@/components/administracion/amount'
import { MoneyInput } from '@/components/administracion/money-input'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Los dos datos que se le cambian a un gasto fijo en el lugar, sin abrir la
 * ficha: cuánto es y qué día vence. Es la misma pieza en el renglón abierto de
 * la planilla y en cada renglón de «Completar».
 *
 * Solo dibuja y avisa: el guardado es de quien la usa (`useRowEdit`).
 * - Enter en cualquiera de los dos campos → `onCommit` (guardar). NUNCA envía
 *   un formulario ni sale de la pantalla.
 * - El foco sale de los dos campos → `onLeave` (guardar si cambió algo).
 * - Esc → `onRevert` (volver a lo último guardado).
 *
 * Con detalle (los sueldos) el monto es la suma del detalle y no se edita acá.
 */
export function RowQuickEdit({
  idPrefix,
  name,
  amountLabel = 'Monto',
  amountCents,
  onAmountChange,
  dueDay,
  onDueDayChange,
  detailTotalCents = null,
  fichaHref,
  onCommit,
  onLeave,
  onRevert,
  mark,
  amountRef,
  highlighted = false,
  enterKeyHint = 'done',
  className,
}: {
  idPrefix: string
  /** El nombre del gasto fijo, para los lectores («Monto de Alarma»). */
  name: string
  amountLabel?: string
  amountCents: number | null
  onAmountChange: (cents: number | null) => void
  dueDay: number | null
  onDueDayChange: (day: number | null) => void
  /** Con detalle: la suma, que reemplaza al campo. */
  detailTotalCents?: number | null
  fichaHref?: string
  onCommit: () => void
  onLeave: () => void
  onRevert: () => void
  /** La marca de guardado (`SaveMark`), al lado de los campos. */
  mark?: ReactNode
  amountRef?: Ref<HTMLInputElement>
  /** Lo completó «Pegar los montos» y todavía no se guardó. */
  highlighted?: boolean
  enterKeyHint?: 'next' | 'done'
  className?: string
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onRevert()
    }
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onLeave()
  }
  const amountId = `${idPrefix}-monto`
  const dayId = `${idPrefix}-dia`

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: no es un control: solo escucha que el foco salió de los dos campos, para guardar
    <div
      data-quick-edit=""
      onBlur={onBlur}
      className={cn('flex flex-wrap items-end gap-x-4 gap-y-3', className)}
    >
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={amountId} className="text-xs font-medium text-muted-foreground">
          {amountLabel}
          <span className="sr-only"> de {name}, en pesos</span>
        </label>
        {detailTotalCents !== null ? (
          <p className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
            <Amount cents={detailTotalCents} decimals={0} className="font-medium" />
            <span className="text-xs text-muted-foreground">(la suma del detalle)</span>
            {fichaHref ? (
              <Link
                href={fichaHref}
                className="rounded-sm text-xs font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cambiar en la ficha
              </Link>
            ) : null}
          </p>
        ) : (
          <MoneyInput
            id={amountId}
            value={amountCents}
            onValueChange={(cents) => onAmountChange(cents)}
            decimals="auto"
            minCents={1}
            align="end"
            enterKeyHint={enterKeyHint}
            onKeyDown={onKeyDown}
            inputRef={amountRef}
            className={cn(
              'w-40 [&_input]:md:h-11',
              highlighted && '[&_input]:border-warning/60 [&_input]:bg-warning/8',
            )}
          />
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={dayId} className="text-xs font-medium text-muted-foreground">
          Vence el día
          <span className="sr-only"> (de {name})</span>
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={dayId}
            value={dueDay === null ? '' : String(dueDay)}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint={enterKeyHint}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 2)
              onDueDayChange(digits === '' ? null : Math.min(31, Math.max(1, Number(digits))))
            }}
            className={cn(
              'h-11 w-16 text-center text-base tabular-nums md:text-sm',
              highlighted && 'border-warning/60 bg-warning/8',
            )}
          />
          <span className="text-xs text-muted-foreground">de cada mes</span>
        </div>
      </div>
      {mark ? (
        // Con mouse la marca tiene su lugar fijo (los campos no saltan). En el celular baja a su
        // renglón, y mientras no hay nada que decir no ocupa lugar (sigue ahí para los lectores).
        <div className="flex items-center max-sm:has-[[data-save=idle]]:sr-only sm:min-h-11">
          {mark}
        </div>
      ) : null}
    </div>
  )
}
