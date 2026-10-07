'use client'

import { useMemo } from 'react'
import { type ComboOption, EntityCombobox } from './entity-combobox'
import { rankAccount, rankAndFilter } from './search'

/** Compatible con `AccountRef` del motor (`ctx.accounts`) y con las filas del plan. */
export type AccountOption = {
  id: string
  /** `1.1.01.02`. */
  code: string
  name: string
  /** Solo las imputables se pueden elegir; los rubros arman la ruta y los grupos. */
  postable: boolean
  active?: boolean
  /** «Para qué se usa». */
  description?: string | null
}

export type AccountComboboxProps = {
  id?: string
  name?: string
  value: string | null
  onValueChange: (id: string | null, account: AccountOption | null) => void
  /** El plan entero (rubros + imputables): la ruta sale de los códigos. */
  accounts: readonly AccountOption[]
  /** Para acotar (p. ej. solo las de compras: `(a) => a.purchaseSelectable`). */
  filter?: (account: AccountOption) => boolean
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-labelledby'?: string
  'aria-label'?: string
  className?: string
}

function parentCode(code: string): string | null {
  const at = code.lastIndexOf('.')
  return at === -1 ? null : code.slice(0, at)
}

/**
 * Cuenta del plan: busca por código («1101» encuentra 1.1.01) o por nombre;
 * cada opción muestra su ruta («Activo › Disponibilidades»). Solo se eligen
 * cuentas imputables y activas; los rubros son encabezados.
 */
export function AccountCombobox({
  value,
  onValueChange,
  accounts,
  filter: extraFilter,
  placeholder = 'Elegí una cuenta',
  searchPlaceholder = 'Código o nombre',
  ...rest
}: AccountComboboxProps) {
  const { selectable, pathOf } = useMemo(() => {
    const byCode = new Map(accounts.map((a) => [a.code, a]))
    const paths = new Map<string, string>()
    const pathFor = (code: string): string => {
      const names: string[] = []
      let current = parentCode(code)
      while (current) {
        const parent = byCode.get(current)
        if (parent) names.unshift(parent.name)
        current = parentCode(current)
      }
      return names.join(' › ')
    }
    for (const a of accounts) paths.set(a.id, pathFor(a.code))
    const list = accounts
      .filter((a) => a.postable && (a.active !== false || a.id === value))
      .filter((a) => !extraFilter || extraFilter(a) || a.id === value)
      .slice()
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    return { selectable: list, pathOf: (id: string) => paths.get(id) ?? '' }
  }, [accounts, extraFilter, value])

  const selected = value ? (accounts.find((a) => a.id === value) ?? null) : null

  const filter = (query: string): ComboOption[] => {
    const ranked = rankAndFilter(selectable, query, rankAccount, 200)
    // Sin búsqueda: agrupadas por rubro, en el orden del plan. Buscando: por relevancia.
    return ranked.map((a) => {
      const path = pathOf(a.id)
      return {
        value: a.id,
        code: a.code,
        label: a.name,
        description: query ? path : a.description || null,
        group: query ? null : path || null,
      }
    })
  }

  return (
    <EntityCombobox
      {...rest}
      value={value}
      selectedLabel={
        selected ? (
          <span>
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>{' '}
            {selected.name}
          </span>
        ) : undefined
      }
      filter={filter}
      onSelect={(id) => onValueChange(id, accounts.find((a) => a.id === id) ?? null)}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={(q) => (q ? `No hay cuentas con «${q}».` : 'No hay cuentas para elegir.')}
    />
  )
}
