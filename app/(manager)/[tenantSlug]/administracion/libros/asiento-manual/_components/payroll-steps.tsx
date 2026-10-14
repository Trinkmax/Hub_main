'use client'

import { Loader2, PencilLine } from 'lucide-react'
import type { ReactNode } from 'react'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { StepCard, type StepState } from '@/components/administracion/kit/step'
import {
  Ticket,
  TicketHeader,
  TicketLabel,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engineErrorsState } from '@/lib/accounting/errors'
import { payrollTemplateLines } from '@/lib/accounting/posting/manual'
import type { PostingContext } from '@/lib/accounting/types'
import {
  addDays,
  endOfMonth,
  formatDayMonth,
  formatMonthLabel,
  formatMonthYear,
  monthName,
  startOfMonth,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import type { InitialLine } from '../_lib/manual-entry'

/**
 * «Sueldos del mes»: el resumen de sueldos que manda la contadora, copiado en
 * tres pasos, con un ticket que se arma solo al lado. Antes era una grilla
 * Debe/Haber adentro de «Asiento manual» para copiar cuatro números.
 *
 * NO es otro formulario: es otra cara de `ManualEntryForm`. El estado, la
 * validación y el envío son los de siempre (`postManualEntry` con las mismas
 * líneas que arma `payrollTemplateLines`); acá vive solo lo que se ve y la
 * cuenta de las líneas, que antes hacía el botón «Armar las líneas» y ahora se
 * rehace sola con cada dato.
 */

// ─── La cuenta (pura) ────────────────────────────────────────────────────────

export type PayrollInputs = {
  gross: number | null
  contributions: number | null
  withheld: number | null
  union: number | null
  salariesDue: string | null
  socialDue: string | null
}

export const EMPTY_PAYROLL: PayrollInputs = {
  gross: null,
  contributions: null,
  withheld: null,
  union: null,
  salariesDue: null,
  socialDue: null,
}

export type PayrollField = 'gross' | 'contributions' | 'withheld'

export type PayrollBuild =
  | { state: 'ready'; lines: InitialLine[] }
  /** Falta un dato: el mismo texto que decía «Armar las líneas». */
  | { state: 'missing'; field: PayrollField; message: string }
  /** Los datos están pero no dan (los aportes superan al bruto): el texto del motor. */
  | { state: 'invalid'; field: PayrollField; message: string }

/**
 * Las líneas del asiento de sueldos, con las MISMAS revisiones y los mismos
 * textos que tenía «Armar las líneas»: primero el bruto, después las
 * contribuciones y los aportes, y recién ahí la plantilla del motor. Las fechas
 * de vencimiento entran en la plantilla, por eso se arma con los seis datos.
 */
export function payrollBuild(
  inputs: PayrollInputs,
  /** La fecha del asiento (`yyyy-MM-dd`). */
  date: string,
  ctx: PostingContext,
): PayrollBuild {
  if (inputs.gross === null || inputs.gross <= 0) {
    return { state: 'missing', field: 'gross', message: 'Cargá los sueldos brutos del mes.' }
  }
  if (inputs.contributions === null || inputs.withheld === null) {
    return {
      state: 'missing',
      field: inputs.contributions === null ? 'contributions' : 'withheld',
      message: 'Cargá las contribuciones patronales y los aportes (pueden ser cero).',
    }
  }
  const built = payrollTemplateLines(
    {
      grossSalariesCents: inputs.gross,
      employerContributionsCents: inputs.contributions,
      withheldContributionsCents: inputs.withheld,
      unionDuesCents: inputs.union ?? 0,
      date,
      salariesDueDate: inputs.salariesDue,
      socialSecurityDueDate: inputs.socialDue,
    },
    ctx,
  )
  if (!built.ok) {
    return { state: 'invalid', field: 'withheld', message: engineErrorsState(built.errors).message }
  }
  return {
    state: 'ready',
    lines: built.lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      partyId: l.partyId,
      dueDate: l.dueDate,
      memo: l.memo ?? '',
    })),
  }
}

/** «Sueldos de octubre de 2026»: el concepto que se completa solo. */
export function payrollDescription(date: string): string {
  return `Sueldos de ${formatMonthYear(date)}`
}

export type PayrollTicketData = {
  grossCents: number
  contributionsCents: number
  /** Sueldos brutos + contribuciones: lo que le cuesta el mes al bar. */
  costCents: number
  /** Lo que queda como deuda con el personal (el neto). */
  netCents: number
  /** Aportes y contribuciones (F.931). */
  socialCents: number
  unionCents: number
}

/**
 * Los importes del ticket, leídos de las líneas que el formulario va a mandar
 * (en el orden en que las arma el motor: sueldos, contribuciones, neto a
 * pagar, cargas sociales y, si hay, sindicato). `null` mientras no haya líneas.
 */
export function payrollTicket(lines: readonly InitialLine[] | null): PayrollTicketData | null {
  if (!lines || lines.length < 4) return null
  const [gross, contributions, net, social, union] = lines
  const grossCents = gross?.debitCents ?? 0
  const contributionsCents = contributions?.debitCents ?? 0
  return {
    grossCents,
    contributionsCents,
    costCents: grossCents + contributionsCents,
    netCents: net?.creditCents ?? 0,
    socialCents: social?.creditCents ?? 0,
    unionCents: union?.creditCents ?? 0,
  }
}

/**
 * Los atajos de «¿Con qué fecha queda?», en el orden en que se usan: fin del mes pasado, fin de
 * este (si entran en el límite) y hoy. Son UNA sola fila, la del campo de fecha: antes había dos
 * juegos de atajos («Hoy / Ayer» y los de fin de mes) con dos estilos de «elegida». El día va en
 * el campo apenas se toca el atajo (y en su nombre para lectores), por eso acá no se repite.
 */
export function payrollDateShortcuts(
  today: string,
  min: string,
): Array<{ date: string; label: string }> {
  const out: Array<{ date: string; label: string }> = []
  const previousEnd = addDays(startOfMonth(today), -1)
  for (const date of [previousEnd, endOfMonth(today)]) {
    if (date < min) continue
    out.push({ date, label: `Fin de ${monthName(Number(date.slice(5, 7)))}` })
  }
  // Si hoy es justo fin de mes, ese atajo ya lo dice.
  if (today >= min && !out.some((s) => s.date === today)) out.push({ date: today, label: 'Hoy' })
  return out
}

// ─── Lo que se ve ────────────────────────────────────────────────────────────

function PayrollTicket({
  build,
  inputs,
  date,
  className,
}: {
  build: PayrollBuild
  inputs: PayrollInputs
  date: string
  className?: string
}) {
  const data = payrollTicket(build.state === 'ready' ? build.lines : null)
  const dueHint = (iso: string | null) => (iso ? `vence ${formatDayMonth(iso)}` : undefined)
  return (
    <Ticket className={className} aria-label="Sueldos del mes">
      <TicketHeader title="Sueldos" subtitle={formatMonthLabel(date)} />
      <TicketRule />
      {data ? (
        <>
          <TicketRow label="Sueldos brutos" value={formatCentsShort(data.grossCents)} />
          <TicketRow
            label="Contribuciones patronales"
            value={formatCentsShort(data.contributionsCents)}
          />
          <TicketRule double />
          <TicketTotal label="Costo del mes" value={formatCentsShort(data.costCents)} />
          <TicketRule />
          <TicketLabel className="mb-1">Queda como deuda</TicketLabel>
          <TicketRow
            label="Con el personal"
            hint={dueHint(inputs.salariesDue)}
            value={formatCentsShort(data.netCents)}
          />
          <TicketRow
            label="Cargas sociales"
            hint={dueHint(inputs.socialDue)}
            value={formatCentsShort(data.socialCents)}
          />
          {data.unionCents > 0 ? (
            <TicketRow label="Sindicato" value={formatCentsShort(data.unionCents)} />
          ) : null}
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
          Cargá los importes y el ticket se arma solo.
        </p>
      )}
      <TicketNote>Cargar los sueldos no mueve plata: la plata sale cuando los pagás.</TicketNote>
    </Ticket>
  )
}

export function PayrollSteps({
  inputs,
  onInputsChange,
  build,
  fieldError,
  date,
  onDateChange,
  dateMin,
  dateMax,
  dateError,
  today,
  description,
  descriptionId,
  onDescriptionChange,
  descriptionError,
  preview,
  banner,
  pending,
  onEditLines,
  onOtherKind,
}: {
  inputs: PayrollInputs
  onInputsChange: (patch: Partial<PayrollInputs>) => void
  build: PayrollBuild
  /** El dato que frenó «Guardar los sueldos», con su texto. */
  fieldError: { field: PayrollField; message: string } | null
  date: string | null
  onDateChange: (iso: string | null) => void
  dateMin: string
  dateMax: string
  dateError: string | null
  today: string
  description: string
  descriptionId: string
  onDescriptionChange: (value: string) => void
  descriptionError: string | null
  /** Cómo queda en los libros (lo que arma el formulario, o lo que contestó el servidor). */
  preview: readonly EntryPreviewData[]
  /** El aviso del formulario (`FormBanner`), ya armado. */
  banner: ReactNode
  pending: boolean
  /** «Editar las líneas a mano»: pasa a la grilla con estas líneas. */
  onEditLines: () => void
  /** «Otro tipo de asiento»: vuelve al asiento manual. */
  onOtherKind: () => void
}) {
  const numbersDone = build.state === 'ready'
  const whenDone = numbersDone && Boolean(date) && description.trim() !== ''
  const states: [StepState, StepState, StepState] = [
    numbersDone ? 'done' : 'current',
    whenDone ? 'done' : numbersDone ? 'current' : 'todo',
    whenDone ? 'current' : 'todo',
  ]
  const errorOf = (field: PayrollField) =>
    fieldError?.field === field ? fieldError.message : undefined
  const shortcuts = payrollDateShortcuts(today, dateMin)
  const ticketDate = date ?? today

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-x-6">
      <StepCard
        open
        n={1}
        state={states[0]}
        title="Los números del resumen"
        summary="Los cuatro importes que te pasa tu contadora."
        className="min-w-0 lg:col-span-7 lg:col-start-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            id="sueldos-brutos"
            label="Sueldos brutos"
            value={inputs.gross}
            onValueChange={(c) => onInputsChange({ gross: c })}
            error={errorOf('gross')}
            required
          />
          <MoneyField
            id="sueldos-contribuciones"
            label="Contribuciones patronales"
            value={inputs.contributions}
            onValueChange={(c) => onInputsChange({ contributions: c })}
            error={errorOf('contributions')}
            required
          />
          <MoneyField
            id="sueldos-aportes"
            label="Aportes retenidos"
            hint="Lo que se descuenta del recibo (jubilación, obra social, PAMI)."
            value={inputs.withheld}
            onValueChange={(c) => onInputsChange({ withheld: c })}
            error={errorOf('withheld')}
            required
          />
          <MoneyField
            id="sueldos-sindicato"
            label="Cuota sindical"
            optional
            value={inputs.union}
            onValueChange={(c) => onInputsChange({ union: c })}
          />
        </div>
      </StepCard>

      <StepCard
        open
        n={2}
        state={states[1]}
        title="¿Cuándo se pagan?"
        summary="Los vencimientos son opcionales: sirven para que el sistema te avise."
        className="min-w-0 lg:col-span-7 lg:col-start-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            label="Vencen los sueldos"
            optional
            value={inputs.salariesDue}
            onValueChange={(iso) => onInputsChange({ salariesDue: iso })}
            shortcuts={false}
          />
          <DateField
            label="Vencen las cargas sociales"
            optional
            value={inputs.socialDue}
            onValueChange={(iso) => onInputsChange({ socialDue: iso })}
            shortcuts={false}
          />
          {/* A todo el ancho: el campo (del ancho de los de arriba), sus atajos en una fila y la
              pista debajo. Son los atajos del propio campo, con su estilo de siempre. */}
          <div className="sm:col-span-2">
            <DateField
              label="¿Con qué fecha queda?"
              required
              value={date}
              onValueChange={onDateChange}
              min={dateMin}
              max={dateMax}
              today={today}
              error={dateError}
              hint="Normalmente, el último día del mes de los sueldos."
              shortcuts={shortcuts.map((s) => ({ label: s.label, value: s.date }))}
              className="sm:[&>input]:max-w-[calc(50%-0.5rem)]"
            />
          </div>
          <div className="grid content-start gap-1.5 sm:col-span-2">
            <Label htmlFor={descriptionId}>
              Concepto
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id={descriptionId}
              value={description}
              maxLength={200}
              aria-invalid={descriptionError ? true : undefined}
              aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="h-11 text-base md:h-10 md:text-sm"
            />
            {descriptionError ? (
              <p id={`${descriptionId}-error`} role="alert" className="text-xs text-destructive">
                {descriptionError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Así va a figurar en los libros.</p>
            )}
          </div>
        </div>
      </StepCard>

      {/* El ticket: en el celular va acá, arriba del paso 3; en la compu, a la derecha y pegado. */}
      <div className="min-w-0 lg:sticky lg:top-20 lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1 lg:self-start">
        <PayrollTicket
          build={build}
          inputs={inputs}
          date={ticketDate}
          className="mx-auto max-w-sm lg:max-w-none"
        />
      </div>

      <StepCard
        open
        n={3}
        state={states[2]}
        title="Revisá y guardá"
        summary="Queda como deuda con el personal y con los organismos."
        className="min-w-0 lg:col-span-7 lg:col-start-1"
      >
        <div className="space-y-4">
          {banner}
          <Button
            type="submit"
            disabled={pending}
            className="h-12 w-full gap-2 px-6 text-base sm:w-auto"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Guardando…' : 'Guardar los sueldos'}
          </Button>
          <EntryPreview
            entries={preview}
            label="Ver cómo queda en los libros"
            emptyText="Cargá los importes para ver cómo queda en los libros."
            // En el celular el rótulo entra en dos renglones: cortado («Ver cómo queda en los…»)
            // perdía justo «libros». La pieza lo corta en uno; acá se le deja partir.
            className="max-sm:[&_button>span]:whitespace-normal"
          />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <button
              type="button"
              onClick={onEditLines}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              <PencilLine className="size-3.5" aria-hidden />
              Editar las líneas a mano
            </button>
            <button
              type="button"
              onClick={onOtherKind}
              className="inline-flex min-h-11 items-center rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              Otro tipo de asiento
            </button>
          </div>
        </div>
      </StepCard>
    </div>
  )
}
