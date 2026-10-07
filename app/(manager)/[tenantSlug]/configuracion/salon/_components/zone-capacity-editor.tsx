'use client'

import { Save } from 'lucide-react'
import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldRow } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { NumberField } from '@/components/ui/number-field'
import { Section } from '@/components/ui/section'
import { setZoneCapacityDefaults } from '@/lib/salon/actions'
import { ZONE_LABELS } from '@/lib/salon/types'

/**
 * «Cupo general por planta»: PA y PB en `tenants.settings.salon_capacities`.
 *
 * Desde el cupo por servicio, este número ya no es el tope del día: es el
 * RESPALDO de los servicios que no se configuraron arriba (PA + PB por
 * servicio). Lo sigue mirando el onboarding para dar la capacidad por cargada.
 *
 * Los «overrides por fecha» por planta que vivían acá se sacaron: ningún
 * cálculo los lee más y los reemplaza el cupo especial por servicio (la tabla
 * se dropea desde el backlog). Tener dos lugares para «el feriado entran 120»
 * era la receta para que el calendario mostrara uno y la config el otro.
 */

/** El tope de cada planta (lo que acepta la action). Vacío cuenta como 0 al guardar. */
const MAX_PER_ZONE = 999

export function ZoneCapacityEditor({
  tenantSlug,
  defaults,
}: {
  tenantSlug: string
  defaults: { planta_alta: number; planta_baja: number }
}) {
  const [pa, setPA] = useState<number | null>(defaults.planta_alta)
  const [pb, setPB] = useState<number | null>(defaults.planta_baja)
  const [saved, setSaved] = useState(defaults)
  const [pending, startTransition] = useTransition()

  const total = (pa ?? 0) + (pb ?? 0)
  const dirty = (pa ?? 0) !== saved.planta_alta || (pb ?? 0) !== saved.planta_baja

  // Un número que no se entiende frena el envío antes de llegar acá (el campo
  // muestra por qué).
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = { planta_alta: pa ?? 0, planta_baja: pb ?? 0 }
    startTransition(async () => {
      try {
        const r = await setZoneCapacityDefaults(tenantSlug, next)
        if (!r.ok) {
          toast.error(r.message)
          return
        }
        setSaved(next)
        toast.success(`Cupo general guardado: ${next.planta_alta + next.planta_baja} por servicio.`)
      } catch (error) {
        console.error(
          '[configuracion.salon.setZoneCapacityDefaults]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        toast.error('No pudimos hablar con el servidor. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  return (
    <Section
      divider
      title="Cupo general por planta"
      description={
        <>
          Se usa para los servicios que no configuraste arriba: PA + PB ={' '}
          <span className="type-amount font-semibold text-foreground">{total}</span> personas por
          servicio.{total === 0 ? ' Con 0, esos servicios quedan sin tope.' : null}
        </>
      }
    >
      <form onSubmit={save} className="flex max-w-sm flex-col gap-4">
        {/* Dos números cortos: lado a lado también en el celular. */}
        <FieldRow className="grid-cols-2">
          <Field label={ZONE_LABELS.planta_alta}>
            <NumberField
              value={pa}
              onValueChange={setPA}
              min={0}
              max={MAX_PER_ZONE}
              steppers={false}
              placeholder="0"
            />
          </Field>
          <Field label={ZONE_LABELS.planta_baja}>
            <NumberField
              value={pb}
              onValueChange={setPB}
              min={0}
              max={MAX_PER_ZONE}
              steppers={false}
              placeholder="0"
            />
          </Field>
        </FieldRow>
        <FormActions sticky={false}>
          <Button
            type="submit"
            disabled={!dirty && !pending}
            loading={pending}
            loadingText="Guardando…"
          >
            <Save aria-hidden />
            Guardar cupo general
          </Button>
        </FormActions>
      </form>
    </Section>
  )
}
