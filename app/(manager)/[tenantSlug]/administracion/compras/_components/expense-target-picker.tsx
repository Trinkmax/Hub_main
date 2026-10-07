'use client'

import { Search, X } from 'lucide-react'
import { useMemo } from 'react'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { type ComboOption, EntityCombobox } from '@/components/administracion/entity-combobox'
import { rankAccount, rankAndFilter, rankParty } from '@/components/administracion/search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { IvaCondition } from '@/lib/accounting/types'
import { formatCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { isPurchaseImputation, isQuickExpenseAccount } from '../_lib/accounts'
import type { ExpenseTarget } from '../_lib/quick-expense'
import type { QuickSuggestion, SheetAccount, SheetParty } from '../_lib/sheet-types'

const NEW_PARTY_CONDITIONS: ReadonlyArray<{ value: IvaCondition; label: string }> = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
]

/** Proveedores que se pueden elegir al cargar un gasto (los activos que le venden al bar). */
export function payableParties(parties: readonly SheetParty[]): SheetParty[] {
  return parties.filter((p) => p.active && (p.kind === 'supplier' || p.kind === 'other'))
}

export function partyLabel(p: Pick<SheetParty, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? `${p.tradeName} (${p.name})` : p.name
}

/**
 * «¿En qué?» de «Nuevo gasto» (H.5): hasta 6 chips con lo más usado, un
 * buscador agrupado en Proveedores y Gastos con «Crear proveedor «…»», y una
 * vez elegido, la línea «Coca-Cola · Compras: bebidas» con [Cambiar].
 */
export function ExpenseTargetPicker({
  id,
  suggestions,
  parties,
  accounts,
  value,
  onPick,
  onAccountChange,
  onNewPartyChange,
  onClear,
  errors,
  needsTaxId,
}: {
  id: string
  suggestions: readonly QuickSuggestion[]
  parties: readonly SheetParty[]
  accounts: readonly SheetAccount[]
  value: ExpenseTarget | null
  /** Se eligió algo: un chip, un proveedor o una cuenta del buscador, o «Crear proveedor». */
  onPick: (target: ExpenseTarget, suggestion: QuickSuggestion | null) => void
  onAccountChange: (accountId: string | null) => void
  onNewPartyChange: (patch: Partial<Extract<ExpenseTarget, { kind: 'new' }>>) => void
  onClear: () => void
  errors: Readonly<Record<string, string | undefined>>
  /** Con factura, el CUIT del proveedor nuevo es obligatorio. */
  needsTaxId: boolean
}) {
  const suppliers = useMemo(() => payableParties(parties), [parties])
  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties])
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const quickAccounts = useMemo(() => accounts.filter(isQuickExpenseAccount), [accounts])
  const imputable = useMemo(
    () => new Set(accounts.filter(isPurchaseImputation).map((a) => a.id)),
    [accounts],
  )
  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        postable: a.postable && imputable.has(a.id),
        active: a.active,
        description: a.description,
      })),
    [accounts, imputable],
  )

  const filter = (query: string): ComboOption[] => {
    const people = rankAndFilter(suppliers, query, rankParty, query ? 8 : 6).map((p) => ({
      value: `p:${p.id}`,
      label: partyLabel(p),
      description: p.taxId ? `CUIT ${formatCuit(p.taxId)}` : 'Proveedor',
      group: 'Proveedores',
    }))
    const spend = rankAndFilter(quickAccounts, query, rankAccount, query ? 12 : 8).map((a) => ({
      value: `a:${a.id}`,
      label: a.name,
      description: a.description,
      group: 'Gastos',
    }))
    return [...people, ...spend]
  }

  const pick = (encoded: string) => {
    const [kind, entityId] = [encoded.slice(0, 2), encoded.slice(2)]
    if (kind === 'p:') {
      const party = partyById.get(entityId)
      if (!party) return
      const account =
        party.defaultAccountId && imputable.has(party.defaultAccountId)
          ? party.defaultAccountId
          : null
      onPick({ kind: 'party', partyId: party.id, accountId: account }, null)
    } else if (kind === 'a:') {
      onPick({ kind: 'account', accountId: entityId }, null)
    }
  }

  // ── Elegido: la línea con lo que se eligió y [Cambiar] ──
  if (value) {
    const party = value.kind === 'party' ? partyById.get(value.partyId) : undefined
    const account = value.accountId ? accountById.get(value.accountId) : undefined
    const title =
      value.kind === 'party'
        ? party
          ? partyLabel(party)
          : 'Proveedor'
        : value.kind === 'new'
          ? `Proveedor nuevo`
          : (account?.name ?? 'Gasto')

    return (
      <div className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            {value.kind !== 'account' && account ? (
              <p className="truncate text-xs text-muted-foreground">{account.name}</p>
            ) : null}
            {value.kind === 'party' && party?.taxId ? (
              <p className="text-[11px] tabular-nums text-muted-foreground">
                CUIT {formatCuit(party.taxId)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-1 h-11 shrink-0 gap-1.5 text-muted-foreground md:h-8"
            onClick={onClear}
          >
            <X className="size-3.5" aria-hidden />
            Cambiar
          </Button>
        </div>

        {value.kind === 'new' ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-new-name`}>
                Nombre del proveedor
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </Label>
              <Input
                id={`${id}-new-name`}
                value={value.name}
                maxLength={120}
                autoComplete="off"
                aria-invalid={errors['newParty.name'] ? true : undefined}
                onChange={(e) => onNewPartyChange({ name: e.target.value })}
                className="h-11 text-base md:h-10 md:text-sm"
              />
              {errors['newParty.name'] ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors['newParty.name']}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-new-condition`}>Condición frente al IVA</Label>
                <Select
                  value={value.ivaCondition}
                  onValueChange={(next) => onNewPartyChange({ ivaCondition: next as IvaCondition })}
                >
                  <SelectTrigger
                    id={`${id}-new-condition`}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEW_PARTY_CONDITIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="min-h-11 md:min-h-8">
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-new-cuit`}>
                  CUIT
                  {needsTaxId ? (
                    <span aria-hidden="true" className="ml-0.5 text-destructive">
                      *
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                  )}
                </Label>
                <Input
                  id={`${id}-new-cuit`}
                  value={value.taxId}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="30-71876543-5"
                  aria-invalid={errors['newParty.taxId'] ? true : undefined}
                  onChange={(e) => onNewPartyChange({ taxId: e.target.value })}
                  onBlur={(e) => {
                    const digits = e.target.value.replace(/\D/g, '')
                    if (digits.length === 11) onNewPartyChange({ taxId: formatCuit(digits) })
                  }}
                  className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                />
                {errors['newParty.taxId'] ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors['newParty.taxId']}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {value.kind !== 'account' ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-account`}>¿En qué gastaste?</Label>
            <AccountCombobox
              id={`${id}-account`}
              value={value.accountId}
              onValueChange={(next) => onAccountChange(next)}
              accounts={accountOptions}
              placeholder="Elegí en qué (bebidas, limpieza, alquiler…)"
              invalid={Boolean(errors['target.accountId'])}
            />
            {errors['target.accountId'] ? (
              <p role="alert" className="text-xs text-destructive">
                {errors['target.accountId']}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  // ── Sin elegir: chips + buscador ──
  return (
    <div className="space-y-2.5">
      {suggestions.length > 0 ? (
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Lo más usado</legend>
          {suggestions.map((s) => (
            <button
              key={`${s.type}:${s.partyId ?? s.accountId}`}
              type="button"
              onClick={() =>
                onPick(
                  s.type === 'party' && s.partyId
                    ? { kind: 'party', partyId: s.partyId, accountId: s.accountId }
                    : { kind: 'account', accountId: s.accountId },
                  s,
                )
              }
              className={cn(
                'inline-flex h-11 max-w-full items-center rounded-full border px-4 text-sm font-medium transition-colors md:h-9',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'border-border hover:bg-secondary',
              )}
            >
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </fieldset>
      ) : null}
      <EntityCombobox
        id={id}
        value={null}
        filter={filter}
        onSelect={pick}
        onCreate={(name) =>
          onPick(
            {
              kind: 'new',
              name,
              ivaCondition: 'responsable_inscripto',
              taxId: '',
              accountId: null,
            },
            null,
          )
        }
        createLabel={(q) => `Crear proveedor «${q}»`}
        placeholder={
          suggestions.length > 0 ? 'Buscar otro…' : 'Buscar proveedor o en qué gastaste…'
        }
        searchPlaceholder="Coca, alquiler, verdulería…"
        emptyText={(q) =>
          q ? `No hay nada con «${q}». Podés crear el proveedor.` : 'Escribí para buscar.'
        }
        invalid={Boolean(errors.target)}
        aria-describedby={errors.target ? `${id}-error` : undefined}
      />
      {suggestions.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search className="size-3" aria-hidden />
          Lo que más uses va a aparecer acá como atajo.
        </p>
      ) : null}
      {errors.target ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {errors.target}
        </p>
      ) : null}
    </div>
  )
}
