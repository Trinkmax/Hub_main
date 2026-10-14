'use client'

import { ChevronRight, Lock } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { DateField } from '@/components/administracion/date-input'
import { Panel } from '@/components/administracion/kit/panel'
import { PaperSheet } from '@/components/administracion/kit/paper'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveSettings } from '@/lib/accounting/actions/master'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import { BOOKS_START_MAX_DAYS_BACK } from '@/lib/accounting/schemas'
import type { SasIvaCondition } from '@/lib/accounting/types'
import { addDays, capitalizeFirst, formatIsoDay, MONTH_NAMES, MONTH_NAMES_SHORT } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import {
  CLOSED_PERIOD_VOID_LABELS,
  IIBB_REGIME_LABELS,
  monthTitle,
  SAS_IVA_CONDITION_LABELS,
  UNINVOICED_SALES_LABELS,
} from '../_lib/labels'
import { bpToPercentInput, parsePercentToBp } from '../_lib/percent'
import { settingsPayload } from '../_lib/settings-payload'
import { Callout, describedBy, Field } from './form-bits'
import { CuitInput, cuitIssue, INPUT_CLASS, PercentInput, SwitchRow } from './inputs'
import { firstYearSentence } from './settings-views'
import { useMasterAction } from './use-master-action'

const LOCKED_BY_DOCUMENTS =
  'Ya hay comprobantes cargados: este dato no se puede cambiar. Hablalo con la contadora.'
/** Por qué no se cambia el cierre del ejercicio: lo que de verdad lo traba, no «esto o aquello». */
function lockedByCloses(settings: { hasClosedPeriods: boolean }): string {
  return settings.hasClosedPeriods
    ? 'Ya hay meses cerrados: el cierre del ejercicio no se cambia desde acá.'
    : 'Ya hay comprobantes cargados: el cierre del ejercicio no se cambia desde acá.'
}
/** La fecha de arranque trabada dice por qué, y qué significa (es el piso de toda carga). */
const BOOKS_START_LOCKED =
  'Ya hay comprobantes cargados: la fecha de arranque no se puede cambiar desde acá. Todo lo anterior a ese día no se carga.'

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
      <Button type="submit" className="h-11 w-full min-w-[180px] sm:w-auto" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </>
  )
}

/** Un dato que ya no se puede cambiar: el valor, un candado y por qué. */
function Locked({ value, reason }: { value: ReactNode; reason: string }) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Lock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {value}
      </p>
      <p className="text-xs text-muted-foreground text-pretty">{reason}</p>
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

/** Los doce meses como chips cortos («Dic»); el nombre entero va para lectores. */
const END_MONTH_OPTIONS: readonly ChoiceChip<string>[] = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: capitalizeFirst(MONTH_NAMES_SHORT[index] ?? name),
  ariaLabel: capitalizeFirst(name),
}))

/**
 * Ajustes › Datos de la SAS: la constancia de inscripción. Los datos van en el
 * orden del papel, con la CUIT arriba y grande; lo que falta se nota (el
 * casillero punteado), y lo que ya no se puede cambiar dice por qué.
 *
 * Un solo formulario, el mismo envío de siempre: `settingsPayload` con las
 * mismas nueve claves; lo bloqueado viaja con el valor guardado.
 *
 * «Guardar cambios» va al pie de la hoja, donde se termina de escribir. En la
 * compu son dos filas: la hoja y, debajo, el botón; la columna de «Los libros»
 * ocupa las dos (la fila del botón es la que estira si esa columna es más
 * alta, así el botón nunca se despega de la hoja). En el celular va último.
 */
export function SasSettingsForm({
  tenantSlug,
  settings,
  today,
  how,
}: {
  tenantSlug: string
  settings: AccountingSettings
  today: string
  /** «¿De dónde saco estos datos?»: los pasos de la guía «Cómo arrancar» (una sola redacción). */
  how: readonly string[]
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
  const cuitEmpty = cuit.trim() === ''

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

  const firstYear = firstYearSentence({
    booksStartDate: docsLocked ? settings.booksStartDate : (booksStart ?? settings.booksStartDate),
    fiscalYearEndMonth: endLocked ? settings.fiscalYearEndMonth : endMonth,
  })

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="grid gap-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start"
    >
      <PaperSheet
        title="Datos de la SAS"
        aside="como en la constancia"
        className="lg:col-span-7 lg:row-start-1"
      >
        <div className="grid gap-5">
          {/* La CUIT, arriba y grande, como en el papel. Si falta, el casillero lo dice. */}
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="aj-cuit">CUIT</Label>
              {cuitEmpty ? <StatusPill tone="warn">Falta</StatusPill> : null}
            </div>
            <div
              className={cn(
                '[&_input]:h-14 [&_input]:font-mono [&_input]:text-2xl [&_input]:font-semibold [&_input]:tracking-tight md:[&_input]:h-14 md:[&_input]:text-2xl',
                cuitEmpty &&
                  '[&_input]:border-dashed [&_input]:border-warning [&_input]:bg-warning/8',
              )}
            >
              <CuitInput
                id="aj-cuit"
                value={cuit}
                invalid={Boolean(err('cuit'))}
                describedBy={describedBy('aj-cuit', cuitEmpty, err('cuit'))}
                onChange={setCuit}
                onBlurCheck={(issue) =>
                  setErrors((prev) => {
                    const { cuit: _cuit, ...rest } = prev
                    return issue ? { ...rest, cuit: issue } : rest
                  })
                }
              />
            </div>
            {cuitEmpty ? (
              <p id="aj-cuit-hint" className="text-xs text-muted-foreground text-pretty">
                La piden los libros de IVA, ARCA y los importadores.
              </p>
            ) : null}
            {err('cuit') ? (
              <p id="aj-cuit-error" role="alert" className="text-xs text-destructive">
                {err('cuit')}
              </p>
            ) : null}
          </div>

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

          <div className="grid gap-1.5 sm:max-w-xs">
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
            {activityStart ? null : (
              <div>
                <StatusPill tone="info">Sin cargar</StatusPill>
              </div>
            )}
          </div>

          <fieldset className="m-0 grid min-w-0 gap-5 border-0 border-t border-border p-0 pt-4">
            <legend className="sr-only">Impuestos</legend>
            <p
              aria-hidden
              className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase"
            >
              Impuestos
            </p>
            <div className="grid gap-1.5">
              <Label id="aj-iva-label">IVA</Label>
              {docsLocked ? (
                <Locked
                  value={SAS_IVA_CONDITION_LABELS[settings.ivaCondition]}
                  reason={LOCKED_BY_DOCUMENTS}
                />
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
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
              <div className="grid gap-1.5">
                <Label id="aj-iibb-label">Ingresos Brutos</Label>
                <ChoiceChips
                  options={IIBB_OPTIONS}
                  value={iibbRegime}
                  labelledBy="aj-iibb-label"
                  onChange={setIibbRegime}
                />
              </div>
              <Field
                id="aj-iibb-number"
                label="N.º de inscripción"
                optional
                error={err('iibbNumber')}
              >
                <Input
                  id="aj-iibb-number"
                  value={iibbNumber}
                  maxLength={30}
                  inputMode="numeric"
                  aria-invalid={err('iibbNumber') ? true : undefined}
                  onChange={(e) => setIibbNumber(e.target.value)}
                  className={cn(INPUT_CLASS, 'tabular-nums')}
                />
              </Field>
            </div>
          </fieldset>
        </div>
      </PaperSheet>

      <div className="grid gap-6 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
        <Panel title="Los libros" description={firstYear}>
          <div className="grid gap-5">
            {docsLocked ? (
              <div className="grid content-start gap-1.5">
                <Label>Cargás desde el</Label>
                <Locked
                  value={
                    <span className="tabular-nums">{formatIsoDay(settings.booksStartDate)}</span>
                  }
                  reason={BOOKS_START_LOCKED}
                />
              </div>
            ) : (
              <DateField
                id="aj-books-start"
                label="Cargás desde el"
                required
                shortcuts={false}
                min={addDays(today, -BOOKS_START_MAX_DAYS_BACK)}
                max={today}
                value={booksStart}
                hint="Todo lo anterior a ese día no se carga acá: lo de antes entra como saldos iniciales."
                error={err('booksStartDate')}
                onValueChange={setBooksStart}
              />
            )}

            <div className="grid gap-1.5">
              <Label id="aj-fy-end-label">El ejercicio cierra en</Label>
              {endLocked ? (
                <Locked
                  value={monthTitle(settings.fiscalYearEndMonth)}
                  reason={lockedByCloses(settings)}
                />
              ) : (
                <ChoiceChips
                  options={END_MONTH_OPTIONS}
                  value={String(endMonth)}
                  labelledBy="aj-fy-end-label"
                  onChange={(value) => setEndMonth(Number(value))}
                  className="grid grid-cols-4 gap-2 [&>button]:justify-center [&>button]:px-0"
                />
              )}
              {err('fiscalYearEndMonth') ? (
                <p role="alert" className="text-xs text-destructive">
                  {err('fiscalYearEndMonth')}
                </p>
              ) : null}
            </div>
          </div>
        </Panel>

        {how.length > 0 ? (
          <details className="group/how rounded-2xl bg-secondary/50">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-open/how:rotate-90 motion-reduce:transition-none"
              />
              ¿De dónde saco estos datos?
            </summary>
            <ol className="grid gap-2.5 px-4 pb-4 text-sm text-muted-foreground">
              {how.map((step, index) => (
                <li key={step} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 text-pretty">{step}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>

      <div className="grid gap-3 sm:justify-items-end lg:col-span-7 lg:col-start-1 lg:row-start-2">
        <SaveBar pending={pending} message={err('form')} />
      </div>
    </form>
  )
}

// ─── Ejercicio ───────────────────────────────────────────────────────────────

type UninvoicedMode = AccountingSettings['uninvoicedSalesMode']
type VoidMode = AccountingSettings['closedPeriodVoidIvaMode']

const UNINVOICED_OPTIONS: readonly ChoiceChip<UninvoicedMode>[] = (
  Object.keys(UNINVOICED_SALES_LABELS) as UninvoicedMode[]
).map((value) => ({ value, label: UNINVOICED_SALES_LABELS[value] }))

const VOID_OPTIONS: readonly ChoiceChip<VoidMode>[] = (
  Object.keys(CLOSED_PERIOD_VOID_LABELS) as VoidMode[]
).map((value) => ({ value, label: CLOSED_PERIOD_VOID_LABELS[value] }))

/** Los campos del grupo plegado: un error en uno de ellos lo abre. */
const RULE_FIELDS: ReadonlySet<string> = new Set([
  'ivaSettlementMode',
  'vatToleranceCents',
  'bankTaxCreditComputableBp',
  'bankTaxDebitComputableBp',
  'uninvoicedSalesMode',
  'closedPeriodVoidIvaMode',
])

const RULES_ANCHOR = 'reglas'

/**
 * Ajustes › Ejercicio: un solo formulario (el mismo envío, las mismas nueve
 * claves) en dos grupos. Arriba, lo que sí es del dueño: con cuánta
 * anticipación se le avisa que algo vence y qué día vence cada impuesto.
 * Plegadas, las reglas contables, que define la contadora. Los campos del
 * grupo plegado son estado de React: viajan igual aunque esté cerrado.
 */
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
  const [rulesOpen, setRulesOpen] = useState(false)
  const { pending, run } = useMasterAction()
  const formRef = useFocusFirstError(errors)
  const err = (k: string) => errors[k] ?? null

  // Con `#reglas` en la URL (el link del cajón de la contadora) se abre sola.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${RULES_ANCHOR}`) {
        setRulesOpen(true)
        document.getElementById(RULES_ANCHOR)?.scrollIntoView({ block: 'start' })
      }
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  const showErrors = (next: Record<string, string>) => {
    if (Object.keys(next).some((field) => RULE_FIELDS.has(field))) setRulesOpen(true)
    setErrors(next)
  }

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
      showErrors(local)
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
      { onFailure: (state) => showErrors(failureErrors(state)) },
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
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
      <Panel
        title="Avisos y vencimientos"
        description="Con esto te avisamos a tiempo qué hay que pagar."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            id="aj-soon"
            label="¿Con cuántos días de anticipación te avisamos que algo vence?"
            hint="De 1 a 30."
            error={err('dueSoonDays')}
            className="sm:col-span-3"
          >
            {numberInput('aj-soon', soonDays, setSoonDays, 'dueSoonDays', 30)}
          </Field>
          <Field
            id="aj-iva-due"
            label="El IVA vence el día"
            hint="Del mes, de 1 a 28."
            error={err('ivaDueDay')}
          >
            {numberInput('aj-iva-due', ivaDueDay, setIvaDueDay, 'ivaDueDay', 28)}
          </Field>
          <Field
            id="aj-iibb-due"
            label="Ingresos Brutos vence el día"
            hint="Del mes, de 1 a 28."
            error={err('iibbDueDay')}
            className="sm:col-span-2"
          >
            {numberInput('aj-iibb-due', iibbDueDay, setIibbDueDay, 'iibbDueDay', 28)}
          </Field>
        </div>
      </Panel>

      <details
        id={RULES_ANCHOR}
        open={rulesOpen}
        onToggle={(e) => setRulesOpen(e.currentTarget.open)}
        className="group/rules scroll-mt-28 rounded-2xl bg-secondary/50"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/rules:rotate-90 motion-reduce:transition-none"
          />
          <span className="min-w-0 text-pretty">
            Reglas contables{' '}
            <span className="font-normal text-muted-foreground">(las define la contadora)</span>
          </span>
        </summary>
        <div className="grid gap-5 px-4 pb-4">
          <SwitchRow
            id="aj-iva-close"
            label="Liquidar el IVA al cerrar cada mes"
            description="Arma el asiento que deja el IVA del mes listo para pagar. Si la contadora prefiere hacerlo ella, apagalo."
            checked={ivaOnClose}
            onCheckedChange={setIvaOnClose}
            className="bg-card"
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

          <div className="grid gap-2">
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
                  describedBy={describedBy(
                    'aj-bank-credit',
                    true,
                    err('bankTaxCreditComputableBp'),
                  )}
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
            <p className="text-xs text-muted-foreground text-pretty">
              Confirmalo con la contadora: 33&nbsp;% por defecto; 100&nbsp;% si la SAS es micro o
              pequeña MiPyME (Ley&nbsp;25.413).
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label id="aj-uninvoiced-label">Ventas sin factura</Label>
            <p className="text-xs text-muted-foreground text-pretty">
              Cómo se anotan en los libros las ventas del cierre que no tienen factura. Con las dos
              opciones quedan registradas igual; cambia solo en qué cuenta.
            </p>
            <ChoiceChips
              options={UNINVOICED_OPTIONS}
              value={uninvoiced}
              labelledBy="aj-uninvoiced-label"
              onChange={setUninvoiced}
            />
          </div>

          <div className="grid gap-1.5">
            <Label id="aj-void-label">Anulaciones de meses cerrados en el Libro&nbsp;IVA</Label>
            <ChoiceChips
              options={VOID_OPTIONS}
              value={voidMode}
              labelledBy="aj-void-label"
              onChange={setVoidMode}
            />
          </div>
        </div>
      </details>

      <div className="grid gap-3 sm:justify-items-end">
        <SaveBar pending={pending} message={err('form')} />
      </div>
    </form>
  )
}
