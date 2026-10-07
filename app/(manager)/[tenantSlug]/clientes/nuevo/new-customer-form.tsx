'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import type { Value } from 'react-phone-number-input'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldRow, FormError, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { type CustomerActionState, createCustomer } from '@/lib/customers/actions'
import { todayInCordoba } from '@/lib/dates'
import { PhoneField } from '../_components/phone-field'

const initial: CustomerActionState = { ok: true }

/** Los campos que muestran su propio error. */
const FIELD_NAMES = ['phone', 'first_name', 'last_name', 'email', 'birthdate'] as const

export function NewCustomerForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createCustomer.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const router = useRouter()
  const [phone, setPhone] = useState<Value | undefined>(undefined)
  const [today] = useState(() => todayInCordoba())

  useEffect(() => {
    if (state.ok && state.customerId) {
      toast.success(state.message ?? 'Cliente creado.')
      router.push(`/${tenantSlug}/clientes/${state.customerId}`)
    }
  }, [state, router, tenantSlug])

  const fieldErrors = state.ok ? undefined : state.fieldErrors
  // Un error de un campo se ve abajo de ese campo; el resto, arriba del formulario.
  const shownInField = FIELD_NAMES.some((name) => fieldErrors?.[name])
  const generalError = !state.ok && !shownInField ? state.message : null

  return (
    <form action={formAction} className="flex flex-col">
      <FormError message={generalError} className="mb-6" />

      <FormSection title="Contacto">
        <Field
          label="WhatsApp"
          hint="Elegí el país con la bandera. Lo guardamos en formato internacional."
          error={fieldErrors?.phone}
          required
        >
          <PhoneField name="phone" value={phone} onChange={setPhone} placeholder="351 555 1234" />
        </Field>
        <FieldRow>
          <Field label="Nombre" error={fieldErrors?.first_name} required>
            <Input name="first_name" maxLength={60} autoComplete="off" />
          </Field>
          <Field label="Apellido" error={fieldErrors?.last_name} required>
            <Input name="last_name" maxLength={60} autoComplete="off" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Email" error={fieldErrors?.email} optional>
            <Input
              name="email"
              type="email"
              maxLength={120}
              placeholder="cliente@ejemplo.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Cumpleaños" name="birthdate" error={fieldErrors?.birthdate} optional>
            <DatePicker
              max={today}
              captionLayout="dropdowns"
              fromYear={1920}
              toYear={Number(today.slice(0, 4))}
              clearable
            />
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title="Permisos">
        <Field
          layout="toggle"
          label="Acepta recibir promociones por WhatsApp y email"
          hint="Marcalo solo si te lo confirmó, de palabra o por escrito. Queda registrado con fecha, hora e IP."
        >
          <Checkbox name="opt_in_marketing" />
        </Field>
      </FormSection>

      <FormActions className="mt-6">
        <Button asChild variant="secondary" className="max-sm:hidden">
          <Link href={`/${tenantSlug}/clientes`}>Cancelar</Link>
        </Button>
        <SubmitButton pendingText="Creando…">Crear cliente</SubmitButton>
      </FormActions>
    </form>
  )
}
