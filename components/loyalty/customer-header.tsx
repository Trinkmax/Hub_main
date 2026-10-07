import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import type { CustomerByQr } from '@/lib/customers/queries'
import { formatNumber } from '@/lib/format/number-kind'
import { formatPhoneForDisplay } from '@/lib/phone'
import { TierBadge } from './tier-badge'

/** Lo que hace falta del socio: sirve el del QR (`CustomerByQr`) y el de una reserva. */
export type MemberSummary = Pick<
  CustomerByQr,
  'first_name' | 'last_name' | 'phone' | 'points_balance' | 'tier'
>

/**
 * Quién es el socio, en qué nivel está y cuánto tiene. Es la misma ficha en
 * Acreditar (recién escaneado) y en la reserva del operativo, para que el que
 * cobra y el que recibe lean lo mismo.
 *
 * - `framed` (default): en su propia tarjeta. Sin marco cuando ya vive adentro
 *   de otra superficie (el panel de la reserva): una tarjeta nunca va adentro
 *   de otra.
 * - El saldo va en Fraunces (`type-kpi`): es el saldo de la ficha. El nombre,
 *   en Inter, como todo título de bloque.
 */
export function CustomerHeader({
  customer,
  framed = true,
  className,
}: {
  customer: MemberSummary
  framed?: boolean
  className?: string
}) {
  const initials = `${customer.first_name.charAt(0)}${customer.last_name.charAt(0)}`.toUpperCase()

  const body = (
    <div className="flex items-center gap-3">
      <Avatar size="md" aria-hidden="true">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate type-subtitle">
          {customer.first_name} {customer.last_name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {customer.tier ? <TierBadge tier={customer.tier} /> : null}
          <span className="type-caption type-amount text-muted-foreground">
            {formatPhoneForDisplay(customer.phone)}
          </span>
        </div>
      </div>
      <dl className="shrink-0 text-right">
        <dt className="type-label text-muted-foreground">Puntos</dt>
        <dd className="type-kpi">{formatNumber(customer.points_balance)}</dd>
      </dl>
    </div>
  )

  if (!framed) return <div className={className}>{body}</div>
  return <Card className={className}>{body}</Card>
}
