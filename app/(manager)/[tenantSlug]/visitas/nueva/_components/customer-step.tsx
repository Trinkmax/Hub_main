'use client'

import { UserPlus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { CustomerPicker } from '@/components/customers/customer-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldRow, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { createCustomer } from '@/lib/customers/actions'
import type { WizardCustomer } from './wizard'

/**
 * Paso 1 de «Cerrar mesa»: quién está en la mesa. El buscador es el
 * `CustomerPicker` del kit (búsqueda por Route Handler GET, con teclado y
 * «Crear…» al final de la lista); arranca con el foco puesto, así el cajero
 * escribe apenas entra.
 */
export function CustomerStep({
  tenantSlug,
  selected,
  onSelect,
}: {
  tenantSlug: string
  selected: WizardCustomer | null
  onSelect: (c: WizardCustomer) => void
}) {
  // `null`: el diálogo de alta está cerrado; un texto: abierto, con ese nombre de arranque.
  const [newName, setNewName] = useState<string | null>(null)

  return (
    <Section
      title="¿Quién está en la mesa?"
      description="Buscá por nombre, apellido o teléfono. Si es la primera vez que viene, lo creás en el momento."
    >
      <div className="flex max-w-xl flex-col gap-4">
        <Field label="Cliente" hint="Escribí al menos 2 letras o números.">
          <CustomerPicker
            tenantSlug={tenantSlug}
            size="lg"
            // Paso 1 del asistente: el cajero escribe apenas entra.
            autoFocus
            value={selected?.id ?? null}
            selectedCustomer={selected}
            onValueChange={(id, customer) => {
              if (customer) {
                onSelect({
                  id: customer.id,
                  first_name: customer.first_name,
                  last_name: customer.last_name,
                  phone: customer.phone,
                  points_balance: customer.points_balance,
                })
              } else if (id !== null && selected && id === selected.id) {
                // El elegido antes (vuelve con «Atrás»): seguir con él.
                onSelect(selected)
              }
            }}
            onCreate={(query) => setNewName(query)}
            createLabel={(query) => `Crear cliente «${query}»`}
          />
        </Field>
        <div>
          <Button variant="secondary" onClick={() => setNewName('')}>
            <UserPlus aria-hidden="true" />
            Nuevo cliente
          </Button>
        </div>
      </div>

      {newName !== null ? (
        <NewCustomerDialog
          tenantSlug={tenantSlug}
          initialName={newName}
          onClose={() => setNewName(null)}
          onCreated={(c) => {
            setNewName(null)
            onSelect(c)
          }}
        />
      ) : null}
    </Section>
  )
}

function NewCustomerDialog({
  tenantSlug,
  initialName,
  onClose,
  onCreated,
}: {
  tenantSlug: string
  initialName: string
  onClose: () => void
  onCreated: (c: WizardCustomer) => void
}) {
  const [phone, setPhone] = useState('')
  const [first, setFirst] = useState(initialName)
  const [last, setLast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    const fd = new FormData()
    fd.set('phone', phone)
    fd.set('first_name', first)
    fd.set('last_name', last)
    start(async () => {
      const r = await createCustomer(tenantSlug, { ok: true }, fd)
      if (r.ok && r.customerId) {
        onCreated({
          id: r.customerId,
          first_name: first,
          last_name: last,
          phone,
          points_balance: 0,
        })
      } else if (!r.ok) {
        const fields = r.fieldErrors ?? {}
        setFieldErrors(fields)
        // Si el error es de un campo, se ve abajo de ese campo; si no, arriba.
        setError(Object.keys(fields).length > 0 ? null : r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>Lo sumamos a tus clientes y seguís con la mesa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FormError message={error} />
          <Field
            label="Teléfono"
            hint="Con característica. El 0 y el 15 los sacamos solos."
            error={fieldErrors.phone}
            required
          >
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="351 555 1234"
              autoComplete="off"
            />
          </Field>
          <FieldRow>
            <Field label="Nombre" error={fieldErrors.first_name} required>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Apellido" error={fieldErrors.last_name} required>
              <Input value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} />
            </Field>
          </FieldRow>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              aria-disabled={pending}
              onClick={() => {
                if (!pending) onClose()
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Creando…">
              Crear y seguir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
