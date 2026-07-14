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
