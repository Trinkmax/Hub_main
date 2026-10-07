import { Banknote, CreditCard, Landmark, type LucideIcon, PiggyBank, Wallet } from 'lucide-react'
import type { TreasuryKind } from '@/lib/accounting/types'
import { daysBetween, formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Amount } from '../amount'

/**
 * Cómo se muestra una caja o cuenta en Cajas y bancos (H.11). Server-safe.
 * Los saldos llegan como en los reportes: Debe − Haber (en la tarjeta de la
 * empresa, negativo = deuda).
 */

export const TREASURY_ICONS: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CreditCard,
  other: PiggyBank,
}

/** Cuántos días sin «Ajustar saldo» hacen que una caja pida que la cuenten. */
export const CHECK_STALE_DAYS = 7

export function TreasuryIcon({ kind, className }: { kind: TreasuryKind; className?: string }) {
  const Icon = TREASURY_ICONS[kind]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary',
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}

/** La deuda de la tarjeta de la empresa en palabras: «Deuda $ X» · «A favor $ X» · «Sin deuda». */
export function cardBalanceText(balanceCents: number): string {
  if (balanceCents < 0) return `Deuda ${formatCents(-balanceCents)}`
  if (balanceCents > 0) return `A favor ${formatCents(balanceCents)}`
  return 'Sin deuda'
}

/** El saldo de una caja (Debe − Haber): plata disponible, descubierto en rojo, o la deuda de la tarjeta. */
export function TreasuryBalance({
  kind,
  balanceCents,
  decimals = 2,
  className,
}: {
  kind: TreasuryKind
  balanceCents: number
  decimals?: 0 | 2
  className?: string
}) {
  if (kind === 'credit_card') {
    const debt = balanceCents < 0
    return (
      <span className={cn('tabular-nums whitespace-nowrap', className)}>
        <span className="text-muted-foreground">
          {debt ? 'Deuda' : balanceCents > 0 ? 'A favor' : 'Sin deuda'}
        </span>
        {balanceCents !== 0 ? (
          <span className="font-medium"> {formatCents(Math.abs(balanceCents), { decimals })}</span>
        ) : null}
      </span>
    )
  }
  return (
    <Amount
      cents={balanceCents}
      balance="treasury"
      tone="auto"
      decimals={decimals}
      className={className}
    />
  )
}

/** «Ajustada hoy» · «Ajustada el 28/09/2026» · «Nunca se ajustó»; aviso si pasó más de una semana. */
export function CheckedStatus({
  lastCheckedOn,
  today,
  className,
}: {
  lastCheckedOn: string | null
  today: string
  className?: string
}) {
  const stale = lastCheckedOn === null || daysBetween(lastCheckedOn, today) > CHECK_STALE_DAYS
  const text =
    lastCheckedOn === null
      ? 'Nunca se ajustó'
      : lastCheckedOn === today
        ? 'Ajustada hoy'
        : `Ajustada el ${formatIsoDay(lastCheckedOn)}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums',
        stale ? 'text-warning-text' : 'text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', stale ? 'bg-warning' : 'bg-success')}
      />
      {text}
    </span>
  )
}
