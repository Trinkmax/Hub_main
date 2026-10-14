'use client'

import { ChevronRight } from 'lucide-react'
import { type Dispatch, type SetStateAction, useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { DateField } from '@/components/administracion/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BOOKS_START_MAX_DAYS_BACK } from '@/lib/accounting/schemas'
import type { SasIvaCondition } from '@/lib/accounting/types'
import {
  addDays,
  capitalizeFirst,
  MONTH_NAMES,
  MONTH_NAMES_SHORT,
  monthName,
  startOfMonth,
} from '@/lib/dates'
import { cn } from '@/lib/utils'
import { describedBy, Field } from '../../../ajustes/_components/form-bits'
import { CuitInput, cuitIssue, INPUT_CLASS, SwitchRow } from '../../../ajustes/_components/inputs'
import { suggestedBooksStart, type WizardState } from '../../_lib/wizard'
import { BooksTimeline } from '../books-timeline'

/**
 * Paso 1 de la puesta en marcha · «¿Cómo figura el bar en los papeles?».
 *
 * A la vista, solo lo que la base exige o lo que después ya no se puede
 * cambiar: la razón social, el nombre de quien configura, desde qué día se va
 * a cargar y la condición frente al IVA. El resto de la constancia (CUIT,
 * domicilio, Ingresos Brutos…) puede esperar: va plegado y se completa después
 * en Ajustes › Datos de la SAS.
 *
 * La fecha se pregunta como lo que es, un piso: todo lo anterior a ese día no
 * se carga acá. Es el mismo campo y el mismo envío de siempre.
 */

const IVA_OPTIONS: readonly ChoiceChip<SasIvaCondition>[] = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
]

const IIBB_OPTIONS: readonly ChoiceChip<WizardState['iibbRegime']>[] = [
  { value: 'local', label: 'Local (Córdoba)' },
  { value: 'convenio_multilateral', label: 'Convenio Multilateral' },
  { value: 'exento', label: 'Exento' },
]

const END_MONTH_OPTIONS: readonly ChoiceChip<string>[] = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: capitalizeFirst(MONTH_NAMES_SHORT[index] ?? name),
  ariaLabel: capitalizeFirst(name),
}))

/** Los campos del bloque plegado: con un dato o un error en alguno, se abre. */
const EXTRA_FIELDS = [
  'cuit',
  'fiscalAddress',
  'iibbNumber',
  'activityStartDate',
  'fiscalYearEndMonth',
] as const

export function StepSas({
  state,
  errors,
  today,
  update,
  setState,
  setErrors,
  clearError,
}: {
  state: WizardState
  errors: Readonly<Record<string, string>>
  today: string
  update: (patch: Partial<WizardState>) => void
  setState: Dispatch<SetStateAction<WizardState>>
  setErrors: Dispatch<SetStateAction<Record<string, string>>>
  clearError: (...fields: string[]) => void
}) {
  const err = (field: string) => errors[field] ?? null
  const earliest = addDays(today, -BOOKS_START_MAX_DAYS_BACK)
  const firstOfMonth = startOfMonth(today)
  const hasExtras =
    state.cuit.trim() !== '' ||
    state.fiscalAddress.trim() !== '' ||
    state.iibbNumber.trim() !== '' ||
    state.activityStartDate !== null ||
    state.fiscalYearEndMonth !== 12 ||
    state.iibbRegime !== 'local' ||
    !state.ivaOnClose
  const [extrasOpen, setExtrasOpen] = useState(hasExtras)
  const extrasError = EXTRA_FIELDS.some((field) => err(field) !== null)
  // Un error ahí adentro lo abre solo (sin efecto: se resuelve al dibujar).
  const open = extrasOpen || extrasError

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="wz-legal-name" label="Razón social" required error={err('legalName')}>
          <Input
            id="wz-legal-name"
            value={state.legalName}
            maxLength={160}
            autoComplete="organization"
            aria-invalid={err('legalName') ? true : undefined}
            aria-describedby={describedBy('wz-legal-name', null, err('legalName'))}
            onChange={(e) => {
              update({ legalName: e.target.value })
              clearError('legalName')
            }}
            className={INPUT_CLASS}
          />
        </Field>
        <Field
          id="wz-display-name"
          label="Tu nombre en Administración"
          required
          hint="Así aparece en «Cargado por»."
          error={err('displayName')}
        >
          <Input
            id="wz-display-name"
            value={state.displayName}
            maxLength={80}
            autoComplete="name"
            aria-invalid={err('displayName') ? true : undefined}
            aria-describedby={describedBy('wz-display-name', true, err('displayName'))}
            onChange={(e) => {
              update({ displayName: e.target.value })
              clearError('displayName')
            }}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid gap-3">
        <DateField
          id="wz-books-start"
          label="¿Desde qué día querés cargar?"
          required
          value={state.booksStartDate}
          min={earliest}
          max={today}
          today={today}
          shortcuts={[
            {
              label: `1 de ${monthName(Number(firstOfMonth.slice(5, 7)))}`,
              value: firstOfMonth,
            },
            { label: 'Hoy', value: today },
          ]}
          hint="Todo lo anterior a ese día no se carga acá: entra como saldos iniciales. Si dudás, elegí el 1 del mes. Después del primer comprobante esta fecha ya no se cambia."
          error={err('booksStartDate')}
          // Una fecha no necesita 770 px: el campo a su medida y los atajos al lado.
          className="sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0 sm:[&>input]:w-48"
          onValueChange={(iso) => {
            update({ booksStartDate: iso, booksStartTouched: true })
            clearError('booksStartDate')
          }}
        />
        <BooksTimeline
          booksStartDate={state.booksStartDate}
          fiscalYearEndMonth={state.fiscalYearEndMonth}
        />
      </div>

      <div className="grid gap-1.5">
        <Label id="wz-iva-label">Condición frente al IVA</Label>
        <ChoiceChips
          options={IVA_OPTIONS}
          value={state.ivaCondition}
          labelledBy="wz-iva-label"
          onChange={(value) => update({ ivaCondition: value })}
        />
        <p className="text-xs text-muted-foreground text-pretty">
          Una SAS es responsable inscripta: si no sabés, dejalo así. Después del primer comprobante
          ya no se cambia.
        </p>
        {err('ivaCondition') ? (
          <p role="alert" className="text-xs text-destructive">
            {err('ivaCondition')}
          </p>
        ) : null}
      </div>

      <details
        open={open}
        onToggle={(e) => setExtrasOpen(e.currentTarget.open)}
        className="group/extras rounded-xl bg-secondary/50"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/extras:rotate-90 motion-reduce:transition-none"
          />
          <span className="min-w-0 text-pretty">
            Completar con la constancia{' '}
            <span className="font-normal text-muted-foreground">(puede esperar)</span>
          </span>
        </summary>
        <div className="grid gap-5 px-3 pb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="wz-cuit"
              label="CUIT"
              optional
              hint="Si todavía no la tenés a mano, dejala vacía: la van a pedir los libros de IVA."
              error={err('cuit')}
            >
              <CuitInput
                id="wz-cuit"
                value={state.cuit}
                invalid={Boolean(err('cuit'))}
                describedBy={describedBy('wz-cuit', true, err('cuit'))}
                onChange={(text) => {
                  update({ cuit: text })
                  if (!cuitIssue(text)) clearError('cuit')
                }}
                onBlurCheck={(issue) =>
                  setErrors((prev) => {
                    if (issue) return { ...prev, cuit: issue }
                    if (!('cuit' in prev)) return prev
                    const { cuit: _cuit, ...rest } = prev
                    return rest
                  })
                }
              />
            </Field>
            <Field id="wz-address" label="Domicilio fiscal" optional error={err('fiscalAddress')}>
              <Input
                id="wz-address"
                value={state.fiscalAddress}
                maxLength={200}
                autoComplete="street-address"
                aria-invalid={err('fiscalAddress') ? true : undefined}
                onChange={(e) => update({ fiscalAddress: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
            <div className="grid gap-1.5">
              <Label id="wz-iibb-label">Ingresos Brutos</Label>
              <ChoiceChips
                options={IIBB_OPTIONS}
                value={state.iibbRegime}
                labelledBy="wz-iibb-label"
                onChange={(value) => update({ iibbRegime: value })}
              />
            </div>
            <Field
              id="wz-iibb-number"
              label="N.º de inscripción"
              optional
              error={err('iibbNumber')}
            >
              <Input
                id="wz-iibb-number"
                value={state.iibbNumber}
                maxLength={30}
                inputMode="numeric"
                aria-invalid={err('iibbNumber') ? true : undefined}
                onChange={(e) => update({ iibbNumber: e.target.value })}
                className={cn(INPUT_CLASS, 'tabular-nums')}
              />
            </Field>
          </div>

          <div className="sm:max-w-xs">
            <DateField
              id="wz-activity-start"
              label="Inicio de actividades"
              optional
              value={state.activityStartDate}
              max={today}
              shortcuts={false}
              error={err('activityStartDate')}
              onValueChange={(iso) => {
                setState((s) => ({
                  ...s,
                  activityStartDate: iso,
                  booksStartDate: s.booksStartTouched
                    ? s.booksStartDate
                    : suggestedBooksStart(iso, today),
                }))
                clearError('activityStartDate', 'booksStartDate')
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label id="wz-fy-end-label">El ejercicio cierra en</Label>
            <ChoiceChips
              options={END_MONTH_OPTIONS}
              value={String(state.fiscalYearEndMonth)}
              labelledBy="wz-fy-end-label"
              onChange={(value) => update({ fiscalYearEndMonth: Number(value) })}
              className="grid max-w-md grid-cols-4 gap-2 sm:grid-cols-6 [&>button]:justify-center [&>button]:px-0"
            />
            <p className="text-xs text-muted-foreground text-pretty">
              Lo dice el estatuto de la SAS. Si no sabés, dejá diciembre y la contadora lo confirma.
            </p>
            {err('fiscalYearEndMonth') ? (
              <p role="alert" className="text-xs text-destructive">
                {err('fiscalYearEndMonth')}
              </p>
            ) : null}
          </div>

          <SwitchRow
            id="wz-iva-close"
            label="Liquidar el IVA al cerrar cada mes"
            description="Arma el asiento que deja el IVA del mes listo para pagar. Si la contadora prefiere hacerlo ella, apagalo."
            checked={state.ivaOnClose}
            onCheckedChange={(checked) => update({ ivaOnClose: checked })}
            className="bg-card"
          />
        </div>
      </details>
    </div>
  )
}
