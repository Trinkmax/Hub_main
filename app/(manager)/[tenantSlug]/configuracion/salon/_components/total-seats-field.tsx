'use client'

import { Users } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateTotalSeatsAction } from '@/lib/tenant/actions'

export function TotalSeatsField({
  tenantSlug,
  initialTotalSeats,
}: {
  tenantSlug: string
  initialTotalSeats: number | null
}) {
  const [value, setValue] = useState<string>(
    initialTotalSeats !== null ? String(initialTotalSeats) : '',
  )
  const [pending, startTransition] = useTransition()

  const save = () => {
    startTransition(async () => {
      const result = await updateTotalSeatsAction(tenantSlug, value === '' ? null : value)
      if (result.ok) {
        toast.success(
          result.totalSeats === null
            ? 'Capacidad total borrada — el panel del salón no mostrará el ratio.'
            : `Capacidad total: ${result.totalSeats} personas.`,
        )
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <section className="card-hairline rounded-xl border border-border/70 bg-card/85 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users className="size-4 text-primary" aria-hidden />
        <h2 className="font-serif text-lg font-semibold">Capacidad total del bar</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Cuántas personas entran cuando está lleno (incluye barra, mesas, terraza). El panel del
        salón usa este número para calcular cuántos lugares quedan libres en tiempo real. Dejalo
        vacío si preferís no mostrar ratio.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow">
          <Label htmlFor="total-seats" className="text-xs uppercase tracking-wider">
            Personas
          </Label>
          <Input
            id="total-seats"
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ej: 80"
            className="mt-1 max-w-[10rem] tabular-nums"
            disabled={pending}
          />
        </div>
        <Button onClick={save} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </section>
  )
}
