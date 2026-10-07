'use client'

import { type FormEvent, useEffect, useState, useTransition } from 'react'
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
import { normalizeCuit } from '@/lib/fiscal'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { CuitInput, cuitIssue, INPUT_CLASS } from '../../ajustes/_components/inputs'

export type NewPartyKind = 'supplier' | 'customer'

const CONDITIONS: Readonly<
  Record<NewPartyKind, ReadonlyArray<{ value: IvaCondition; label: string }>>
> = {
  supplier: [
    { value: 'responsable_inscripto', label: 'Responsable inscripto' },
    { value: 'monotributo', label: 'Monotributo' },
    { value: 'exento', label: 'Exento' },
    { value: 'sin_datos', label: 'No sé' },
  ],
  customer: [
    { value: 'consumidor_final', label: 'Consumidor final' },
    { value: 'responsable_inscripto', label: 'Responsable inscripto' },
    { value: 'monotributo', label: 'Monotributo' },
    { value: 'exento', label: 'Exento' },
  ],
}

/**
 * Alta rápida de un proveedor o cliente desde un combo (H.3 paso 3): nombre,
 * condición frente al IVA y CUIT opcional. Al guardarlo queda elegido en la
 * fila que lo pidió.
 */
export function NewPartyDialog({
  tenantSlug,
  open,
  kind,
  initialName,
  onOpenChange,
  onCreated,
}: {
  tenantSlug: string
  open: boolean
  kind: NewPartyKind
  initialName: string
  onOpenChange: (open: boolean) => void
  onCreated: (party: SavedParty) => void
}) {
  const [name, setName] = useState(initialName)
  const [condition, setCondition] = useState<IvaCondition>(
    CONDITIONS[kind][0]?.value ?? 'sin_datos',
  )
  const [cuit, setCuit] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Cada vez que se abre, arranca con lo que se tipeó en el combo.
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setCondition(CONDITIONS[kind][0]?.value ?? 'sin_datos')
    setCuit('')
    setErrors({})
    setMessage(null)
  }, [open, initialName, kind])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (pending) return
    const next: Record<string, string> = {}
    if (name.trim().length < 2) next.name = 'Escribí el nombre.'
    const issue = cuitIssue(cuit)
    if (issue) next.taxId = issue
    setErrors(next)
    setMessage(null)
    if (Object.keys(next).length > 0) return
    const taxId = cuit.trim() ? normalizeCuit(cuit) : null
    startTransition(async () => {
      try {
        const result = await saveParty(tenantSlug, {
          kind,
          name: name.trim(),
          ivaCondition: condition,
          taxIdType: taxId ? 'cuit' : 'none',
          taxId,
        })
        if (result.ok) {
          onCreated(result.data)
          onOpenChange(false)
          return
        }
        setErrors(
          Object.fromEntries(
            Object.entries(result.fieldErrors ?? {}).map(([k, v]) => [
              k === 'taxIdType' ? 'taxId' : k,
              v,
            ]),
          ),
        )
        setMessage(result.message)
      } catch {
        setMessage(ACC_UNREACHABLE.offline)
      }
    })
  }

  const title = kind === 'supplier' ? 'Nuevo proveedor' : 'Nuevo cliente'

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">{title}</DialogTitle>
          <DialogDescription>
            Lo básico para cargar el saldo. Los demás datos los completás después.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field id="np-name" label="Nombre o razón social" required error={errors.name ?? null}>
            <Input
              id="np-name"
              value={name}
              maxLength={120}
              autoFocus
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy('np-name', null, errors.name)}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field id="np-condition" label="Condición frente al IVA">
            <Select value={condition} onValueChange={(v) => setCondition(v as IvaCondition)}>
              <SelectTrigger
                id="np-condition"
                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS[kind].map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="np-cuit" label="CUIT" optional error={errors.taxId ?? null}>
            <CuitInput
              id="np-cuit"
              value={cuit}
              invalid={Boolean(errors.taxId)}
              describedBy={describedBy('np-cuit', null, errors.taxId)}
              onChange={setCuit}
              onBlurCheck={(issue) =>
                setErrors((prev) => {
                  const { taxId: _taxId, ...rest } = prev
                  return issue ? { ...rest, taxId: issue } : rest
                })
              }
            />
          </Field>
          {message ? <Callout tone="error">{message}</Callout> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-11 min-w-[140px] md:h-9" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
