'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { DateField } from '@/components/administracion/date-input'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveSettings } from '@/lib/accounting/actions/master'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type { SasIvaCondition } from '@/lib/accounting/types'
import { addDays, formatIsoDay } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import {
  CLOSED_PERIOD_VOID_LABELS,
  FISCAL_END_MONTH_OPTIONS,
  IIBB_REGIME_LABELS,
  SAS_IVA_CONDITION_LABELS,
  UNINVOICED_SALES_LABELS,
} from '../_lib/labels'
import { bpToPercentInput, parsePercentToBp } from '../_lib/percent'
import { settingsPayload } from '../_lib/settings-payload'
import { Callout, describedBy, Field } from './form-bits'
import { CuitInput, cuitIssue, INPUT_CLASS, PercentInput, SwitchRow } from './inputs'
import { useMasterAction } from './use-master-action'

const LOCKED_BY_DOCUMENTS =
  'Ya hay comprobantes cargados: este dato no se puede cambiar. Hablalo con la contadora.'
const LOCKED_BY_CLOSES =
  'Ya hay meses cerrados o comprobantes: el cierre del ejercicio no se cambia desde acá.'

/** Errores de `saveSettings` → campos (los de la base sin campo van arriba de los botones). */
function failureErrors(state: AccFailureState): Record<string, string> {
  const out: Record<string, string> = { ...(state.fieldErrors ?? {}) }
  const key = typeof state.detail?.key === 'string' ? state.detail.key : null
  if (key === 'invalid_cuit' && !out.cuit) out.cuit = state.message
  if (Object.keys(out).length === 0) out.form = state.message
  return out
}

function useFocusFirstError(errors: Record<string, string>) {
  const formRef = useRef<HTMLFormElement | null>(null)
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])
  return formRef
}

function SaveBar({ pending, message }: { pending: boolean; message: string | null }) {
  return (
    <>
      {message ? <Callout tone="error">{message}</Callout> : null}
      <div className="flex justify-end">
        <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </>
  )
}

// ─── Datos de la SAS ─────────────────────────────────────────────────────────

const IVA_OPTIONS: readonly ChoiceChip<SasIvaCondition>[] = (
  Object.keys(SAS_IVA_CONDITION_LABELS) as SasIvaCondition[]
).map((value) => ({ value, label: SAS_IVA_CONDITION_LABELS[value] }))

type IibbRegime = AccountingSettings['iibbRegime']
const IIBB_OPTIONS: readonly ChoiceChip<IibbRegime>[] = (
  Object.keys(IIBB_REGIME_LABELS) as IibbRegime[]
).map((value) => ({ value, label: IIBB_REGIME_LABELS[value] }))

/** Ajustes › Datos de la SAS (H.17): los del paso 1 del asistente; lo bloqueado dice por qué. */
export function SasSettingsForm({
  tenantSlug,
  settings,
  today,
}: {
  tenantSlug: string
  settings: AccountingSettings
  today: string
}) {
  const [legalName, setLegalName] = useState(settings.legalName)
  const [cuit, setCuit] = useState(settings.cuit ? formatCuit(settings.cuit) : '')
  const [ivaCondition, setIvaCondition] = useState<SasIvaCondition>(settings.ivaCondition)
  const [iibbRegime, setIibbRegime] = useState<IibbRegime>(settings.iibbRegime)
  const [iibbNumber, setIibbNumber] = useState(settings.iibbNumber ?? '')
  const [activityStart, setActivityStart] = useState<string | null>(settings.activityStartDate)
  const [address, setAddress] = useState(settings.fiscalAddress ?? '')
  const [booksStart, setBooksStart] = useState<string | null>(settings.booksStartDate)
  const [endMonth, setEndMonth] = useState(settings.fiscalYearEndMonth)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { pending, run } = useMasterAction()
  const formRef = useFocusFirstError(errors)

  const docsLocked = settings.hasDocuments
  const endLocked = settings.hasDocuments || settings.hasClosedPeriods
  const err = (k: string) => errors[k] ?? null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const issue = cuitIssue(cuit)
    if (issue) {
      setErrors({ cuit: issue })
      return
    }
    setErrors({})
    run(
      () =>
        saveSettings(
          tenantSlug,
          settingsPayload(settings, {
            legalName,
            cuit: cuit.trim() ? normalizeCuit(cuit) : null,
            ivaCondition: docsLocked ? settings.ivaCondition : ivaCondition,
            iibbRegime,
            iibbNumber: iibbNumber.trim() || null,
            activityStartDate: activityStart,
            fiscalAddress: address.trim() || null,
            booksStartDate: docsLocked ? settings.booksStartDate : (booksStart ?? ''),
            fiscalYearEndMonth: endLocked ? settings.fiscalYearEndMonth : endMonth,
          }),
        ),
      { onFailure: (state) => setErrors(failureErrors(state)) },
    )
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="card-hairline space-y-5 rounded-xl border bg-card p-6"
    >
      <Field id="aj-legal-name" label="Razón social" required error={err('legalName')}>
        <Input
          id="aj-legal-name"
          value={legalName}
          maxLength={160}
          aria-invalid={err('legalName') ? true : undefined}
          aria-describedby={describedBy('aj-legal-name', null, err('legalName'))}
          onChange={(e) => setLegalName(e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="aj-cuit"
          label="CUIT"
          optional
          hint={settings.cuit ? undefined : 'Lo necesitan los libros de IVA.'}
          error={err('cuit')}
        >
          <CuitInput
            id="aj-cuit"
            value={cuit}
            invalid={Boolean(err('cuit'))}
            describedBy={describedBy('aj-cuit', !settings.cuit, err('cuit'))}
            onChange={setCuit}
            onBlurCheck={(issue) =>
              setErrors((prev) => {
                const { cuit: _cuit, ...rest } = prev
                return issue ? { ...rest, cuit: issue } : rest
              })
            }
          />
        </Field>
        <Field id="aj-address" label="Domicilio fiscal" optional error={err('fiscalAddress')}>
          <Input
            id="aj-address"
            value={address}
            maxLength={200}
            aria-invalid={err('fiscalAddress') ? true : undefined}
            onChange={(e) => setAddress(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid gap-1.5">
        <Label id="aj-iva-label">Condición frente al IVA</Label>
        {docsLocked ? (
          <>
            <p className="text-sm">{SAS_IVA_CONDITION_LABELS[settings.ivaCondition]}</p>
            <p className="text-xs text-muted-foreground">{LOCKED_BY_DOCUMENTS}</p>
          </>
        ) : (
          <ChoiceChips
            options={IVA_OPTIONS}
            value={ivaCondition}
            labelledBy="aj-iva-label"
            onChange={setIvaCondition}
          />
        )}
        {err('ivaCondition') ? (
          <p role="alert" className="text-xs text-destructive">
            {err('ivaCondition')}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
        <div className="grid gap-1.5">
          <Label id="aj-iibb-label">Ingresos Brutos</Label>
          <ChoiceChips
            options={IIBB_OPTIONS}
            value={iibbRegime}
            labelledBy="aj-iibb-label"
            onChange={setIibbRegime}
          />
        </div>
        <Field id="aj-iibb-number" label="N° de inscripción" optional error={err('iibbNumber')}>
          <Input
            id="aj-iibb-number"
            value={iibbNumber}
            maxLength={30}
            inputMode="numeric"
            aria-invalid={err('iibbNumber') ? true : undefined}
            onChange={(e) => setIibbNumber(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DateField
          id="aj-activity-start"
          label="Inicio de actividades"
          optional
          shortcuts={false}
          max={today}
          value={activityStart}
          error={err('activityStartDate')}
          onValueChange={setActivityStart}
        />
        {docsLocked ? (
          <div className="grid content-start gap-1.5">
            <Label>Los libros arrancan el</Label>
            <p className="text-sm tabular-nums">{formatIsoDay(settings.booksStartDate)}</p>
            <p className="text-xs text-muted-foreground">{LOCKED_BY_DOCUMENTS}</p>
          </div>
        ) : (
          <DateField
            id="aj-books-start"
            label="Los libros arrancan el"
            required
            shortcuts={false}
            min={addDays(today, -400)}
            max={today}
            value={booksStart}
            hint="Es el día del asiento de apertura."
            error={err('booksStartDate')}
            onValueChange={setBooksStart}
          />
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="aj-fy-end">Cierre del ejercicio</Label>
        {endLocked ? (
          <>
            <p className="text-sm">
              {FISCAL_END_MONTH_OPTIONS.find((m) => m.value === settings.fiscalYearEndMonth)
                ?.label ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground">{LOCKED_BY_CLOSES}</p>
          </>
        ) : (
          <Select value={String(endMonth)} onValueChange={(value) => setEndMonth(Number(value))}>
            <SelectTrigger
              id="aj-fy-end"
              className="w-full sm:max-w-xs data-[size=default]:h-11 md:data-[size=default]:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FISCAL_END_MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {err('fiscalYearEndMonth') ? (
          <p role="alert" className="text-xs text-destructive">
            {err('fiscalYearEndMonth')}
          </p>
        ) : null}
      </div>

      <SaveBar pending={pending} message={err('form')} />
    </form>
  )
}

// ─── Ejercicio y meses ───────────────────────────────────────────────────────

type UninvoicedMode = AccountingSettings['uninvoicedSalesMode']
type VoidMode = AccountingSettings['closedPeriodVoidIvaMode']

const UNINVOICED_OPTIONS: readonly ChoiceChip<UninvoicedMode>[] = (
  Object.keys(UNINVOICED_SALES_LABELS) as UninvoicedMode[]
).map((value) => ({ value, label: UNINVOICED_SALES_LABELS[value] }))

const VOID_OPTIONS: readonly ChoiceChip<VoidMode>[] = (
  Object.keys(CLOSED_PERIOD_VOID_LABELS) as VoidMode[]
).map((value) => ({ value, label: CLOSED_PERIOD_VOID_LABELS[value] }))

/** Ajustes › Ejercicio y meses (H.17): cómo se liquida y se cierra cada mes. */
export function PeriodSettingsForm({
  tenantSlug,
  settings,
}: {
  tenantSlug: string
  settings: AccountingSettings
}) {
  const [ivaOnClose, setIvaOnClose] = useState(settings.ivaSettlementMode === 'on_close')
  const [tolerance, setTolerance] = useState<number | null>(settings.vatToleranceCents)
  const [creditPct, setCreditPct] = useState(bpToPercentInput(settings.bankTaxCreditComputableBp))
  const [debitPct, setDebitPct] = useState(bpToPercentInput(settings.bankTaxDebitComputableBp))
  const [uninvoiced, setUninvoiced] = useState<UninvoicedMode>(settings.uninvoicedSalesMode)
  const [voidMode, setVoidMode] = useState<VoidMode>(settings.closedPeriodVoidIvaMode)
  const [soonDays, setSoonDays] = useState(String(settings.dueSoonDays))
  const [ivaDueDay, setIvaDueDay] = useState(String(settings.ivaDueDay || ''))
  const [iibbDueDay, setIibbDueDay] = useState(String(settings.iibbDueDay || ''))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { pending, run } = useMasterAction()
  const formRef = useFocusFirstError(errors)
  const err = (k: string) => errors[k] ?? null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const local: Record<string, string> = {}
    const credit = parsePercentToBp(creditPct)
    const debit = parsePercentToBp(debitPct)
    if (!credit.ok) local.bankTaxCreditComputableBp = credit.message
    else if (credit.bp === null) local.bankTaxCreditComputableBp = 'Escribí el porcentaje.'
    if (!debit.ok) local.bankTaxDebitComputableBp = debit.message
    else if (debit.bp === null) local.bankTaxDebitComputableBp = 'Escribí el porcentaje.'
    if (tolerance === null) local.vatToleranceCents = 'Escribí la tolerancia (de $ 0 a $ 1).'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      return
    }
    setErrors({})
    run(
      () =>
        saveSettings(
          tenantSlug,
          settingsPayload(settings, {
            ivaSettlementMode: ivaOnClose ? 'on_close' : 'manual',
            vatToleranceCents: tolerance,
            bankTaxCreditComputableBp: credit.ok ? credit.bp : null,
            bankTaxDebitComputableBp: debit.ok ? debit.bp : null,
            uninvoicedSalesMode: uninvoiced,
            closedPeriodVoidIvaMode: voidMode,
            dueSoonDays: soonDays,
            ivaDueDay,
            iibbDueDay,
          }),
        ),
      { onFailure: (state) => setErrors(failureErrors(state)) },
    )
  }

  const numberInput = (
    id: string,
    value: string,
    set: (v: string) => void,
    field: string,
    max: number,
  ) => (
    <Input
      id={id}
      value={value}
      inputMode="numeric"
      maxLength={max >= 10 ? 2 : 1}
      aria-invalid={err(field) ? true : undefined}
      aria-describedby={describedBy(id, true, err(field))}
      onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
      className={cn(INPUT_CLASS, 'w-24 tabular-nums')}
    />
  )

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="card-hairline space-y-5 rounded-xl border bg-card p-6"
    >
      <SwitchRow
        id="aj-iva-close"
        label="Liquidar el IVA al cerrar cada mes"
        description="Arma el asiento que deja el IVA del mes listo para pagar. Si la contadora prefiere hacerlo ella, apagalo."
        checked={ivaOnClose}
        onCheckedChange={setIvaOnClose}
      />

      <MoneyField
        id="aj-tolerance"
        label="Tolerancia del IVA"
        value={tolerance}
        maxCents={100}
        hint="La diferencia de redondeo que se acepta entre el IVA de una factura y el calculado: de $ 0 a $ 1."
        error={err('vatToleranceCents')}
        onValueChange={(cents) => setTolerance(cents)}
        fieldClassName="sm:max-w-xs"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="aj-bank-credit"
          label="Impuesto al cheque · créditos"
          hint="% computable en Ganancias."
          error={err('bankTaxCreditComputableBp')}
        >
          <PercentInput
            id="aj-bank-credit"
            value={creditPct}
            onChange={setCreditPct}
            invalid={Boolean(err('bankTaxCreditComputableBp'))}
            describedBy={describedBy('aj-bank-credit', true, err('bankTaxCreditComputableBp'))}
            className="sm:max-w-[10rem]"
          />
        </Field>
        <Field
          id="aj-bank-debit"
          label="Impuesto al cheque · débitos"
          hint="% computable en Ganancias."
          error={err('bankTaxDebitComputableBp')}
        >
          <PercentInput
            id="aj-bank-debit"
            value={debitPct}
            onChange={setDebitPct}
            invalid={Boolean(err('bankTaxDebitComputableBp'))}
            describedBy={describedBy('aj-bank-debit', true, err('bankTaxDebitComputableBp'))}
            className="sm:max-w-[10rem]"
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground text-pretty">
        Confirmalo con la contadora: 33 % por defecto; 100 % si la SAS es micro o pequeña MiPyME
        (Ley 25.413).
      </p>

      <div className="grid gap-1.5">
        <Label id="aj-uninvoiced-label">Ventas sin factura</Label>
        <ChoiceChips
          options={UNINVOICED_OPTIONS}
          value={uninvoiced}
          labelledBy="aj-uninvoiced-label"
          onChange={setUninvoiced}
        />
        <p className="text-xs text-muted-foreground">
          Cómo las registra la contabilidad. Lo define la contadora.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label id="aj-void-label">Anulaciones de meses cerrados en el Libro IVA</Label>
        <ChoiceChips
          options={VOID_OPTIONS}
          value={voidMode}
          labelledBy="aj-void-label"
          onChange={setVoidMode}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id="aj-soon"
          label="Días de «vence pronto»"
          hint="De 1 a 30."
          error={err('dueSoonDays')}
        >
          {numberInput('aj-soon', soonDays, setSoonDays, 'dueSoonDays', 30)}
        </Field>
        <Field
          id="aj-iva-due"
          label="Vencimiento del IVA"
          hint="Día del mes, de 1 a 28."
          error={err('ivaDueDay')}
        >
          {numberInput('aj-iva-due', ivaDueDay, setIvaDueDay, 'ivaDueDay', 28)}
        </Field>
        <Field
          id="aj-iibb-due"
          label="Vencimiento de IIBB"
          hint="Día del mes, de 1 a 28."
          error={err('iibbDueDay')}
        >
          {numberInput('aj-iibb-due', iibbDueDay, setIibbDueDay, 'iibbDueDay', 28)}
        </Field>
      </div>

      <SaveBar pending={pending} message={err('form')} />
    </form>
  )
}
