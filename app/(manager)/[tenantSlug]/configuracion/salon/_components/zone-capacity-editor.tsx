'use client'

import { Layers, Loader2, Save } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

/** Solo dígitos y hasta 3 (el tope es 999). Vacío cuenta como 0 al guardar. */
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3)
}

function toCount(raw: string): number {
  const n = Number(raw)
  return raw.trim() === '' || !Number.isFinite(n) ? 0 : n
}

export function ZoneCapacityEditor({
  tenantSlug,
  defaults,
}: {
  tenantSlug: string
  defaults: { planta_alta: number; planta_baja: number }
}) {
  const baseId = useId()
  const [pa, setPA] = useState(String(defaults.planta_alta))
  const [pb, setPB] = useState(String(defaults.planta_baja))
  const [saved, setSaved] = useState(defaults)
  const [pending, startTransition] = useTransition()

  const total = toCount(pa) + toCount(pb)
  const dirty = toCount(pa) !== saved.planta_alta || toCount(pb) !== saved.planta_baja

  function save() {
    const next = { planta_alta: toCount(pa), planta_baja: toCount(pb) }
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
    <section
      aria-labelledby={`${baseId}-title`}
      className="card-hairline min-w-0 space-y-4 rounded-xl border border-border/70 bg-card/85 p-4 sm:p-5"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" aria-hidden />
          <h2 id={`${baseId}-title`} className="font-serif text-lg font-semibold">
            Cupo general por planta
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Se usa para los servicios que no configuraste arriba: PA + PB ={' '}
          <span className="font-semibold text-foreground tabular-nums">{total}</span> personas por
          servicio.
          {total === 0 ? ' Con 0, esos servicios quedan sin tope.' : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={`${baseId}-pa`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            {ZONE_LABELS.planta_alta}
          </Label>
          <Input
            id={`${baseId}-pa`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={3}
            value={pa}
            onChange={(e) => setPA(onlyDigits(e.target.value))}
            placeholder="0"
            className="h-10 text-base tabular-nums"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={`${baseId}-pb`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            {ZONE_LABELS.planta_baja}
          </Label>
          <Input
            id={`${baseId}-pb`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={3}
            value={pb}
            onChange={(e) => setPB(onlyDigits(e.target.value))}
            placeholder="0"
            className="h-10 text-base tabular-nums"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending || !dirty} className="gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {pending ? 'Guardando…' : 'Guardar cupo general'}
        </Button>
      </div>
    </section>
  )
}
