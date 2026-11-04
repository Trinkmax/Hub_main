'use client'

import { Check, ChevronRight, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { isImplicitSubmit } from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/wizard'
import { detectInstallment } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Amount } from '@/components/administracion/amount'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { DateField } from '@/components/administracion/date-input'
import {
  type CategoryOption,
  CategoryPicker,
  categoryShortName,
  WALLET_ICONS,
} from '@/components/administracion/kit'
import { MoneyField } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Planilla } from '@/components/administracion/planilla'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveRecurringExpense } from '@/lib/accounting/actions/master'
import { addMonthsToYearMonth, formatIsoDay, monthOf, weekdayName } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { suggestAccount } from '../../../_lib/bulk'
import { gastosFijosHref } from '../../../_lib/links'
import {
  nextDueFrom,
  RECURRING_FREQUENCIES,
  type RecurringFrequency,
} from '../../../_lib/recurring'
import {
  buildRecurringPayload,
  type InstallmentsDraft,
  initialDuesOf,
  initialInstallments,
  installmentsValues,
  newBreakdownDraft,
  paperShowsVat,
  type RecurringFormValues,
  validateRecurringForm,
} from '../_lib/form-payload'
import { InstallmentsField } from './installments-field'
import { PaperField, VatRatePills } from './paper-field'
import { type BreakdownDraft, RecurringBreakdown } from './recurring-breakdown'

export type { RecurringFormValues } from '../_lib/form-payload'

const NO_TREASURY = 'sin_caja'
const QUESTION = 'text-sm font-medium'
const HELP = 'text-xs text-muted-foreground text-pretty'
const QUIET_LINK =
  'inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** Una pregunta con su respuesta, su ayuda y su error. */
function Ask({
  id,
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  /** El id del rótulo, para los grupos que se nombran con `aria-labelledby`. */
  id?: string
  label: ReactNode
  /** Si la respuesta es UN campo: su id. */
  htmlFor?: string
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid content-start gap-2">
      {htmlFor ? (
        <Label htmlFor={htmlFor} id={id} className={QUESTION}>
          {label}
        </Label>
      ) : (
        <span id={id} className={QUESTION}>
          {label}
        </span>
      )}
      {children}
      {hint ? <p className={HELP}>{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * La ficha de un gasto fijo: un solo bloque, con los campos en una grilla. Mismo estado, mismas
 * validaciones y MISMA acción que siempre (`saveRecurringExpense` con el paquete de
 * `buildRecurringPayload`). Enter en un campo no guarda: se guarda con el botón.
 */
export function RecurringForm({
  tenantSlug,
  today,
  initial,
  parties,
  accounts,
  categories,
  treasuries,
  backHref,
}: {
  tenantSlug: string
  today: string
  initial: RecurringFormValues
  parties: readonly PartyOption[]
  /** El plan completo (grupos incluidos), para «Ver el plan completo». */
  accounts: readonly AccountOption[]
  /** Las categorías que se ofrecen como chips. */
  categories: readonly CategoryOption[]
  treasuries: readonly TreasuryOption[]
  backHref: string
}) {
  const router = useRouter()
  const uid = useId()
  const [pending, start] = useTransition()
  const [form, setForm] = useState(initial)
  const [dueTouched, setDueTouched] = useState(initial.id !== null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const editing = initial.id !== null
  const startInstallments = useMemo(() => initialInstallments(initial), [initial])
  const [installments, setInstallments] = useState<InstallmentsDraft>(startInstallments)
  const [lines, setLines] = useState<BreakdownDraft[]>(() =>
    initial.breakdown.map((l) => newBreakdownDraft(l)),
  )
  const [fullPlan, setFullPlan] = useState(false)
  // Con la categoría ya puesta (una edición) se muestra elegida, con «Cambiar»: los chips de
  // todo el plan aparecen recién cuando hace falta.
  const [pickCategory, setPickCategory] = useState(initial.accountId === null)
  const [dateOpen, setDateOpen] = useState(false)

  const initialDues = initialDuesOf(initial)
  const { dues, installmentsTotal } = installmentsValues(installments)
  const detailed = lines.length > 0
  const detailTotal = lines.reduce((sum, l) => sum + (l.amountCents ?? 0), 0)
  const wasEnded = initialDues === 0
  // Terminó y nadie dijo todavía cuántas cuotas más faltan: no hay «próximo» que anunciar.
  const stillEnded = wasEnded && dues === 0
  const payloadInput = { form: { ...form, installmentsTotal }, initial, dues, lines }
  const vatInPaper = paperShowsVat(form.voucherType)
  const [moreOpen, setMoreOpen] = useState(
    () =>
      initial.notes.trim() !== '' ||
      initial.breakdown.length > 0 ||
      initial.remindDaysBefore !== 5 ||
      (initial.vatRateBp !== null && !paperShowsVat(initial.voucherType)),
  )

  const set = <K extends keyof RecurringFormValues>(key: K, value: RecurringFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const setDueDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      dueDay: day,
      nextDueDate: dueTouched ? prev.nextDueDate : nextDueFrom(today, day),
    }))
  }

  const focusFirstError = () =>
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-form="${uid}"] [aria-invalid="true"]`)?.focus()
    })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBanner(null)
    const local = validateRecurringForm(payloadInput, installments)
    if (Object.keys(local).length > 0) {
      setErrors(local)
      if (local.breakdown) setMoreOpen(true)
      focusFirstError()
      return
    }
    start(async () => {
      try {
        const result = await saveRecurringExpense(tenantSlug, buildRecurringPayload(payloadInput))
        if (!result.ok) {
          const fieldErrors = result.fieldErrors ?? {}
          setErrors(fieldErrors)
          if (fieldErrors.notes || fieldErrors.remindDaysBefore || fieldErrors.breakdown) {
            setMoreOpen(true)
          }
          setBanner(
            result.code === 'stale'
              ? 'Alguien cambió este gasto fijo recién. Recargá la página y probá de nuevo.'
              : result.message,
          )
          focusFirstError()
          return
        }
        toast.success(result.message)
        // De vuelta a la planilla, con el renglón a la vista y marcado.
        const saved = result.data
        const dueMonth = monthOf(saved.nextDueDate)
        const thisMonth = monthOf(today)
        const inView = dueMonth === thisMonth || dueMonth === addMonthsToYearMonth(thisMonth, 1)
        router.push(gastosFijosHref(tenantSlug, { mes: inView ? dueMonth : null, abrir: saved.id }))
      } catch {
        setBanner(ACC_UNREACHABLE.offline)
      }
    })
  }

  const id = (name: string) => `${uid}-${name}`
  const account = accounts.find((a) => a.id === form.accountId) ?? null
  const treasuryOptions = treasuries.filter(
    (t) => t.active !== false || t.id === form.treasuryAccountId,
  )
  // La categoría que propone el nombre: se muestra como «Sugerida»; la elige la persona.
  const suggestedId = useMemo(
    () => (editing || form.accountId ? null : suggestAccount(form.name, categories)),
    [editing, form.accountId, form.name, categories],
  )
  const suggested = suggestedId ? categories.find((c) => c.id === suggestedId) : undefined
  const nameInstallment = useMemo(() => detectInstallment(form.name), [form.name])

  return (
    <form
      onSubmit={submit}
      // Se guarda con el botón: un Enter suelto en un campo no puede guardar a medias.
      onKeyDown={(event) => {
        const el = event.target
        if (el instanceof HTMLInputElement && isImplicitSubmit(event.key, el.tagName, el.type)) {
          event.preventDefault()
        }
      }}
      noValidate
      data-form={uid}
      className="grid gap-3.5"
    >
      <Planilla className="overflow-visible">
        <div className="grid gap-x-6 gap-y-5 p-4 sm:p-5 md:grid-cols-2">
          <Ask label="Nombre" htmlFor={id('name')} error={errors.name}>
            <Input
              id={id('name')}
              value={form.name}
              maxLength={80}
              autoComplete="off"
              // En un alta el cursor arranca acá: es lo primero que se escribe.
              autoFocus={!editing}
              placeholder="Alquiler, luz, internet…"
              aria-invalid={errors.name ? true : undefined}
              onChange={(e) => set('name', e.target.value)}
              className="h-11 text-base md:text-sm"
            />
          </Ask>

          {detailed ? (
            <Ask label="¿Cuánto pagás?">
              <p className="flex min-h-11 items-center gap-1.5 text-sm">
                <Amount cents={detailTotal} decimals={0} className="font-medium" />{' '}
                <span className="text-xs text-muted-foreground">(la suma del detalle)</span>
              </p>
            </Ask>
          ) : (
            <MoneyField
              id={id('amountCents')}
              label="¿Cuánto pagás?"
              optional
              value={form.amountCents}
              onValueChange={(cents) => set('amountCents', cents)}
              error={errors.amountCents ?? null}
              decimals="auto"
              className="[&_input]:md:h-11"
              hint="Si cambia todos los meses (la luz), poné lo de la última vez. Sin monto no suma en el total del mes."
            />
          )}

          <div className="md:col-span-2">
            <Ask
              id={id('accountId-label')}
              label="¿En qué se gasta?"
              hint="Es la categoría: ordena tus números."
              error={errors.accountId}
            >
              {suggested && !form.accountId ? (
                <p className="text-sm text-pretty">
                  Te propongo <strong>{suggested.shortName}</strong>: tocala si es esa.
                </p>
              ) : null}
              {account && !pickCategory && !errors.accountId ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs md:min-h-9 md:px-3.5 md:text-[13px]">
                    <Check aria-hidden className="size-3.5" strokeWidth={3} />
                    {categoryShortName(account.name)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickCategory(true)}
                    className={cn(QUIET_LINK, 'min-h-11 md:min-h-0')}
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <CategoryPicker
                  id={id('accountId')}
                  aria-labelledby={id('accountId-label')}
                  options={categories}
                  value={form.accountId}
                  onChange={(next) => set('accountId', next)}
                  suggestedId={suggestedId}
                  invalid={Boolean(errors.accountId)}
                  outside={account ? { id: account.id, name: account.name } : null}
                  onOpenFullPlan={() => setFullPlan(true)}
                />
              )}
              {fullPlan && (pickCategory || !account || errors.accountId) ? (
                <AccountCombobox
                  id={id('accountId-plan')}
                  value={form.accountId}
                  onValueChange={(next) => set('accountId', next)}
                  accounts={accounts}
                  placeholder="Buscá en el plan completo"
                  invalid={Boolean(errors.accountId)}
                  aria-label="Categoría, en el plan completo"
                />
              ) : null}
            </Ask>
          </div>

          <Ask id={id('frequency')} label="¿Cada cuánto?" error={errors.frequency}>
            <ChoiceChips<RecurringFrequency>
              labelledBy={id('frequency')}
              value={form.frequency}
              onChange={(value) => set('frequency', value)}
              options={RECURRING_FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
            />
          </Ask>

          <Ask label="¿Qué día vence?" htmlFor={id('dueDay')} error={errors.dueDay}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={id('dueDay')}
                value={String(form.dueDay)}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={errors.dueDay ? true : undefined}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 2)
                  const day = digits === '' ? 1 : Math.min(31, Math.max(1, Number(digits)))
                  setDueDay(day)
                }}
                className="h-11 w-16 text-center text-base tabular-nums md:text-sm"
              />
              <span className="text-sm text-muted-foreground">de cada mes</span>
            </div>
            {stillEnded ? null : (
              <p className="text-sm text-pretty">
                {/* Abierto con un vencimiento que ya pasó: es el que se debe, no «el próximo». */}
                {form.nextDueDate < today ? 'Venció el' : 'El próximo es el'}{' '}
                {weekdayName(form.nextDueDate)} {formatIsoDay(form.nextDueDate).slice(0, 5)}
                {form.nextDueDate < today ? ': todavía no lo pagaste.' : '.'}{' '}
                {dateOpen ? null : (
                  <button
                    type="button"
                    onClick={() => setDateOpen(true)}
                    className={cn(QUIET_LINK, 'pointer-coarse:min-h-11')}
                  >
                    Cambiar la fecha
                  </button>
                )}
              </p>
            )}
            {dateOpen || errors.nextDueDate ? (
              <DateField
                id={id('nextDueDate')}
                label="Próximo vencimiento"
                required
                value={form.nextDueDate}
                onValueChange={(next) => {
                  if (!next) return
                  setDueTouched(true)
                  set('nextDueDate', next)
                }}
                shortcuts={false}
                today={today}
                error={errors.nextDueDate ?? null}
                hint="Desde acá se cuentan los próximos."
              />
            ) : null}
          </Ask>

          <div className="md:col-span-2">
            <InstallmentsField
              idPrefix={id('cuotas')}
              draft={installments}
              onChange={(next) => {
                setInstallments(next)
                if (errors.endsOn || errors.installmentsTotal) {
                  setErrors(({ endsOn: _e, installmentsTotal: _t, ...rest }) => rest)
                }
              }}
              nextDueDate={form.nextDueDate}
              dueDay={form.dueDay}
              frequency={form.frequency}
              endedOn={wasEnded ? initial.endsOn : null}
              restore={startInstallments}
              suggested={nameInstallment}
              error={errors.endsOn ?? errors.installmentsTotal}
            />
          </div>

          <div className="md:col-span-2">
            <PaperField
              idPrefix={id('papel')}
              voucherType={form.voucherType}
              onVoucherTypeChange={(next) => set('voucherType', next)}
              vatRateBp={form.vatRateBp}
              onVatRateChange={(next) => set('vatRateBp', next)}
              hasParty={form.partyId !== null}
              error={errors.voucherType}
            />
          </div>

          <Ask label="¿A quién le pagás?" htmlFor={id('partyId')} error={errors.partyId}>
            <PartyCombobox
              id={id('partyId')}
              value={form.partyId}
              onValueChange={(next) => set('partyId', next)}
              parties={parties}
              invalid={Boolean(errors.partyId)}
            />
            {form.partyId ? (
              <button
                type="button"
                className={cn(QUIET_LINK, 'min-h-11 justify-self-start md:min-h-0')}
                onClick={() => set('partyId', null)}
              >
                <X className="size-3" aria-hidden />
                Sin proveedor
              </button>
            ) : null}
          </Ask>

          <Ask
            id={id('treasuryAccountId')}
            label="¿Con qué lo pagás casi siempre?"
            error={errors.treasuryAccountId}
          >
            <ChoiceChips<string>
              labelledBy={id('treasuryAccountId')}
              value={form.treasuryAccountId ?? NO_TREASURY}
              onChange={(value) => set('treasuryAccountId', value === NO_TREASURY ? null : value)}
              options={[
                ...treasuryOptions.map((t) => {
                  const Icon = WALLET_ICONS[t.kind]
                  return {
                    value: t.id,
                    label: (
                      <>
                        <Icon aria-hidden className="size-4" />
                        {t.name}
                      </>
                    ),
                    ariaLabel: t.name,
                  }
                }),
                { value: NO_TREASURY, label: 'Lo elijo cada vez' },
              ]}
            />
          </Ask>
        </div>

        <div className="border-t border-border/70">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={id('mas')}
            onClick={() => setMoreOpen((value) => !value)}
            className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                moreOpen && 'rotate-90',
              )}
            />
            <span className="shrink-0 whitespace-nowrap">Más opciones</span>
            <span className="truncate font-normal text-muted-foreground max-sm:hidden">
              avisarme antes, el detalle del monto, notas
            </span>
          </button>
          {moreOpen ? (
            <div
              id={id('mas')}
              className="grid gap-x-6 gap-y-5 border-t border-border/70 p-4 sm:p-5 md:grid-cols-2"
            >
              <Ask
                label="Avisarme antes"
                htmlFor={id('remindDaysBefore')}
                error={errors.remindDaysBefore}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id={id('remindDaysBefore')}
                    value={String(form.remindDaysBefore)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={errors.remindDaysBefore ? true : undefined}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 2)
                      set('remindDaysBefore', digits === '' ? 0 : Math.min(30, Number(digits)))
                    }}
                    className="h-11 w-16 text-center text-base tabular-nums md:text-sm"
                  />
                  <span className="text-sm text-muted-foreground">días antes del vencimiento</span>
                </div>
              </Ask>

              {vatInPaper ? null : (
                <Ask id={id('vatRateBp')} label="IVA de siempre" error={errors.vatRateBp}>
                  <VatRatePills
                    value={form.vatRateBp}
                    onChange={(next) => set('vatRateBp', next)}
                    labelledBy={id('vatRateBp')}
                  />
                </Ask>
              )}

              <div className="md:col-span-2">
                <Ask
                  label="Detalle del monto"
                  hint="Para los sueldos: un renglón por persona y por concepto. El monto pasa a ser la suma."
                >
                  {detailed ? (
                    <RecurringBreakdown
                      idPrefix={id('breakdown')}
                      lines={lines}
                      onChange={(next) => {
                        setLines(next)
                        if (errors.breakdown) setErrors(({ breakdown: _b, ...rest }) => rest)
                      }}
                      error={errors.breakdown}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 justify-self-start md:h-9"
                      onClick={() => setLines([newBreakdownDraft()])}
                    >
                      Detallar el monto
                    </Button>
                  )}
                </Ask>
              </div>

              <div className="md:col-span-2">
                <Ask label="Notas" htmlFor={id('notes')} error={errors.notes}>
                  <Textarea
                    id={id('notes')}
                    value={form.notes}
                    maxLength={280}
                    rows={2}
                    onChange={(e) => set('notes', e.target.value)}
                    className="text-base md:text-sm"
                  />
                </Ask>
              </div>
            </div>
          ) : null}
        </div>

        {editing ? (
          stillEnded ? (
            <p className="border-t border-border/70 px-4 py-3 text-sm text-muted-foreground sm:px-5">
              Terminó: ya pasó la última cuota.
            </p>
          ) : (
            <Label
              htmlFor={id('paused')}
              className="flex items-start justify-between gap-4 border-t border-border/70 px-4 py-3 sm:px-5"
            >
              <span className="space-y-1">
                <span className="block text-sm font-medium leading-none">En pausa</span>
                <span className="block text-xs font-normal text-muted-foreground text-pretty">
                  Deja de avisar y sale de la planilla del mes. Lo que ya cargaste queda igual.
                </span>
              </span>
              <Switch
                id={id('paused')}
                checked={!form.active}
                onCheckedChange={(checked) => set('active', !checked)}
              />
            </Label>
          )
        ) : null}
      </Planilla>

      {banner ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">{banner}</p>
        </div>
      ) : null}

      {/* En el celular el pie queda a mano, pegado abajo. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-border/60 bg-background/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {/* En el celular se vuelve con «‹ Gastos fijos», arriba: el pie es solo el botón. */}
        <Button asChild variant="ghost" className="h-11 max-sm:hidden md:pointer-fine:h-9">
          <Link href={backHref}>Cancelar</Link>
        </Button>
        <Button type="submit" className="h-11 md:pointer-fine:h-9" disabled={pending}>
          {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar gasto fijo'}
        </Button>
      </div>
    </form>
  )
}
