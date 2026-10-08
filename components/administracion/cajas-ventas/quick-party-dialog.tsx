'use client'

import { type FormEvent, useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { type SavedParty, saveParty } from '@/lib/accounting/actions/master'
import type { IvaCondition } from '@/lib/accounting/types'
import { ivaOptionsWith } from '@/lib/arca/lookup-fill'
import { parseCuit } from '@/lib/fiscal'
import { ArcaLookupPanel, ArcaLookupTrigger, useArcaLookup } from '../arca-lookup'
import { describedBy, Field } from './field'

const CONDITIONS: ReadonlyArray<{ value: IvaCondition; label: string }> = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor final' },
]

/**
 * Alta rápida de un socio o un cliente sin salir del formulario (H.0: la fila
 * «Crear «…»» del combo). Guarda con `saveParty` y devuelve el nuevo para
 * elegirlo. Lo demás (mail, cuentas, tasas) se completa en Ajustes.
 *
 * Cliente: «Completar con ARCA» al lado de la CUIT trae el nombre y la condición
 * frente al IVA (diseño §3.1).
 */
export function QuickPartyDialog({
  tenantSlug,
  open,
  onOpenChange,
  kind,
  initialName,
  requireCuit = false,
  onCreated,
}: {
  tenantSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'partner' | 'customer'
  initialName: string
  /** Para una factura A: el CUIT es obligatorio. */
  requireCuit?: boolean
  onCreated: (party: SavedParty) => void
}) {
  const id = useId()
  const [name, setName] = useState(initialName)
  const [cuit, setCuit] = useState('')
  const [condition, setCondition] = useState<IvaCondition>(
    requireCuit ? 'responsable_inscripto' : 'consumidor_final',
  )
  const [termDays, setTermDays] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  /** La persona eligió la condición a mano: ARCA pregunta antes de cambiarla. */
  const [conditionTouched, setConditionTouched] = useState(false)

  const isCustomer = kind === 'customer'
  const arca = useArcaLookup({
    tenantSlug,
    purpose: 'customer',
    cuit,
    values: { name, ivaCondition: condition },
    spec: {
      ivaOptions: CONDITIONS.map((c) => c.value),
      chosen: conditionTouched ? ['ivaCondition'] : [],
      labels: { name: 'Nombre' },
    },
    onApply: (patch) => {
      if (patch.name !== undefined) setName(patch.name)
      if (patch.ivaCondition !== undefined) setCondition(patch.ivaCondition)
      setErrors((prev) => {
        const { name: _name, ivaCondition: _iva, ...rest } = prev
        return rest
      })
    },
    // Los socios no llevan CUIT acá.
    enabled: isCustomer,
  })
  const resetArca = arca.reset

  // Cada vez que se abre, arranca con el nombre que se escribió en el combo.
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setCuit('')
    setCondition(requireCuit ? 'responsable_inscripto' : 'consumidor_final')
    setConditionTouched(false)
    setTermDays('')
    setErrors({})
    setMessage(null)
    resetArca()
  }, [open, initialName, requireCuit, resetArca])

  const title = isCustomer ? 'Nuevo cliente' : 'Nuevo socio'

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    const next: Record<string, string> = {}
    const cleanName = name.trim()
    if (cleanName.length < 2) next.name = 'Escribí el nombre.'
    const rawCuit = cuit.trim()
    let taxId: string | null = null
    if (rawCuit !== '') {
      const parsed = parseCuit(rawCuit)
      if (parsed.ok) taxId = parsed.cuit
      else next.taxId = 'El CUIT no es válido: revisá el último número.'
    } else if (requireCuit) {
      next.taxId = 'Una factura A necesita el CUIT del cliente.'
    }
    const term = termDays.trim() === '' ? 0 : Number(termDays)
    if (!Number.isInteger(term) || term < 0 || term > 365) {
      next.paymentTermDays = 'El plazo va de 0 a 365 días.'
    }
    setErrors(next)
    setMessage(null)
    if (Object.keys(next).length > 0) return

    startTransition(async () => {
      try {
        const result = await saveParty(tenantSlug, {
          kind,
          name: cleanName,
          taxIdType: taxId ? 'cuit' : 'none',
          taxId,
          ivaCondition: isCustomer ? condition : 'sin_datos',
          paymentTermDays: isCustomer ? term : 0,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setMessage(result.message)
          return
        }
        toast.success(result.message)
        onCreated(result.data)
        onOpenChange(false)
      } catch {
        setMessage(ACC_UNREACHABLE.offline)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Con la tarjeta de ARCA puede pasar el alto del celular: que scrollee. */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isCustomer
              ? 'Lo básico para cargarlo. Lo demás se completa en Ajustes.'
              : 'Para registrar sus retiros, aportes y préstamos.'}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          <Field
            id={`${id}-name`}
            label={isCustomer ? 'Nombre o razón social' : 'Nombre'}
            required
            error={errors.name}
          >
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              autoComplete="off"
              className="h-11 text-base md:h-10 md:text-sm"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(`${id}-name`, { error: errors.name })}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {isCustomer ? (
            <>
              <Field
                id={`${id}-cuit`}
                label="CUIT"
                required={requireCuit}
                optional={!requireCuit}
                error={errors.taxId}
              >
                <ArcaLookupTrigger lookup={arca}>
                  <Input
                    id={`${id}-cuit`}
                    value={cuit}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="30-71234567-8"
                    maxLength={13}
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                    aria-invalid={errors.taxId ? true : undefined}
                    aria-describedby={describedBy(`${id}-cuit`, { error: errors.taxId })}
                    onChange={(e) => setCuit(e.target.value)}
                  />
                </ArcaLookupTrigger>
              </Field>
              <ArcaLookupPanel lookup={arca} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`${id}-iva`} label="Condición frente al IVA" error={errors.ivaCondition}>
                  <Select
                    value={condition}
                    onValueChange={(v) => {
                      setCondition(v as IvaCondition)
                      setConditionTouched(true)
                    }}
                  >
                    <SelectTrigger
                      id={`${id}-iva`}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ivaOptionsWith(CONDITIONS, condition).map((c) => (
                        <SelectItem key={c.value} value={c.value} className="min-h-11 md:min-h-8">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id={`${id}-term`}
                  label="Plazo para pagar"
                  optional
                  hint="En días. Vacío: al contado."
                  error={errors.paymentTermDays}
                >
                  <Input
                    id={`${id}-term`}
                    value={termDays}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                    aria-invalid={errors.paymentTermDays ? true : undefined}
                    aria-describedby={describedBy(`${id}-term`, {
                      hint: true,
                      error: errors.paymentTermDays,
                    })}
                    onChange={(e) => setTermDays(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              </div>
            </>
          ) : null}
          {message ? (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={pending}>
              {pending ? 'Guardando…' : isCustomer ? 'Crear cliente' : 'Crear socio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
