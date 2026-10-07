'use client'

import { useActionState, useEffect, useState } from 'react'
import type { Value } from 'react-phone-number-input'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldRow, FormError, FormSection } from '@/components/ui/field'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import { type CustomerActionState, updateCustomer } from '@/lib/customers/actions'
import { todayInCordoba } from '@/lib/dates'
import { SERVICE_ALERT_META, SERVICE_ALERTS, type ServiceAlert } from '@/lib/salon/alerts'
import { PhoneField } from '../../_components/phone-field'

const initial: CustomerActionState = { ok: true }

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

const PERSON_ALERTS = SERVICE_ALERTS.filter((a) => SERVICE_ALERT_META[a].scope === 'person')

/** Los campos que muestran su propio error. */
const FIELD_NAMES = ['first_name', 'last_name', 'phone', 'email', 'birthdate', 'notes'] as const

/** Los datos del cliente (pestaña «Datos» de la ficha). Guarda con la Server Action de siempre. */
export function CustomerForm({
  tenantSlug,
  customer,
}: {
  tenantSlug: string
  customer: CustomerFormData
}) {
  const action = updateCustomer.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const [phone, setPhone] = useState<Value | undefined>(
    (customer.phone || undefined) as Value | undefined,
  )
  const [selected, setSelected] = useState<ServiceAlert[]>(customer.service_alerts)
  const [today] = useState(() => todayInCordoba())

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
  }, [state])

  const fieldErrors = state.ok ? undefined : state.fieldErrors
  // Un error de un campo se ve abajo de ese campo; el resto, arriba del formulario.
  const shownInField = FIELD_NAMES.some((name) => fieldErrors?.[name])
  const generalError = !state.ok && !shownInField ? state.message : null

  return (
    <form action={formAction} className="grid">
      <input type="hidden" name="id" value={customer.id} />
      <FormError message={generalError} className="mb-6" />

      <FormSection title="Contacto">
        <FieldRow>
          <Field label="Nombre" error={fieldErrors?.first_name} required>
            <Input name="first_name" defaultValue={customer.first_name} maxLength={60} />
          </Field>
          <Field label="Apellido" error={fieldErrors?.last_name} required>
            <Input name="last_name" defaultValue={customer.last_name} maxLength={60} />
          </Field>
        </FieldRow>
        <Field label="WhatsApp" error={fieldErrors?.phone} required>
          <PhoneField name="phone" value={phone} onChange={setPhone} />
        </Field>
        <FieldRow>
          <Field label="Email" error={fieldErrors?.email} optional>
            <Input
              name="email"
              type="email"
              defaultValue={customer.email ?? ''}
              maxLength={120}
              placeholder="cliente@ejemplo.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Cumpleaños" name="birthdate" error={fieldErrors?.birthdate} optional>
            <DatePicker
              defaultValue={customer.birthdate}
              max={today}
              captionLayout="dropdowns"
              fromYear={1920}
              toYear={Number(today.slice(0, 4))}
              clearable
            />
          </Field>
        </FieldRow>
      </FormSection>

      {/* Avisos permanentes. Esta ficha es el ÚNICO lugar donde se sacan: en una
          reserva se pueden marcar (y suben acá solos), pero desmarcarlos ahí no
          los borra, o un descuido dejaría sin aviso a todas las demás reservas
          de esta persona. */}
      <FormSection
        title="Servicio"
        description="Los avisos aparecen solos en cada reserva de esta persona, en la agenda y en el panel de mozos."
      >
        <ChipGroup aria-label="Avisos de servicio">
          {PERSON_ALERTS.map((alert) => {
            const meta = SERVICE_ALERT_META[alert]
            const active = selected.includes(alert)
            return (
              <FilterChip
                key={alert}
                size="md"
                title={meta.hint}
                pressed={active}
                onPressedChange={(next) =>
                  setSelected((prev) => (next ? [...prev, alert] : prev.filter((a) => a !== alert)))
                }
              >
                {meta.label}
              </FilterChip>
            )
          })}
        </ChipGroup>
        {selected.map((alert) => (
          <input key={alert} type="hidden" name="service_alerts" value={alert} />
        ))}
        <Field label="Notas internas" error={fieldErrors?.notes} optional>
          <Textarea
            name="notes"
            defaultValue={customer.notes ?? ''}
            maxLength={500}
            showCount
            placeholder="Preferencias, alergias, lo que el equipo tiene que saber…"
            rows={4}
          />
        </Field>
      </FormSection>

      <FormSection title="Mensajes">
        <Field
          layout="toggle"
          label="Acepta recibir promociones por WhatsApp y email"
          hint="Marcalo solo si te lo confirmó. Queda registrado con fecha, hora e IP."
        >
          <Checkbox name="opt_in_marketing" defaultChecked={customer.opt_in_marketing} />
        </Field>
        <Field
          layout="toggle"
          label="No contactar"
          hint="Frena todo mensaje saliente (difusiones, automatizaciones y contacto a mano), aunque haya aceptado promociones."
        >
          <Checkbox name="is_blocked" defaultChecked={customer.is_blocked} />
        </Field>
      </FormSection>

      <FormActions className="mt-6">
        <SubmitButton pendingText="Guardando…">Guardar cambios</SubmitButton>
      </FormActions>
    </form>
  )
}
