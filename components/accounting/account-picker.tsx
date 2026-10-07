'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Combobox,
  type ComboboxProps,
  type ComboboxValue,
  type EntityOption,
} from '@/components/ui/combobox'
import { cn } from '@/lib/utils'
import {
  type AccountNode,
  type AccountOption,
  type AccountTreeEntry,
  accountLabel,
  accountOptions,
  accountPath,
  flattenAccountTree,
  suggestParentAccount,
} from './account-tree'

export type { AccountNode } from './account-tree'

/** Lo que recibe `onCreate`: el rubro sugerido para la cuenta nueva (o `null`). */
export type AccountCreateContext = { parent: AccountNode | null }

/** La cuenta creada (queda elegida) o nada, si la hoja la elige después. */
// biome-ignore lint/suspicious/noConfusingVoidType: el callback puede no devolver nada (la hoja «Nueva cuenta» elige después)
export type AccountCreateResult = Promise<AccountNode | void> | AccountNode | void

export type AccountPickerProps = Omit<
  ComboboxProps<AccountNode>,
  | 'options'
  | 'search'
  | 'multiple'
  | 'onCreate'
  | 'createLabel'
  | 'renderOption'
  | 'defaultOptions'
  | 'selectedOption'
  | 'minQueryLength'
  | 'debounceMs'
> & {
  /** Lista plana (el árbol se arma adentro, memoizado). Unas 150 cuentas: sin virtualizar. */
  accounts: readonly AccountNode[]
  /** Para acotar: solo egresos, solo las que aparecen en compras, solo las de asientos manuales. */
  filter?: (account: AccountNode) => boolean
  /** Las inactivas no aparecen salvo con esto; entonces llevan la etiqueta «Inactiva». */
  includeInactive?: boolean
  /**
   * Default `true`: solo las imputables son opciones y los rubros son
   * encabezados. `false` deja elegir también un rubro (el mayor de un grupo
   * suma sus hojas).
   */
  postableOnly?: boolean
  /** Default `true`: cada opción suma su camino de rubros para el lector de pantalla. */
  showPath?: boolean
  /** Default `true`: «Para qué se usa» debajo del nombre (y entero en la resaltada). */
  showDescription?: boolean
  /**
   * «Nueva cuenta «…»» (solo el dueño: al rol Contabilidad no se le pasa).
   * Abre la hoja «Nueva cuenta» con el rubro ya elegido (`context.parent`, si
   * lo buscado era un código); si devuelve la cuenta creada, queda elegida.
   */
  onCreate?: (query: string, context: AccountCreateContext) => AccountCreateResult
  /** La cuenta elegida (o `null`), además del `onValueChange` del Combobox. */
  onAccountChange?: (account: AccountNode | null) => void
}

/** El valor como lista de ids (para dejar siempre la cuenta elegida entre las opciones). */
function idsOf(value: ComboboxValue | undefined): string[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : value === '' ? [] : [value]
}

function toOption(account: AccountNode): AccountOption {
  return {
    value: account.id,
    label: accountLabel(account),
    description: account.description?.trim() || undefined,
    data: account,
  }
}

/**
 * El selector del plan de cuentas (kit §3.8), sobre el `Combobox` del kit: el
 * mismo teclado (una letra abre con esa letra, ↑ ↓ Inicio Fin RePág AvPág,
 * Enter elige, Esc y Tab cierran y vuelven al disparador), el mismo `name`
 * oculto con el id y la misma validación de `required`.
 *
 * - **Búsqueda.** Por código con puntos (`1.1` trae ese subárbol primero),
 *   por código sin puntos (`1101` encuentra las de `1.1.01`), por nombre
 *   («contiene», sin tildes) y por «Para qué se usa».
 * - **Lista.** Los rubros (no imputables) son encabezados `role="presentation"`:
 *   las flechas los saltean y el lector no los anuncia. Cada opción lleva el
 *   código en una columna fija y su camino de rubros para el lector, así el
 *   contexto no se pierde aunque el encabezado no se anuncie.
 * - **La elegida** se ve «1.1.01 · Caja».
 * - **Inactivas** solo con `includeInactive` (con la etiqueta «Inactiva»); la
 *   que ya estaba elegida se muestra igual, para no perder su nombre.
 *
 * ```tsx
 * <Field label="Cuenta" name="account_id">
 *   <AccountPicker accounts={accounts} filter={(a) => a.type === 'expense'} />
 * </Field>
 * ```
 */
function AccountPicker({
  accounts,
  filter,
  includeInactive = false,
  postableOnly = true,
  showPath = true,
  showDescription = true,
  onCreate,
  onAccountChange,
  onValueChange,
  value,
  defaultValue,
  placeholder = 'Elegí una cuenta…',
  searchPlaceholder = 'Buscar por código o nombre…',
  emptyText,
  ...props
}: AccountPickerProps) {
  const entries = React.useMemo(() => flattenAccountTree(accounts), [accounts])
  const entryById = React.useMemo(() => {
    const map = new Map<string, AccountTreeEntry>()
    for (const entry of entries) map.set(entry.account.id, entry)
    return map
  }, [entries])

  // La que ya está elegida va siempre (aunque esté inactiva o el filtro la saque).
  const keepKey = [...idsOf(value), ...idsOf(defaultValue)].join('|')
  const options = React.useMemo(
    () =>
      accountOptions(accounts, {
        postableOnly,
        includeInactive,
        filter,
        keep: keepKey === '' ? [] : keepKey.split('|'),
      }),
    [accounts, postableOnly, includeInactive, filter, keepKey],
  )

  const renderOption = (option: EntityOption<AccountNode>) => {
    const account = option.data
    if (!account) return option.label
    const entry = entryById.get(account.id)
    const path = entry && showPath ? accountPath(entry) : ''
    const description = showDescription ? account.description?.trim() : undefined
    // El nombre de la opción para el lector sale de este texto: «1.1.01.01 Caja,
    // ACTIVO › Activo corriente › Caja y bancos, Efectivo del local». Los
    // espacios y comas en `sr-only` (o como texto entre los flex) no se ven.
    return (
      <span data-slot="account-option" className="flex min-w-0 items-start gap-2 ps-3">
        <span
          data-slot="account-option-code"
          className="min-w-20 shrink-0 type-amount text-subtle-foreground"
        >
          {account.code}
        </span>{' '}
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn('truncate', !account.postable && 'font-medium')}
              data-slot="account-option-name"
            >
              {account.name}
            </span>{' '}
            {!account.active ? (
              <Badge tone="neutral" className="shrink-0">
                Inactiva
              </Badge>
            ) : null}
          </span>
          {path ? <span className="sr-only">{`, ${path}`}</span> : null}
          {description ? (
            <span
              data-slot="account-option-description"
              // Una línea; entera en la resaltada (se mueve con el teclado: sin transición).
              className="truncate type-caption text-subtle-foreground in-data-active:whitespace-normal"
            >
              <span className="sr-only">, </span>
              {description}
            </span>
          ) : null}
        </span>
      </span>
    )
  }

  const handleCreate = onCreate
    ? async (query: string) => {
        const created = await onCreate(query, { parent: suggestParentAccount(accounts, query) })
        return created ? toOption(created) : undefined
      }
    : undefined

  return (
    <Combobox<AccountNode>
      data-slot="account-picker"
      {...props}
      value={value}
      defaultValue={defaultValue}
      options={options}
      renderOption={renderOption}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      onCreate={handleCreate}
      createLabel={(query) => `Nueva cuenta «${query}»`}
      onValueChange={(next, option) => {
        onValueChange?.(next, option)
        if (onAccountChange) {
          const chosen = Array.isArray(option) ? (option[0] ?? null) : option
          onAccountChange(chosen?.data ?? null)
        }
      }}
    />
  )
}

export { AccountPicker }
