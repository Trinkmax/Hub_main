'use client'

import { useMemo } from 'react'
import { accountPaths, normalizeCodeQuery, treeEntries } from './account-paths'
import { type ComboOption, EntityCombobox } from './entity-combobox'
import { rankAccount, rankAndFilter } from './search'

/** Compatible con `AccountRef` del motor (`ctx.accounts`) y con las filas del plan. */
export type AccountOption = {
  id: string
  /** `1.1.01.01.001` (o `1.1.01.02` en un plan con puntos). */
  code: string
  name: string
  /** Solo las imputables se pueden elegir; los grupos arman la ruta y los encabezados. */
  postable: boolean
  active?: boolean
  /** «Para qué se usa». */
  description?: string | null
  /**
   * El grupo de la cuenta. Conviene pasarlo: una cuenta movida de grupo conserva su código. Sin
   * esto, el grupo se infiere por el código (`1.1.01.01.001` → `1.1.01.01.000`).
   */
  parentId?: string | null
}

export type AccountComboboxProps = {
  id?: string
  name?: string
  value: string | null
  onValueChange: (id: string | null, account: AccountOption | null) => void
  /** El plan entero (grupos + imputables): la ruta sale de los grupos. */
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

/**
 * Cuenta del plan: busca por código («1.1.01» o «110101» encuentran las cuentas de ese grupo) o por
 * nombre; cada opción muestra su ruta («ACTIVO › Activo corriente › Caja y bancos»). Solo se eligen
 * cuentas imputables y activas; los grupos son encabezados, en el orden del árbol.
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
    const entries = treeEntries(accounts)
    const paths = accountPaths(entries)
    const order = new Map(entries.map((e, index) => [e.account.id, index]))
    const list = accounts
      .filter((a) => a.postable && (a.active !== false || a.id === value))
      .filter((a) => !extraFilter || extraFilter(a) || a.id === value)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return { selectable: list, pathOf: (id: string) => paths.get(id) ?? '' }
  }, [accounts, extraFilter, value])

  const selected = value ? (accounts.find((a) => a.id === value) ?? null) : null

  const filter = (query: string): ComboOption[] => {
    const ranked = rankAndFilter(selectable, normalizeCodeQuery(query), rankAccount, 200)
    // Sin búsqueda: agrupadas por grupo, en el orden del plan. Buscando: por relevancia.
    return ranked.map((a) => {
      const path = pathOf(a.id)
      return {
        value: a.id,
        code: a.code,
        label: a.name,
        description: query ? path || null : a.description || null,
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
