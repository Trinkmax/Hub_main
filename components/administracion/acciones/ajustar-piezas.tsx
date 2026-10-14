'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MoneyInput } from '../money-input'
import { BILL_VALUES, billsTotalCents, type CountVerdict, exactMoney } from './ajustar-vista'
import { TEXT_LINK } from './sheet-parts'

/**
 * Las piezas propias de la hoja «¿Coincide la caja?»: el resultado del conteo
 * y el contador de billetes. Lo que dicen sale de `ajustar-vista.ts`.
 */

const VERDICT_TONE = {
  idle: 'border-transparent bg-secondary/50',
  ok: 'border-success/35 bg-success/8',
  warn: 'border-warning/45 bg-warning/10',
  info: 'border-info/30 bg-info/8',
} as const

// El rótulo va en tinta (AA sobre el lavado); el ámbar tiene su tinta propia.
// El tono lo dan el fondo, el borde y, si coincide, el tilde.
const VERDICT_LABEL = {
  idle: '',
  ok: 'text-foreground',
  warn: 'text-warning-text',
  info: 'text-foreground',
} as const

/**
 * El resultado del conteo: ES el número de la hoja. Una caja teñida por tono
 * con el rótulo («Coincide», «Faltan», «Sobran»), el número en grande y una
 * oración que dice qué va a pasar. Los tonos son los del cierre del día: falta
 * en ámbar, sobra en azul, coincide en verde con el tilde que se dibuja.
 *
 * Tiene el alto reservado para que nada salte mientras se escribe, y se
 * anuncia sin interrumpir (`role="status"`).
 */
export function Verdict({
  verdict,
  onUntickAll,
}: {
  verdict: CountVerdict
  /** Billetera: destildar todas las ventas en camino (solo se ofrece si `verdict.offerUntick`). */
  onUntickAll?: () => void
}) {
  const idle = verdict.tone === 'idle'
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-[7.25rem] flex-col justify-center rounded-2xl border px-4 py-3.5',
        VERDICT_TONE[verdict.tone],
      )}
    >
      {idle ? (
        <p className="text-sm text-muted-foreground text-pretty">{verdict.sentence}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p
              className={cn(
                'flex items-center gap-2 text-base font-semibold',
                VERDICT_LABEL[verdict.tone],
                // Sin número, el rótulo ES el resultado: va grande.
                verdict.amountCents === null && 'font-serif text-3xl tracking-tight',
              )}
            >
              {verdict.tone === 'ok' && verdict.amountCents === null ? (
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-4.5">
                    <path
                      className="adm-tick adm-tick-draw"
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="3.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : null}
              {verdict.label}
            </p>
            {verdict.amountCents !== null ? (
              <p className="ml-auto font-serif text-4xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums">
                {exactMoney(verdict.amountCents)}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-pretty">{verdict.sentence}</p>
          {verdict.offerUntick && onUntickAll ? (
            <button
              type="button"
              onClick={onUntickAll}
              className={cn(TEXT_LINK, 'self-start text-sm font-medium text-foreground underline')}
            >
              Destildar todas
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * «Ayudame a contar los billetes»: una ayuda para sumar, nada más. Se anota
 * cuántos billetes hay de cada uno y devuelve el total; NO se guarda cuántos
 * había (lo que queda es el total que se escribe en el campo).
 */
export function BillCounter({ onUse }: { onUse: (cents: number) => void }) {
  const id = useId()
  const [quantities, setQuantities] = useState<Record<number, number | null>>({})
  const [loose, setLoose] = useState<number | null>(null)
  const total = billsTotalCents(quantities, loose)

  return (
    <div className="space-y-3 rounded-xl bg-secondary/50 p-3 sm:p-4">
      <p className="text-sm font-medium">¿Cuántos billetes hay de cada uno?</p>
      <ul className="divide-y divide-border/60">
        {BILL_VALUES.map((value) => {
          const inputId = `${id}-${value}`
          const quantity = quantities[value] ?? null
          return (
            <li key={value} className="flex items-center gap-3 py-1.5">
              <label htmlFor={inputId} className="w-24 shrink-0 text-sm font-medium tabular-nums">
                {formatCentsShort(value * 100)}
              </label>
              <span aria-hidden className="text-sm text-muted-foreground">
                ×
              </span>
              <Input
                id={inputId}
                value={quantity === null ? '' : String(quantity)}
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                placeholder="0"
                aria-label={`Cantidad de billetes de ${formatCentsShort(value * 100)}`}
                className="h-11 w-20 text-center text-base tabular-nums md:h-9 md:text-sm"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '')
                  setQuantities((prev) => ({
                    ...prev,
                    [value]: digits === '' ? null : Number(digits),
                  }))
                }}
              />
              <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                {quantity ? formatCentsShort(quantity * value * 100) : '—'}
              </span>
            </li>
          )
        })}
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
          <label htmlFor={`${id}-sueltos`} className="min-w-0 flex-1 basis-40 text-sm font-medium">
            Monedas y billetes más chicos
          </label>
          <MoneyInput
            id={`${id}-sueltos`}
            value={loose}
            onValueChange={(cents) => setLoose(cents)}
            align="end"
            className="w-40"
          />
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Total contado </span>
          {/* Exacto: es el número que «Usar este total» pone en el campo (las monedas traen centavos). */}
          <span className="font-serif text-xl font-semibold tabular-nums">{exactMoney(total)}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-4 md:h-9"
          disabled={total <= 0}
          onClick={() => onUse(total)}
        >
          Usar este total
        </Button>
      </div>
    </div>
  )
}
