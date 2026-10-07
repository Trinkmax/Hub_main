'use client'

import { normalizeCodeQuery } from '@/components/administracion/account-paths'
import { type ComboOption, EntityCombobox } from '@/components/administracion/entity-combobox'
import { rankAccount, rankAndFilter } from '@/components/administracion/search'
import { type ChartAccount, type ChartIndex, pathLabel } from '../_lib/tree'

/** El valor del combo para «sin grupo: cuenta principal». */
export const ROOT_CHOICE = '__principal__'

/**
 * Elegir un grupo del plan (para crear una cuenta adentro o mover una): busca por código («1.1.01»,
 * «110101») o por nombre, y muestra el camino de cada grupo. `allowRoot` suma «Ninguno: cuenta
 * principal» arriba de todo.
 */
export function GroupCombobox({
  id,
  index,
  groups,
  value,
  onValueChange,
  allowRoot = false,
  invalid,
  describedBy,
  placeholder = 'Elegí el grupo',
}: {
  id: string
  index: ChartIndex
  /** Los grupos que se pueden elegir, en orden de árbol. */
  groups: readonly ChartAccount[]
  /** Id del grupo, `ROOT_CHOICE` o `null` (sin elegir). */
  value: string | null
  onValueChange: (value: string) => void
  allowRoot?: boolean
  invalid?: boolean
  describedBy?: string
  placeholder?: string
}) {
  const selected = value && value !== ROOT_CHOICE ? (index.byId.get(value) ?? null) : null

  const filter = (query: string): ComboOption[] => {
    const q = normalizeCodeQuery(query)
    const options: ComboOption[] = []
    if (allowRoot && (q === '' || 'ninguno principal raiz raíz'.includes(q.toLowerCase()))) {
      options.push({
        value: ROOT_CHOICE,
        label: 'Ninguno: es una cuenta principal',
        description: 'Va al mismo nivel que ACTIVO, PASIVO o RESULTADOS.',
      })
    }
    for (const g of rankAndFilter(groups, q, rankAccount, 300)) {
      options.push({
        value: g.id,
        code: g.code,
        label: g.name,
        description: pathLabel(index, g.id) || 'Cuenta principal',
      })
    }
    return options
  }

  return (
    <EntityCombobox
      id={id}
      value={value}
      selectedLabel={
        value === ROOT_CHOICE ? (
          'Ninguno: es una cuenta principal'
        ) : selected ? (
          <span>
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>{' '}
            {selected.name}
          </span>
        ) : undefined
      }
      filter={filter}
      onSelect={onValueChange}
      placeholder={placeholder}
      searchPlaceholder="Código o nombre del grupo"
      emptyText={(q) => (q ? `No hay grupos con «${q}».` : 'No hay grupos para elegir.')}
      invalid={invalid}
      aria-describedby={describedBy}
    />
  )
}
