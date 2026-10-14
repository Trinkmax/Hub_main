'use client'

import { InstallmentDots } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/installment-dots'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Pill } from '@/components/administracion/kit'
import { Input } from '@/components/ui/input'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { nthDue, type RecurringFrequency } from '../../../_lib/recurring'
import { type InstallmentsDraft, installmentsValues } from '../_lib/form-payload'

/**
 * «¿Es en cuotas?», preguntado al derecho: «¿De cuántas cuotas es?» y «¿Por
 * cuál vas?» (antes se preguntaba cuántas FALTABAN contando la próxima). Los
 * puntitos se arman en vivo y dicen cuándo vence la última.
 *
 * Guarda lo mismo que antes: las dos formas escriben cuántas faltan (`dues`) y
 * de cuántas es (`installmentsTotal`); la cuenta está en `installmentsValues`.
 * «No sé de cuántas era» deja el campo de siempre («Faltan N»), que es también
 * como abre un gasto guardado sin total y uno que ya terminó.
 *
 * La usan la ficha y el chip «¿Es la cuota 6 de 6?» de «Completar la planilla»
 * (ahí sin la pregunta de arriba: `toggle={false}`).
 */

const LABEL = 'text-sm font-medium'
const LINK =
  'inline-flex cursor-pointer items-center rounded-sm text-left text-xs font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11'

function numberOf(text: string, max: number): number | null {
  const digits = text.replace(/\D/g, '').slice(0, 3)
  return digits === '' ? null : Math.min(max, Number(digits))
}

export function InstallmentsField({
  idPrefix,
  draft,
  onChange,
  nextDueDate,
  dueDay,
  frequency,
  endedOn = null,
  restore,
  suggested = null,
  toggle = true,
  error,
}: {
  idPrefix: string
  draft: InstallmentsDraft
  onChange: (draft: InstallmentsDraft) => void
  /** Para decir cuándo vence la última cuota. */
  nextDueDate: string
  dueDay: number
  frequency: RecurringFrequency
  /** Ya había terminado: el último vencimiento que tuvo. */
  endedOn?: string | null
  /** A qué volver al tocar «Sí, en cuotas» (lo que tenía guardado). */
  restore?: InstallmentsDraft
  /** Lo que dice el nombre («Licuadora 6/6»), para arrancar con esos números. */
  suggested?: { total: number; current: number } | null
  /** Muestra «¿Es en cuotas?» con sus dos píldoras. */
  toggle?: boolean
  error?: string
}) {
  const { dues } = installmentsValues(draft)
  const lastDue = dues !== null && dues > 0 ? nthDue(nextDueDate, dueDay, frequency, dues) : null
  const questionId = `${idPrefix}-cuotas`
  const ended = endedOn !== null && draft.mode === 'remaining' && draft.remaining === null

  const turnOn = () => {
    if (restore && restore.mode !== 'none') return onChange(restore)
    onChange({
      mode: 'total',
      total: suggested?.total ?? null,
      current: suggested?.current ?? null,
    })
  }

  return (
    <div className="grid gap-2.5">
      {toggle ? (
        <>
          <span id={questionId} className={LABEL}>
            ¿Es en cuotas?
          </span>
          <ChoiceChips
            labelledBy={questionId}
            value={draft.mode === 'none' ? 'no' : 'si'}
            onChange={(value) => (value === 'no' ? onChange({ mode: 'none' }) : turnOn())}
            options={[
              { value: 'no', label: 'No, es de siempre' },
              { value: 'si', label: 'Sí, en cuotas' },
            ]}
          />
        </>
      ) : null}

      {draft.mode === 'total' ? (
        <div className="grid gap-3 rounded-xl bg-secondary/50 p-3.5">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${idPrefix}-total`}
                className="text-xs font-medium text-muted-foreground"
              >
                ¿De cuántas cuotas es?
              </label>
              <Input
                id={`${idPrefix}-total`}
                value={draft.total === null ? '' : String(draft.total)}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                onChange={(event) =>
                  onChange({ ...draft, total: numberOf(event.target.value, 120) })
                }
                className="h-11 w-20 text-center text-base tabular-nums md:text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor={`${idPrefix}-current`}
                className="text-xs font-medium text-muted-foreground"
              >
                ¿Por cuál vas?
              </label>
              <Input
                id={`${idPrefix}-current`}
                value={draft.current === null ? '' : String(draft.current)}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                onChange={(event) =>
                  onChange({ ...draft, current: numberOf(event.target.value, 120) })
                }
                className="h-11 w-20 text-center text-base tabular-nums md:text-sm"
              />
            </div>
            <Pill
              size="touch"
              active={draft.total === 1 && draft.current === 1}
              onClick={() => onChange({ mode: 'total', total: 1, current: 1 })}
            >
              Es un solo pago
            </Pill>
          </div>
          {dues !== null && dues > 0 && draft.total !== null && draft.current !== null ? (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-pretty">
              <InstallmentDots
                size="md"
                current={draft.current}
                total={draft.total}
                remaining={dues}
              />
              <span>
                La próxima es la cuota {draft.current} de {draft.total}.
                {lastDue ? ` La última vence el ${formatIsoDay(lastDue)}.` : ''} Después sale sola
                de la planilla.
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground text-pretty">
              Por ejemplo, una compra en 6 cuotas de la que ya pagaste una: 6 y 2.
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({ mode: 'remaining', remaining: dues || null, total: null })}
            className={cn(LINK, 'justify-self-start')}
          >
            No sé de cuántas era: solo sé cuántas faltan
          </button>
        </div>
      ) : null}

      {draft.mode === 'remaining' ? (
        <div className="grid gap-3 rounded-xl bg-secondary/50 p-3.5">
          {ended && endedOn ? (
            <p className="text-sm text-pretty">
              Ya terminó: la última cuota venció el {formatIsoDay(endedOn)}. Para seguir, decí
              cuántas cuotas más faltan.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${idPrefix}-dues`} className="text-sm">
              Faltan
            </label>
            <Input
              id={`${idPrefix}-dues`}
              value={draft.remaining === null ? '' : String(draft.remaining)}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              onChange={(event) =>
                onChange({ ...draft, remaining: numberOf(event.target.value, 240) })
              }
              className="h-11 w-20 text-center text-base tabular-nums md:text-sm"
            />
            <span className="text-sm text-muted-foreground">
              {draft.remaining === 1 ? 'cuota' : 'cuotas'}, contando la próxima
            </span>
          </div>
          {lastDue ? (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-pretty">
              <InstallmentDots size="md" current={null} total={null} remaining={dues ?? 0} />
              <span>
                La última vence el {formatIsoDay(lastDue)}. Después sale sola de la planilla.
              </span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() =>
              onChange({ mode: 'total', total: suggested?.total ?? null, current: null })
            }
            className={cn(LINK, 'justify-self-start')}
          >
            Sé de cuántas era
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
