'use client'

import { Armchair, Loader2, Save } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setBranchSeatCapacity } from '@/lib/salon/segment-actions'

/**
 * «Cupo general de la sucursal»: las sillas de una sucursal SIN plantas (el Cerro), en `branches.seat_capacity`.
 *
 * Es lo que la principal tiene en «Cupo general por planta» (PA + PB): el respaldo de cada servicio que no tiene un
 * cupo propio en la grilla de arriba. Vacío = sin cargar: los servicios quedan sin tope.
 */

/** Solo dígitos y hasta 4 (el tope es 2000). */
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4)
}

export function BranchSeatsEditor({
  tenantSlug,
  branchId,
  branchName,
  initialSeats,
}: {
  tenantSlug: string
  branchId: string
  branchName: string
  initialSeats: number | null
}) {
  const inputId = useId()
  const [value, setValue] = useState(initialSeats === null ? '' : String(initialSeats))
  const [saved, setSaved] = useState<number | null>(initialSeats)
  const [pending, startTransition] = useTransition()

  const next = value.trim() === '' ? null : Number(value)
  const dirty = next !== saved

  function save() {
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 2000)) {
      toast.error('El cupo va entre 1 y 2000 personas.')
      return
    }
    startTransition(async () => {
      try {
        const result = await setBranchSeatCapacity(tenantSlug, {
          branch_id: branchId,
          seat_capacity: next,
        })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        setSaved(result.data.seatCapacity)
        toast.success(
          result.data.seatCapacity === null
            ? `${branchName}: sin cupo general (los servicios sin cupo propio quedan sin tope).`
            : `${branchName}: ${result.data.seatCapacity} personas por servicio.`,
        )
      } catch (error) {
        console.error(
          '[configuracion.salon.saveSeats]',
          error instanceof Error ? error.message : error,
        )
        toast.error('No se pudo guardar el cupo de la sucursal. Probá de nuevo.')
      }
    })
  }

  return (
    <section className="card-hairline rounded-xl border border-border/70 bg-card/85 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Armchair className="size-4 text-primary" aria-hidden />
        <h2 className="font-serif text-lg font-semibold">Cupo general de la sucursal</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground text-pretty">
        Cuántas personas entran en {branchName} por servicio. Lo usa cada servicio que no tiene un
        cupo propio en la grilla de arriba. Esta sucursal no tiene plantas: las reservas van sin
        planta.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow">
          <Label htmlFor={inputId} className="text-xs uppercase tracking-wider">
            Personas
          </Label>
          <Input
            id={inputId}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(onlyDigits(e.target.value))}
            placeholder="Ej: 40"
            className="mt-1 max-w-[10rem] tabular-nums"
            disabled={pending}
          />
        </div>
        <Button onClick={save} disabled={pending || !dirty} className="gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </section>
  )
}
