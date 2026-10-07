'use client'

import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { NumberField } from '@/components/ui/number-field'
import { Section } from '@/components/ui/section'
import { updateTotalSeatsAction } from '@/lib/tenant/actions'

/** Lo que acepta la action (`totalSeatsSchema`). */
const MIN_SEATS = 1
const MAX_SEATS = 2000

export function TotalSeatsField({
  tenantSlug,
  initialTotalSeats,
}: {
  tenantSlug: string
  initialTotalSeats: number | null
}) {
  const [value, setValue] = useState<number | null>(initialTotalSeats)
  const [pending, startTransition] = useTransition()

  // Un número que no se entiende o fuera de rango frena el envío antes de
  // llegar acá: el campo muestra por qué. Vacío borra el número, como antes.
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateTotalSeatsAction(tenantSlug, value === null ? null : String(value))
      if (result.ok) {
        toast.success(
          result.totalSeats === null
            ? 'Borramos la capacidad total: el panel del salón no va a mostrar cuántos lugares quedan.'
            : `Capacidad total: ${result.totalSeats} personas.`,
        )
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Section
      divider
      title="Capacidad total del bar"
      description="Cuántas personas entran cuando está lleno (barra, mesas y terraza). El panel del salón usa este número para mostrar cuántos lugares quedan libres en vivo. Dejalo vacío si preferís no mostrarlo."
    >
      <form onSubmit={save} className="flex max-w-sm flex-col gap-4">
        <Field label="Personas">
          <NumberField
            value={value}
            onValueChange={setValue}
            min={MIN_SEATS}
            max={MAX_SEATS}
            steppers={false}
            placeholder="Ej: 80"
            disabled={pending}
          />
        </Field>
        <FormActions sticky={false}>
          <Button type="submit" loading={pending} loadingText="Guardando…">
            Guardar capacidad total
          </Button>
        </FormActions>
      </form>
    </Section>
  )
}
