'use client'

import { CalendarClock, HandCoins, ReceiptText, Repeat, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { ChoiceCard, MoneyTicker } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { RadioChips } from '../../_components/form-feedback'
import type { DueChoice } from '../../_lib/purchase-paper'

/**
 * Las piezas de «Cargar una compra que debo» que solo dibujan: el campo con su
 * etiqueta, el proveedor ya elegido, los chips de «¿Cuándo vence?», las dos
 * respuestas de «¿Cuándo le pagás?» y la barra del celular con el total. El
 * estado, las validaciones y el envío viven en `purchase-form.tsx`: nada de acá
 * guarda ni decide qué se manda.
 */

/** La voz de una pregunta adentro de una sección (un escalón bajo el título de la sección). */
export const STEP_QUESTION = 'text-sm font-semibold leading-snug'

/** Un link callado dentro de una sección («Es otro papel», «Cambiar»). 44 px en el celular. */
export const STEP_LINK =
  'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/** Un campo con su etiqueta, su ayuda y su error en su lugar. */
export function StepField({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** El proveedor ya elegido: su nombre, lo que se le debe hoy y [Cambiar]. */
export function SupplierPicked({
  name,
  detail,
  debtCents,
  onChange,
}: {
  name: string
  /** «Responsable inscripto · CUIT 30-…», en gris. */
  detail: string | null
  /** Lo que se le debe hoy; `null` si no se pudo leer o no se le debe nada. */
  debtCents: number | null
  onChange: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-secondary/50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="font-medium leading-snug text-pretty [overflow-wrap:anywhere]">{name}</p>
        {detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{detail}</p>
        ) : null}
        {debtCents !== null && debtCents > 0 ? (
          <p className="mt-1 text-sm text-pretty">
            Hoy le debés{' '}
            <span className="font-semibold whitespace-nowrap tabular-nums">
              {formatCentsShort(debtCents)}
            </span>
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mr-1.5 h-11 shrink-0 gap-1.5 text-muted-foreground md:h-8"
        onClick={onChange}
      >
        <X className="size-3.5" aria-hidden />
        Cambiar
      </Button>
    </div>
  )
}

/** «Es «Alquiler»: queda marcado como cargado este mes.» con su ✕ para desmarcarlo. */
export function RecurringLinked({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 py-1 pr-1 pl-3.5 text-sm">
      <span className="inline-flex min-w-0 items-center gap-2 text-pretty">
        <Repeat className="size-4 shrink-0 text-success" aria-hidden />
        Es «{name}»: queda marcado como cargado este mes.
      </span>
      <button
        type="button"
        aria-label={`No es «${name}»`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-9"
        onClick={onClear}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** Los gastos fijos de este mes que son de ese proveedor: «Es «Alquiler» de octubre». */
export function RecurringOffers({
  options,
  onPick,
}: {
  options: ReadonlyArray<{ id: string; name: string; nextDueDate: string }>
  onPick: (id: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="grid gap-2">
      <p className={STEP_QUESTION}>¿Es un gasto fijo?</p>
      <div className="flex flex-wrap gap-2">
        {options.map((r) => (
          <Button
            key={r.id}
            type="button"
            variant="outline"
            className="h-11 max-w-full gap-1.5 rounded-full md:h-9"
            onClick={() => onPick(r.id)}
          >
            <Repeat className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Es «{r.name}» (vence el {formatIsoDay(r.nextDueDate)})
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * «¿Cuándo vence?»: chips que escriben la fecha de vencimiento de siempre.
 * Queda marcado el que coincide con la que el formulario ya tiene. «Otra
 * fecha» abre el campo (`dateField`).
 */
export function DueChips({
  labelId,
  choices,
  onPick,
  invalid,
  dateField,
}: {
  labelId: string
  choices: readonly DueChoice[]
  onPick: (choice: DueChoice) => void
  invalid?: boolean
  /** El campo de fecha, cuando está elegida «Otra fecha». */
  dateField: ReactNode
}) {
  const active = choices.find((c) => c.active) ?? null
  return (
    <div className="grid gap-2.5">
      <RadioChips
        labelledBy={labelId}
        value={active?.key ?? null}
        invalid={invalid}
        options={choices.map((c) => ({ value: c.key, label: c.label }))}
        onChange={(key) => {
          const choice = choices.find((c) => c.key === key)
          if (choice) onPick(choice)
        }}
      />
      {dateField}
    </div>
  )
}

/**
 * «¿Cuándo le pagás?»: las dos respuestas, cada una con su consecuencia
 * escrita. Reemplazan al botón de guardar y pagar de antes, que no guardaba: abría un
 * bloque de pago más abajo.
 */
export function PayWhenCards({
  name,
  paying,
  onChange,
}: {
  name: string
  paying: boolean
  onChange: (paying: boolean) => void
}) {
  return (
    <div role="radiogroup" aria-label="¿Cuándo le pagás?" className="grid gap-2.5 @lg:grid-cols-2">
      <ChoiceCard
        name={name}
        value="despues"
        checked={!paying}
        onChange={() => onChange(false)}
        title="Más adelante: lo debo"
        consequence="Queda anotado en su libreta hasta que le pagues."
        art={
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <CalendarClock className="size-5" />
          </span>
        }
      />
      <ChoiceCard
        name={name}
        value="ahora"
        checked={paying}
        onChange={() => onChange(true)}
        title="Ya lo pagué"
        consequence="Sale de la caja ahora. No queda deuda."
        art={
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <HandCoins className="size-5" />
          </span>
        }
      />
    </div>
  )
}

/**
 * Sin lugar para el ticket al costado (celular, tablet, notebook chica): el
 * total siempre a la vista y el ticket a un toque. Va pegada abajo DENTRO de la
 * página (no fija a la pantalla): así no pisa el menú del costado. La misma
 * barra del cierre del día.
 */
export function TicketBar({
  label,
  totalCents,
  onOpen,
}: {
  /** «Le vas a deber», «Pagás ahora», «Queda a tu favor». */
  label: string
  totalCents: number | null
  onOpen: () => void
}) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-6 -mb-6 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md sm:-mx-6 sm:-mb-8 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              'mt-0.5 font-serif font-semibold leading-none tracking-tight whitespace-nowrap',
              // Nueve cifras no entran al lado del botón en un celular angosto.
              (totalCents ?? 0) >= 100_000_000_00 ? 'text-xl' : 'text-2xl',
            )}
          >
            {totalCents !== null && totalCents > 0 ? (
              <MoneyTicker
                cents={totalCents}
                decimals={totalCents % 100 === 0 ? 0 : 2}
                durationMs={380}
              />
            ) : (
              <span className="text-muted-foreground">
                <span aria-hidden>—</span>
                <span className="sr-only">Todavía sin importe</span>
              </span>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 gap-2 rounded-full px-4"
          onClick={onOpen}
        >
          <ReceiptText className="size-4" aria-hidden />
          Ver ticket
        </Button>
      </div>
    </div>
  )
}
