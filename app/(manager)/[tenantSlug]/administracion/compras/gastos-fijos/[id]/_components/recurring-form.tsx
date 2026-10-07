'use client'

import { TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { DateField } from '@/components/administracion/date-input'
import { MoneyField } from '@/components/administracion/money-input'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { type TreasuryOption, TreasurySelect } from '@/components/administracion/treasury-select'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveRecurringExpense } from '@/lib/accounting/actions/master'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { formatIsoDay } from '@/lib/dates'
import {
  nextDueFrom,
  RECURRING_FREQUENCIES,
  type RecurringFrequency,
} from '../../../_lib/recurring'

export type RecurringFormValues = {
  id: string | null
  updatedAt: string | null
  name: string
  partyId: string | null
  accountId: string | null
  voucherType: string | null
  vatRateBp: number | null
  amountCents: number | null
  frequency: RecurringFrequency
  dueDay: number
  nextDueDate: string
  remindDaysBefore: number
  treasuryAccountId: string | null
  active: boolean
  notes: string
}

const NONE = '__ninguno__'
const RATES = [2100, 1050, 2700, 500, 250, 0] as const

function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid content-start gap-1.5">
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
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
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

/**
 * Alta o edición de un gasto fijo (H.7): nombre, proveedor, en qué, el
 * comprobante y la alícuota de siempre, el monto aproximado (o variable), cada
 * cuánto vence y cuántos días antes avisar. Es un recordatorio: no es deuda
 * hasta que se carga la factura.
 */
export function RecurringForm({
  tenantSlug,
  today,
  initial,
  parties,
  accounts,
  treasuries,
  voucherOptions,
  backHref,
}: {
  tenantSlug: string
  today: string
  initial: RecurringFormValues
  parties: readonly PartyOption[]
  accounts: readonly AccountOption[]
  treasuries: readonly TreasuryOption[]
  voucherOptions: ReadonlyArray<{ value: string; label: string }>
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBanner(null)
    const local: Record<string, string> = {}
    if (form.name.trim().length < 2) local.name = 'Escribí el nombre (por ejemplo, «Alquiler»).'
    if (!form.accountId) local.accountId = 'Elegí en qué es el gasto.'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-form="${uid}"] [aria-invalid="true"]`)?.focus()
      })
      return
    }
    start(async () => {
      try {
        const result = await saveRecurringExpense(tenantSlug, {
          ...(editing ? { id: form.id, expectedUpdatedAt: form.updatedAt } : {}),
          name: form.name,
          partyId: form.partyId,
          accountId: form.accountId,
          voucherType: form.voucherType,
          vatRateBp: form.vatRateBp,
          amountCents: form.amountCents,
          frequency: form.frequency,
          dueDay: form.dueDay,
          nextDueDate: form.nextDueDate,
          remindDaysBefore: form.remindDaysBefore,
          treasuryAccountId: form.treasuryAccountId,
          active: form.active,
          notes: form.notes,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setBanner(
            result.code === 'stale'
              ? 'Alguien cambió este gasto fijo recién. Recargá la página y probá de nuevo.'
              : result.message,
          )
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLElement>(`[data-form="${uid}"] [aria-invalid="true"]`)
              ?.focus()
          })
          return
        }
        toast.success(result.message)
        router.push(backHref)
      } catch {
        setBanner(ACC_UNREACHABLE.offline)
      }
    })
  }

  const id = (name: string) => `${uid}-${name}`

  return (
    <form
      onSubmit={submit}
      noValidate
      data-form={uid}
      className="card-hairline grid gap-5 rounded-xl border bg-card p-5 sm:p-6"
    >
      <Field id={id('name')} label="Nombre" required error={errors.name}>
        <Input
          id={id('name')}
          value={form.name}
          maxLength={80}
          autoComplete="off"
          placeholder="Alquiler, luz, internet…"
          aria-invalid={errors.name ? true : undefined}
          onChange={(e) => set('name', e.target.value)}
          className="h-11 text-base md:h-10 md:text-sm"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id('partyId')} label="Proveedor" optional error={errors.partyId}>
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
              className="inline-flex items-center gap-1 justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => set('partyId', null)}
            >
              <X className="size-3" aria-hidden />
              Sin proveedor
            </button>
          ) : null}
        </Field>
        <Field id={id('accountId')} label="¿En qué es?" required error={errors.accountId}>
          <AccountCombobox
            id={id('accountId')}
            value={form.accountId}
            onValueChange={(next) => set('accountId', next)}
            accounts={accounts}
            placeholder="Elegí la cuenta (alquileres, servicios…)"
            invalid={Boolean(errors.accountId)}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={id('voucherType')}
          label="Comprobante de siempre"
          optional
          error={errors.voucherType}
        >
          <Select
            value={form.voucherType ?? NONE}
            onValueChange={(v) => set('voucherType', v === NONE ? null : v)}
          >
            <SelectTrigger
              id={id('voucherType')}
              className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} className="min-h-11 md:min-h-8">
                No sé o cambia
              </SelectItem>
              {voucherOptions.map((o) => (
                <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={id('vatRateBp')} label="Alícuota de IVA" optional error={errors.vatRateBp}>
          <Select
            value={form.vatRateBp === null ? NONE : String(form.vatRateBp)}
            onValueChange={(v) => set('vatRateBp', v === NONE ? null : Number(v))}
          >
            <SelectTrigger
              id={id('vatRateBp')}
              className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} className="min-h-11 md:min-h-8">
                No sé o no discrimina
              </SelectItem>
              {RATES.map((r) => (
                <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                  {vatRateLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <MoneyField
        id={id('amountCents')}
        label="Monto aproximado"
        optional
        value={form.amountCents}
        onValueChange={(cents) => set('amountCents', cents)}
        error={errors.amountCents ?? null}
        hint="Si cambia todos los meses (la luz), dejalo vacío: queda como «variable»."
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <Field id={id('frequency')} label="Cada cuánto vence" required error={errors.frequency}>
          <Select
            value={form.frequency}
            onValueChange={(v) => set('frequency', v as RecurringFrequency)}
          >
            <SelectTrigger
              id={id('frequency')}
              className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRING_FREQUENCIES.map((f) => (
                <SelectItem key={f.value} value={f.value} className="min-h-11 md:min-h-8">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={id('dueDay')} label="Vence el día" required error={errors.dueDay}>
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
            className="h-11 text-base tabular-nums md:h-10 md:text-sm"
          />
        </Field>
        <Field
          id={id('remindDaysBefore')}
          label="Avisar antes"
          error={errors.remindDaysBefore}
          hint="Días antes del vencimiento."
        >
          <div className="relative">
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
              className="h-11 pr-12 text-base tabular-nums md:h-10 md:text-sm"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
            >
              días
            </span>
          </div>
        </Field>
      </div>

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
        hint={`Desde acá se cuentan los próximos (${formatIsoDay(form.nextDueDate)}).`}
      />

      <Field
        id={id('treasuryAccountId')}
        label="¿Con qué lo pagás?"
        optional
        error={errors.treasuryAccountId}
      >
        <TreasurySelect
          id={id('treasuryAccountId')}
          value={form.treasuryAccountId}
          onValueChange={(next) => set('treasuryAccountId', next)}
          treasuries={treasuries}
          placeholder="Lo elegís al pagar"
        />
        {form.treasuryAccountId ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => set('treasuryAccountId', null)}
          >
            <X className="size-3" aria-hidden />
            Lo elijo cada vez
          </button>
        ) : null}
      </Field>

      <Field id={id('notes')} label="Notas" optional error={errors.notes}>
        <Textarea
          id={id('notes')}
          value={form.notes}
          maxLength={280}
          rows={2}
          onChange={(e) => set('notes', e.target.value)}
          className="text-base md:text-sm"
        />
      </Field>

      {editing ? (
        <Label
          htmlFor={id('active')}
          className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-background/40 p-3.5"
        >
          <span className="space-y-0.5">
            <span className="block text-sm font-medium leading-none">Activo</span>
            <span className="block text-xs font-normal text-muted-foreground">
              Si lo pausás, deja de avisar. Lo que ya cargaste queda igual.
            </span>
          </span>
          <Switch
            id={id('active')}
            checked={form.active}
            onCheckedChange={(checked) => set('active', checked)}
          />
        </Label>
      ) : null}

      {banner ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">{banner}</p>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost" className="h-11 md:h-9">
          <Link href={backHref}>Cancelar</Link>
        </Button>
        <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
          {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear gasto fijo'}
        </Button>
      </div>
    </form>
  )
}
