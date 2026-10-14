import {
  CHECK_STALE_DAYS,
  countStatus,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { WALLET_ICONS } from '@/components/administracion/kit/wallet-card'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Amount } from '../amount'

/**
 * Cómo se muestra una caja o cuenta en Cajas y bancos (H.11). Server-safe.
 * Los saldos llegan como en los reportes: Debe − Haber (en la tarjeta de la
 * empresa, negativo = deuda).
 */

/**
 * `TREASURY_ICONS`: el ícono de cada tipo de caja. Es el mismo mapa que usa la
 * tarjeta de una caja (`WALLET_ICONS` del kit), para que una caja lleve el mismo
 * dibujo donde aparezca. `CHECK_STALE_DAYS`: cuántos días sin contar hacen que
 * una caja pida que la cuenten.
 */
export { CHECK_STALE_DAYS, WALLET_ICONS as TREASURY_ICONS }

export function TreasuryIcon({ kind, className }: { kind: TreasuryKind; className?: string }) {
  const Icon = WALLET_ICONS[kind]
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

/**
 * El estado del conteo de una caja, en una píldora: «Contada hace 3 días» ·
 * «Todavía no la contaste» · «La contaste por última vez el 28/09». La regla
 * (cuándo va en ámbar) es `countStatus()`: la misma en la billetera, en la
 * ficha y en la tabla. `since` es el día en que arrancan los libros.
 */
export function CheckedStatus({
  lastCheckedOn,
  today,
  hasMovements,
  since,
  className,
}: {
  lastCheckedOn: string | null
  today: string
  /** La caja tuvo algún movimiento (sin movimientos no hay nada que controlar). */
  hasMovements: boolean
  since: string | null
  className?: string
}) {
  const status = countStatus({ lastCheckedOn, today, hasMovements, since })
  return (
    <StatusPill tone={status.tone} className={className}>
      {status.text}
    </StatusPill>
  )
}
