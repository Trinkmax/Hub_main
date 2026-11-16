'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  cleanInstallments,
  INSTALLMENT_CHOICES,
  installmentAmountCents,
  installmentsLabel,
  MAX_INSTALLMENTS,
} from '@/lib/accounting/installments'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * «¿En cuántas cuotas?»: aparece cuando lo que se eligió para pagar es una tarjeta de crédito
 * (pedido de los socios, 16/11/2026). Las de siempre de un toque; cualquier otra se escribe.
 */
export function InstallmentsField({
  value,
  onChange,
  amountCents = null,
  disabled = false,
  compact = false,
  className,
}: {
  /** 1 = un solo pago. */
  value: number
  onChange: (installments: number) => void
  /** El total del pago, para decir cuánto es cada cuota. */
  amountCents?: number | null
  disabled?: boolean
  /** En una fila angosta (la tira de gastos fijos): sin el renglón de ayuda. */
  compact?: boolean
  className?: string
}) {
  const id = useId()
  const listed = (INSTALLMENT_CHOICES as readonly number[]).includes(value)
  const [custom, setCustom] = useState(!listed)
  const each = installmentAmountCents(amountCents, value)
  return (
    <fieldset className={cn('grid min-w-0 gap-1.5', className)} disabled={disabled}>
      <legend id={`${id}-label`} className="mb-1.5 text-sm font-medium">
        ¿En cuántas cuotas?
      </legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {INSTALLMENT_CHOICES.map((choice) => {
          const on = !custom && value === choice
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCustom(false)
                onChange(choice)
              }}
              className={cn(
                'inline-flex h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-secondary',
              )}
            >
              {choice === 1 ? '1 pago' : choice}
            </button>
          )
        })}
        {custom ? (
          <Input
            id={`${id}-otra`}
            aria-label="Otra cantidad de cuotas"
            inputMode="numeric"
            autoFocus
            defaultValue={value > 1 && !listed ? String(value) : ''}
            placeholder="¿Cuántas?"
            maxLength={2}
            onChange={(event) => onChange(cleanInstallments(event.target.value))}
            className="h-11 w-24 tabular-nums md:h-8"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              // El casillero arranca vacío, y vacío es un solo pago: el renglón de abajo no promete
              // cuotas que todavía nadie escribió.
              setCustom(true)
              onChange(1)
            }}
            className="inline-flex h-11 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:h-8"
          >
            Otra
          </button>
        )}
      </div>
      {compact ? null : (
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {value > 1
            ? each !== null
              ? `${installmentsLabel(value)} de ${formatCentsShort(each)}. La deuda con la tarjeta entra entera hoy.`
              : `${installmentsLabel(value)}. La deuda con la tarjeta entra entera hoy.`
            : `Hasta ${MAX_INSTALLMENTS} cuotas.`}
        </p>
      )}
    </fieldset>
  )
}
