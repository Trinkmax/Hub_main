'use client'

import { Calendar, User } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type RegisterCustomerResult, registerCustomer } from '@/lib/m-session/actions'

const initial: RegisterCustomerResult = { ok: false, message: '' }

export function RegisterForm({
  qrToken,
  browserToken,
  tenantName,
  submitLabel,
  dismissLabel = 'No por ahora',
  onDismiss,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  submitLabel: string
  dismissLabel?: string
  onDismiss: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  const [state, action, pending] = useActionState(
    (_prev: RegisterCustomerResult, fd: FormData) => registerCustomer(fd),
    initial,
  )
  const [phone, setPhone] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.ok) onRegistered(state)
  }, [state, onRegistered])

  return (
    <form action={action} className="space-y-4 px-6 pt-5 pb-6">
      <input type="hidden" name="qr_token" value={qrToken} />
      <input type="hidden" name="browser_token" value={browserToken} />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />

      <div className="space-y-1.5">
        <Label
          htmlFor="first_name"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Nombre
        </Label>
        <div className="relative">
          <User
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="first_name"
            name="first_name"
            required
            maxLength={60}
            autoComplete="given-name"
            className="h-12 rounded-xl pl-9 text-base"
            placeholder="Juan"
          />
        </div>
        {!state.ok && state.fieldErrors?.first_name && (
          <p className="text-xs text-destructive">{state.fieldErrors.first_name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="last_name"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Apellido
        </Label>
        <Input
          id="last_name"
          name="last_name"
          required
          maxLength={60}
          autoComplete="family-name"
          className="h-12 rounded-xl text-base"
          placeholder="Pérez"
        />
        {!state.ok && state.fieldErrors?.last_name && (
          <p className="text-xs text-destructive">{state.fieldErrors.last_name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="phone-input"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Teléfono
        </Label>
        <PhoneInput
          id="phone-input"
          name="phone"
          international
          defaultCountry="AR"
          value={phone}
          onChange={setPhone}
          placeholder="11 4567 8901"
          className="hub-phone-input"
          aria-required="true"
        />
        <p className="text-[11px] text-muted-foreground">Tocá la bandera si sos de otro país.</p>
        {!state.ok && state.fieldErrors?.phone && (
          <p className="text-xs text-destructive">{state.fieldErrors.phone}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="birthdate"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Cumpleaños{' '}
          <span className="font-normal normal-case text-muted-foreground/60">(opcional)</span>
        </Label>
        <div className="relative">
          <Calendar
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="birthdate"
            name="birthdate"
            type="date"
            className="h-12 rounded-xl pl-9 text-base"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Para mandarte un regalo en tu día.</p>
      </div>

      <label
        htmlFor="opt_in_marketing"
        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 p-3"
      >
        <Checkbox id="opt_in_marketing" name="opt_in_marketing" defaultChecked className="mt-0.5" />
        <span className="text-xs leading-snug text-muted-foreground">
          Quiero recibir novedades y promos por WhatsApp.
          <br />
          <span className="text-[10px] opacity-70">Podés darte de baja en cualquier momento.</span>
        </span>
      </label>

      {!state.ok && state.message && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDismiss} className="sm:flex-none">
          {dismissLabel}
        </Button>
        <Button
          type="submit"
          disabled={pending}
          size="xl"
          className="rounded-xl font-semibold sm:flex-1"
        >
          {pending ? 'Guardando…' : submitLabel}
        </Button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        Tus datos quedan únicamente con {tenantName}. No se comparten.
      </p>
    </form>
  )
}
