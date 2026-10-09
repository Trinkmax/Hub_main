'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type PartyContact, WEEKDAYS } from '@/lib/accounting/party-profile'
import { cn } from '@/lib/utils'

export const MAX_CONTACTS = 10

/** Los días en que entrega, como chips (Lun … Dom). */
export function DeliveryDaysPicker({
  id,
  value,
  onChange,
  describedBy,
}: {
  id: string
  value: readonly number[]
  onChange: (next: number[]) => void
  describedBy?: string
}) {
  const toggle = (day: number) =>
    onChange(
      value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b),
    )
  return (
    <fieldset
      id={id}
      aria-label="Días de entrega"
      aria-describedby={describedBy}
      className="flex min-w-0 flex-wrap gap-1.5"
    >
      {WEEKDAYS.map((day) => {
        const active = value.includes(day.value)
        return (
          <button
            key={day.value}
            type="button"
            aria-pressed={active}
            aria-label={day.label}
            onClick={() => toggle(day.value)}
            className={cn(
              'h-11 min-w-12 rounded-full border px-3.5 text-sm font-medium transition-colors md:h-8 md:min-w-11 md:text-xs',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary',
            )}
          >
            {day.short}
          </button>
        )
      })}
    </fieldset>
  )
}

const EMPTY_CONTACT: PartyContact = { name: null, role: null, phone: null, email: null }

/**
 * Los contactos del proveedor (el vendedor, quien factura, el reparto): un
 * renglón por persona. Alcanza con el nombre, el teléfono o el email.
 */
export function ContactsEditor({
  idPrefix,
  value,
  onChange,
  error,
}: {
  idPrefix: string
  value: readonly PartyContact[]
  onChange: (next: PartyContact[]) => void
  error?: string
}) {
  const update = (index: number, patch: Partial<PartyContact>) =>
    onChange(value.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index))
  const text = (v: string) => (v.trim() === '' ? null : v)

  return (
    <div className="grid gap-3">
      {value.length > 0 ? (
        <ul className="grid gap-3">
          {value.map((contact, index) => {
            const base = `${idPrefix}-${index}`
            const n = index + 1
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: los renglones no tienen id propio y no se reordenan.
              <li key={index} className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Contacto {n}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 gap-1 px-2 text-muted-foreground md:h-7"
                    onClick={() => remove(index)}
                    aria-label={`Quitar el contacto ${n}`}
                  >
                    <X className="size-3.5" aria-hidden />
                    Quitar
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    id={`${base}-name`}
                    aria-label={`Nombre del contacto ${n}`}
                    placeholder="Nombre"
                    value={contact.name ?? ''}
                    maxLength={60}
                    autoComplete="off"
                    onChange={(e) => update(index, { name: text(e.target.value) })}
                    className="h-11 text-base md:h-9 md:text-sm"
                  />
                  <Input
                    id={`${base}-role`}
                    aria-label={`Qué hace el contacto ${n}`}
                    placeholder="Qué hace (ventas, facturación, reparto)"
                    value={contact.role ?? ''}
                    maxLength={40}
                    autoComplete="off"
                    onChange={(e) => update(index, { role: text(e.target.value) })}
                    className="h-11 text-base md:h-9 md:text-sm"
                  />
                  <Input
                    id={`${base}-phone`}
                    type="tel"
                    aria-label={`Teléfono del contacto ${n}`}
                    placeholder="Teléfono"
                    value={contact.phone ?? ''}
                    maxLength={30}
                    autoComplete="off"
                    onChange={(e) => update(index, { phone: text(e.target.value) })}
                    className="h-11 text-base md:h-9 md:text-sm"
                  />
                  <Input
                    id={`${base}-email`}
                    type="email"
                    aria-label={`Email del contacto ${n}`}
                    placeholder="Email"
                    value={contact.email ?? ''}
                    maxLength={160}
                    autoComplete="off"
                    onChange={(e) => update(index, { email: text(e.target.value) })}
                    className="h-11 text-base md:h-9 md:text-sm"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {value.length < MAX_CONTACTS ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 justify-self-start md:h-8"
          onClick={() => onChange([...value, EMPTY_CONTACT])}
        >
          <Plus className="size-3.5" aria-hidden />
          Agregar contacto
        </Button>
      ) : null}
    </div>
  )
}

/** Lo que se manda: sin los renglones vacíos. */
export function contactsToSave(contacts: readonly PartyContact[]): PartyContact[] {
  return contacts.filter((c) => c.name || c.phone || c.email)
}
