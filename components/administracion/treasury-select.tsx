'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { balanceText } from './format'

/** Compatible con `TreasuryRef` del motor (`ctx.treasuries`). */
export type TreasuryOption = {
  id: string
  name: string
  kind: 'cash' | 'bank' | 'wallet' | 'credit_card' | 'other'
  /**
   * Saldo de libro en el sentido normal de su cuenta: plata disponible en
   * cajas, bancos y billeteras; la deuda en una tarjeta de la empresa.
   */
  balanceCents: number
  active?: boolean
}

export type TreasurySelectProps = {
  id?: string
  /** Hidden con el id elegido (lo agrega el Select de Radix). */
  name?: string
  value: string | null
  onValueChange: (id: string, treasury: TreasuryOption) => void
  treasuries: readonly TreasuryOption[]
  /** Para sacar la caja de origen en «Mover plata». */
  exclude?: readonly string[]
  /** Sin tarjetas de la empresa (cobros: la plata no entra a una tarjeta). */
  excludeCards?: boolean
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-labelledby'?: string
  'aria-label'?: string
  className?: string
}

/** «$ 245.300,00» · «Descubierto $ 12.000,00» · tarjeta: «Deuda $ 80.000,00». */
export function treasuryBalanceText(t: Pick<TreasuryOption, 'kind' | 'balanceCents'>): string {
  if (t.kind === 'credit_card') {
    return t.balanceCents > 0
      ? `Deuda ${balanceText(t.balanceCents, 'treasury')}`
      : balanceText(-t.balanceCents, 'treasury')
  }
  return balanceText(t.balanceCents, 'treasury')
}

/** Con qué caja o cuenta: el `Select` del panel, con el saldo de cada una a la derecha. */
export function TreasurySelect({
  id,
  name,
  value,
  onValueChange,
  treasuries,
  exclude = [],
  excludeCards = false,
  placeholder = 'Elegí una caja o cuenta',
  disabled,
  invalid,
  className,
  ...aria
}: TreasurySelectProps) {
  const options = treasuries.filter(
    (t) =>
      (t.active !== false || t.id === value) &&
      !exclude.includes(t.id) &&
      !(excludeCards && t.kind === 'credit_card'),
  )
  return (
    <Select
      name={name}
      value={value ?? ''}
      disabled={disabled}
      onValueChange={(next) => {
        const t = treasuries.find((x) => x.id === next)
        if (t) onValueChange(next, t)
      }}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={aria['aria-describedby']}
        aria-labelledby={aria['aria-labelledby']}
        aria-label={aria['aria-label']}
        className={cn(
          // `min-w-0`: el nombre y el saldo no empujan el ancho de la grilla. `@container`: si la
          // cuenta queda angosta se va el saldo (sigue en la lista), nunca el nombre.
          '@container h-11 w-full min-w-0 text-base md:h-10 md:text-sm data-[size=default]:h-11 md:data-[size=default]:h-10 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No hay cajas ni cuentas activas.
          </div>
        ) : (
          options.map((t) => (
            <SelectItem key={t.id} value={t.id} className="min-h-11 md:min-h-8">
              <span className="flex w-full min-w-0 items-center justify-between gap-4">
                <span className="truncate">{t.name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums text-muted-foreground @max-[15.5rem]:hidden',
                    t.kind !== 'credit_card' && t.balanceCents < 0 && 'text-destructive',
                  )}
                >
                  {treasuryBalanceText(t)}
                </span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
