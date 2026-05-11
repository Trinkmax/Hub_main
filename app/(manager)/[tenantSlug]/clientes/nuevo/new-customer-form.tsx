'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CustomerActionState, createCustomer } from '@/lib/customers/actions'

const initial: CustomerActionState = { ok: true }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? 'Guardando…' : 'Crear cliente'}
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

export function NewCustomerForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createCustomer.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const router = useRouter()
  const [phone, setPhone] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.ok && state.customerId) {
      toast.success(state.message ?? 'Cliente creado.')
      router.push(`/${tenantSlug}/clientes/${state.customerId}`)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, router, tenantSlug])

  return (
    <form action={formAction} className="grid gap-5">
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
          placeholder="351 555 1234"
          className="hub-phone-input"
          aria-invalid={state.ok ? undefined : Boolean(state.fieldErrors?.phone)}
          aria-required="true"
        />
        <p className="text-xs text-muted-foreground">
          Elegí el país y la bandera se autocompleta. Guardamos el número en formato internacional.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="first_name">
            Nombre
            <RequiredMark />
          </Label>
          <Input id="first_name" name="first_name" required maxLength={60} aria-required="true" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="last_name">
            Apellido
            <RequiredMark />
          </Label>
          <Input id="last_name" name="last_name" required maxLength={60} aria-required="true" />
        </div>
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
            maxLength={120}
            placeholder="cliente@ejemplo.com"
            autoComplete="email"
            aria-invalid={state.ok ? undefined : Boolean(state.fieldErrors?.email)}
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
            aria-invalid={state.ok ? undefined : Boolean(state.fieldErrors?.birthdate)}
          />
        </div>
      </div>

      <Label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3.5">
        <Checkbox name="opt_in_marketing" id="opt_in_marketing" className="mt-0.5" />
        <div className="space-y-0.5">
          <span className="text-sm font-medium leading-none">
            Acepta recibir promociones por WhatsApp y email
          </span>
          <span className="block text-xs text-muted-foreground">
            Marcá esto solo si te lo confirmó verbalmente o por escrito. Quedará registrado con
            fecha, hora e IP.
          </span>
        </div>
      </Label>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}
