'use client'

import type { ReactNode } from 'react'
import { formatCuit } from '@/lib/fiscal'
import { type ComboOption, EntityCombobox } from './entity-combobox'
import { rankAndFilter, rankParty } from './search'

/** Compatible con `PartyRef` del motor (`ctx.parties`). */
export type PartyOption = {
  id: string
  name: string
  tradeName?: string | null
  taxId?: string | null
  active?: boolean
  /** A la derecha de la fila: «Le debés $ 1.240.000». */
  meta?: ReactNode
  /** Debajo del nombre; default: «CUIT 30-71876543-5». */
  description?: string | null
}

export type PartyComboboxProps = {
  id?: string
  /** Hidden con el id elegido. */
  name?: string
  value: string | null
  onValueChange: (id: string | null, party: PartyOption | null) => void
  /** Todos los elegibles (el contexto los trae enteros; se filtra acá). */
  parties: readonly PartyOption[]
  /**
   * Fila «Crear «Coca-Cola»»: abrí ahí la carga del nuevo proveedor (nombre ya
   * escrito) y, al guardarlo, elegilo con `onValueChange`.
   */
  onCreate?: (name: string) => void
  placeholder?: string
  searchPlaceholder?: string
  /** Muestra también los inactivos. Default `false`. */
  includeInactive?: boolean
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-labelledby'?: string
  'aria-label'?: string
  className?: string
}

function displayName(p: PartyOption): string {
  return p.tradeName && p.tradeName !== p.name ? `${p.tradeName} (${p.name})` : p.name
}

/** Proveedor, cliente o socio: busca por nombre, nombre de fantasía o CUIT. */
export function PartyCombobox({
  value,
  onValueChange,
  parties,
  onCreate,
  placeholder = 'Elegí un proveedor',
  searchPlaceholder = 'Nombre o CUIT',
  includeInactive = false,
  ...rest
}: PartyComboboxProps) {
  const pool = includeInactive
    ? parties
    : parties.filter((p) => p.active !== false || p.id === value)
  const selected = value ? (parties.find((p) => p.id === value) ?? null) : null

  const filter = (query: string): ComboOption[] =>
    rankAndFilter(pool, query, rankParty).map((p) => ({
      value: p.id,
      label: displayName(p),
      description: p.description ?? (p.taxId ? `CUIT ${formatCuit(p.taxId)}` : null),
      meta: p.meta,
    }))

  return (
    <EntityCombobox
      {...rest}
      value={value}
      selectedLabel={selected ? displayName(selected) : undefined}
      filter={filter}
      onSelect={(id) => onValueChange(id, parties.find((p) => p.id === id) ?? null)}
      onCreate={onCreate}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={(q) =>
        q ? `No hay nadie con «${q}».` : 'Todavía no hay proveedores ni clientes cargados.'
      }
    />
  )
}
