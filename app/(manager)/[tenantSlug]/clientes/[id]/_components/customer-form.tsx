'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type CustomerActionState, updateCustomer } from '@/lib/customers/actions'
import { SERVICE_ALERT_META, SERVICE_ALERTS, type ServiceAlert } from '@/lib/salon/alerts'
import { cn } from '@/lib/utils'

const initial: CustomerActionState = { ok: true }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? 'Guardando…' : 'Guardar cambios'}
    </Button>
  )
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  )
}

type CustomerFormData = {
  id: string
  first_name: string
  last_name: string
  phone: string
  email: string | null
  notes: string | null
  birthdate: string | null
  opt_in_marketing: boolean
  is_blocked: boolean
  service_alerts: ServiceAlert[]
}

export function CustomerForm({
  tenantSlug,
  customer,
}: {
  tenantSlug: string
  customer: CustomerFormData
}) {
  const action = updateCustomer.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const [phone, setPhone] = useState<string | undefined>(customer.phone || undefined)
  const [selected, setSelected] = useState<ServiceAlert[]>(customer.service_alerts)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="id" value={customer.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="first_name">
            Nombre
            <RequiredMark />
          </Label>
          <Input
            id="first_name"
            name="first_name"
            defaultValue={customer.first_name}
            required
            maxLength={60}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="last_name">
            Apellido
            <RequiredMark />
          </Label>
          <Input
            id="last_name"
            name="last_name"
            defaultValue={customer.last_name}
            required
            maxLength={60}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="phone-input">
          WhatsApp
          <RequiredMark />
        </Label>
        <PhoneInput
          id="phone-input"
          name="phone"
          international
          defaultCountry="AR"
          countryCallingCodeEditable={false}
          value={phone}
          onChange={setPhone}
          className="hub-phone-input"
          aria-required="true"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="email">
            Email <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={customer.email ?? ''}
            maxLength={120}
            placeholder="cliente@ejemplo.com"
            autoComplete="email"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="birthdate">
            Cumpleaños <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="birthdate"
            name="birthdate"
            type="date"
            defaultValue={customer.birthdate ?? ''}
          />
        </div>
      </div>

      {/* Avisos permanentes. Esta ficha es el ÚNICO lugar donde se sacan: en una
          reserva se pueden marcar (y suben acá solos), pero desmarcarlos ahí no
          los borra, o un descuido dejaría sin aviso a todas las demás reservas
          de esta persona. */}
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Avisos de servicio</legend>
        <p className="text-xs text-muted-foreground">
          Aparecen solos en cada reserva de esta persona, en la agenda y en el panel de mozos.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {SERVICE_ALERTS.filter((a) => SERVICE_ALERT_META[a].scope === 'person').map((alert) => {
            const meta = SERVICE_ALERT_META[alert]
            const active = selected.includes(alert)
            return (
              <label
                key={alert}
                title={meta.hint}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? meta.severity === 'critical'
                      ? 'border-destructive/60 bg-destructive/10 text-destructive'
                      : 'border-warning/60 bg-warning/15 text-foreground'
                    : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                )}
              >
                <input
                  type="checkbox"
                  name="service_alerts"
                  value={alert}
                  checked={active}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, alert] : prev.filter((a) => a !== alert),
                    )
                  }
                  className="sr-only"
                />
                {meta.label}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">Notas internas</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={customer.notes ?? ''}
          maxLength={500}
          placeholder="Preferencias, alergias, observaciones del staff…"
          rows={4}
          className="resize-none"
        />
      </div>

      <Label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3.5">
        <Checkbox
          name="opt_in_marketing"
          id="opt_in_marketing"
          defaultChecked={customer.opt_in_marketing}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <span className="text-sm font-medium leading-none">
            Acepta recibir promociones por WhatsApp/email
          </span>
          <span className="block text-xs text-muted-foreground">
            Solo marcá esto si te lo confirmó. Quedará registrado con fecha, hora e IP.
          </span>
        </div>
      </Label>

      <Label className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
        <Checkbox
          name="is_blocked"
          id="is_blocked"
          defaultChecked={customer.is_blocked}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <span className="text-sm font-medium leading-none">No contactar</span>
          <span className="block text-xs text-muted-foreground">
            Bloquea todo mensaje saliente (difusiones, flows y contacto manual), aunque tenga
            opt-in.
          </span>
        </div>
      </Label>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}
