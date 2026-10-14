'use client'

import { Plus, Trash2 } from 'lucide-react'
import { ADD_LINK } from '@/components/administracion/acciones/sheet-parts'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Channel } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { describedBy, Field } from '../../../ajustes/_components/form-bits'
import { INPUT_CLASS } from '../../../ajustes/_components/inputs'
import { InvoiceNumber } from '../../../ajustes/_components/invoice-number'
import type { WizardSalesPoint, WizardState } from '../../_lib/wizard'

/**
 * Paso 4 de la puesta en marcha · «¿Con qué número facturás?».
 *
 * El dibujo de la factura con su número señalado y, al lado, un renglón por
 * punto de venta (número, nombre y a qué parte del cierre del día va). Si el
 * bar todavía no factura, se sigue sin cargar ninguno: todo queda como venta
 * sin factura, registrado igual.
 *
 * Mismo estado (`WizardState.salesPoints`): los renglones en blanco no viajan.
 */

const CHANNELS: readonly ChoiceChip<Channel>[] = [
  { value: 'salon', label: 'Salón' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'events', label: 'Eventos' },
]

export function StepPuntos({
  state,
  errors,
  updatePoint,
  removePoint,
  addPoint,
  clearError,
}: {
  state: WizardState
  errors: Readonly<Record<string, string>>
  updatePoint: (id: string, patch: Partial<WizardSalesPoint>) => void
  removePoint: (id: string) => void
  addPoint: () => void
  clearError: (...fields: string[]) => void
}) {
  const err = (field: string) => errors[field] ?? null
  const first = state.salesPoints.find((p) => /^\d{1,5}$/.test(p.number.trim()))
  return (
    <div className="grid gap-5 md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-6">
      <div className="space-y-3">
        <InvoiceNumber number={first ? Number(first.number) : null} />
        <p className="text-sm text-muted-foreground text-pretty">
          Mirá cualquier factura o tique de los que entregan hoy: son los cuatro números de
          adelante.
        </p>
      </div>
      <div className="grid gap-3">
        <ul className="grid gap-2.5">
          {state.salesPoints.map((p) => {
            const id = `wz-sp-${p.id}`
            const numberError = err(`salesPoint.${p.id}.number`)
            const labelError = err(`salesPoint.${p.id}.label`)
            return (
              <li key={p.id} className="grid gap-3 rounded-xl bg-secondary/50 p-3">
                <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-3">
                  <Field id={`${id}-number`} label="Número" error={numberError}>
                    <Input
                      id={`${id}-number`}
                      value={p.number}
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="3"
                      aria-invalid={numberError ? true : undefined}
                      aria-describedby={describedBy(`${id}-number`, null, numberError)}
                      onChange={(e) => {
                        updatePoint(p.id, { number: e.target.value.replace(/\D/g, '') })
                        clearError(`salesPoint.${p.id}.number`, 'salesPoints')
                      }}
                      className={cn(INPUT_CLASS, 'font-mono tabular-nums')}
                    />
                  </Field>
                  <Field id={`${id}-label`} label="Nombre" error={labelError}>
                    <Input
                      id={`${id}-label`}
                      value={p.label}
                      maxLength={60}
                      placeholder="Salón"
                      aria-invalid={labelError ? true : undefined}
                      onChange={(e) => {
                        updatePoint(p.id, { label: e.target.value })
                        clearError(`salesPoint.${p.id}.label`)
                      }}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-[1.375rem] size-11 text-muted-foreground hover:text-destructive md:size-10"
                    aria-label={
                      p.number
                        ? `Quitar el punto de venta ${p.number}`
                        : 'Quitar este punto de venta'
                    }
                    onClick={() => removePoint(p.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  <span id={`${id}-channel-label`} className="text-sm font-medium">
                    ¿A qué parte del cierre del día va?
                  </span>
                  <ChoiceChips
                    options={CHANNELS}
                    value={p.channel}
                    labelledBy={`${id}-channel-label`}
                    onChange={(channel) => updatePoint(p.id, { channel })}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        {state.salesPoints.length === 0 ? (
          <p className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground text-pretty">
            Sin puntos de venta: en el cierre, todo el día queda como venta sin factura. Se registra
            igual, y los podés cargar después en Ajustes › Puntos de venta.
          </p>
        ) : null}
        {err('salesPoints') ? (
          <p role="alert" className="text-xs text-destructive">
            {err('salesPoints')}
          </p>
        ) : null}
        {state.salesPoints.length < 20 ? (
          <button type="button" className={ADD_LINK} onClick={addPoint}>
            <Plus className="size-3.5" aria-hidden />
            Agregar un punto de venta
          </button>
        ) : null}
      </div>
    </div>
  )
}
