'use client'

import { Cog, Landmark, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isContraAccount } from '@/lib/accounting/chart'
import type { AccountType } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { describedBy, Field } from '../../ajustes/_components/form-bits'
import { INPUT_CLASS } from '../../ajustes/_components/inputs'
import { systemUse } from '../_lib/system-uses'
import { ACCOUNT_TYPE_NAMES, type ChartAccount, type TypeChoice } from '../_lib/tree'

const BADGE_CLASS = 'max-w-full whitespace-normal text-left font-normal'

/**
 * Las insignias de una cuenta (H.16): la usa el sistema (y para qué), de control (lleva proveedor o
 * cliente), de una caja, en compras («¿En qué?»), inactiva.
 */
export function AccountBadges({ account }: { account: ChartAccount }) {
  const use = systemUse(account.systemKey)
  return (
    <>
      {account.systemKey ? (
        <Badge variant="outline" className={BADGE_CLASS}>
          <Cog aria-hidden="true" />
          {use ? `Usada por el sistema: ${use.label}` : 'Usada por el sistema'}
        </Badge>
      ) : null}
      {account.requiresParty ? (
        <Badge variant="outline" className={BADGE_CLASS}>
          <Users aria-hidden="true" />
          De control
        </Badge>
      ) : null}
      {account.isTreasury ? (
        <Badge variant="outline" className={BADGE_CLASS}>
          <Landmark aria-hidden="true" />
          Caja o banco
        </Badge>
      ) : null}
      {account.purchaseSelectable && account.postable ? (
        <Badge variant="outline" className={BADGE_CLASS}>
          En compras
        </Badge>
      ) : null}
      {account.active ? null : <Badge variant="muted">Inactiva</Badge>}
    </>
  )
}

/** «Activo · imputable · regularizadora». */
export function accountKindText(account: ChartAccount): string {
  return [
    ACCOUNT_TYPE_NAMES[account.type],
    account.postable ? 'imputable' : 'grupo',
    isContraAccount(account) ? 'regularizadora' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * El tipo de la cuenta: un selector si se puede elegir (cuenta principal, o ingreso/egreso adentro
 * de un grupo de resultados) o el tipo fijo con el porqué.
 */
export function TypeField({
  id,
  choice,
  value,
  onChange,
  error,
}: {
  id: string
  choice: TypeChoice
  value: AccountType | null
  onChange: (type: AccountType) => void
  error?: string | null
}) {
  if (choice.kind === 'fixed') {
    return (
      <Field id={id} label="Tipo" hint={choice.reason}>
        <Input
          id={id}
          readOnly
          value={ACCOUNT_TYPE_NAMES[choice.type]}
          aria-describedby={describedBy(id, choice.reason, null)}
          className={cn(INPUT_CLASS, 'bg-secondary/30 text-muted-foreground')}
        />
      </Field>
    )
  }
  return (
    <Field
      id={id}
      label="Tipo"
      required
      error={error}
      hint={
        choice.options.length === 2
          ? 'Adentro de un grupo de resultados puede ser ingreso o egreso.'
          : undefined
      }
    >
      <Select value={value ?? ''} onValueChange={(v) => onChange(v as AccountType)}>
        <SelectTrigger
          id={id}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, choice.options.length === 2, error)}
        >
          <SelectValue placeholder="Elegí el tipo" />
        </SelectTrigger>
        <SelectContent>
          {choice.options.map((t) => (
            <SelectItem key={t} value={t}>
              {ACCOUNT_TYPE_NAMES[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
