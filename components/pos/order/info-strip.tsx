import {
  Baby,
  Banknote,
  Cake,
  CakeSlice,
  CalendarClock,
  Receipt,
  Star,
  Ticket,
  TriangleAlert,
  Wine,
} from 'lucide-react'
import { formatCentsShort } from '@/lib/money/format'
import { formatMinutes } from '@/lib/pos/table-state'
import type { SessionDetail } from '@/lib/pos/types'
import type { LiveStatus } from '@/lib/pos/use-poke'
import { resolveReservationAlerts, SERVICE_ALERT_META } from '@/lib/salon/alerts'
import { cn } from '@/lib/utils'

/**
 * Lo que el sistema ya sabe de la mesa, sin que nadie lo escriba: hace cuánto está abierta, la seña,
 * el cumpleaños, el evento, si es socio del club y los avisos de servicio (celíaco, alergia…).
 *
 * Va en chico, sobre el paño, como lo primero de la comanda. Los avisos son otra cosa: quedan
 * pegados arriba mientras se recorre, porque pasarlos por alto le hace mal a alguien.
 */

const LIVE_WORD: Record<LiveStatus, string> = {
  live: 'en vivo',
  connecting: 'conectando',
  offline: 'sin conexión',
}

export function serviceAlertsOf(detail: SessionDetail) {
  return resolveReservationAlerts(detail.reservation?.alerts, detail.customer?.alerts)
}

export function ServiceAlerts({ detail }: { detail: SessionDetail }) {
  const alerts = serviceAlertsOf(detail)
  if (alerts.length === 0) return null
  return (
    <ul className="cmd-alerts" aria-label="Avisos de servicio" data-testid="order-alerts">
      {alerts.map(({ alert }) => {
        const meta = SERVICE_ALERT_META[alert]
        const Icon = alert === 'baby_seat' ? Baby : TriangleAlert
        return (
          <li
            key={alert}
            className={cn('cmd-alert', meta.severity === 'critical' ? 'is-critical' : 'is-info')}
          >
            <Icon aria-hidden strokeWidth={2.6} />
            {meta.label}
          </li>
        )
      })}
    </ul>
  )
}

export function InfoStrip({
  detail,
  live,
  elapsed,
  billMinutes,
}: {
  detail: SessionDetail
  live: LiveStatus
  /** Minutos desde que se abrió la mesa. */
  elapsed: number | null
  /** Minutos desde que pidieron la cuenta. */
  billMinutes: number | null
}) {
  const { session, table, reservation, customer } = detail
  const note = [reservation?.comments, session.note].filter(Boolean).join(' · ')
  const billed = session.bill_requested_at !== null

  return (
    <div className="cmd-strip" data-testid="order-strip">
      <p className="cmd-strip-meta">
        {table?.area ? <span>{table.area}</span> : null}
        {table?.area && elapsed !== null ? <span aria-hidden>·</span> : null}
        {elapsed !== null ? (
          <span>
            abierta hace <b>{formatMinutes(elapsed)}</b>
          </span>
        ) : null}
        <span aria-hidden>·</span>
        <span
          className={cn('cmd-live', live === 'live' && 'is-live', live === 'offline' && 'is-off')}
          role="status"
        >
          <i aria-hidden />
          {LIVE_WORD[live]}
        </span>
      </p>

      {billed || customer || reservation ? (
        <ul className="cmd-tags">
          {billed ? (
            <li className="cmd-tag is-bill">
              <Receipt aria-hidden strokeWidth={2.4} />
              Pidió la cuenta
              {billMinutes !== null && billMinutes > 0 ? ` · ${formatMinutes(billMinutes)}` : ''}
            </li>
          ) : null}
          {customer ? (
            <li
              className="cmd-tag"
              style={
                customer.tier_color ? { ['--tier' as string]: customer.tier_color } : undefined
              }
            >
              <Star aria-hidden strokeWidth={2.4} />
              {customer.first_name} {customer.last_name}
              {customer.tier ? (
                <>
                  <i aria-hidden />
                  {customer.tier}
                </>
              ) : (
                ' · socio del club'
              )}
            </li>
          ) : null}
          {reservation ? (
            <li className="cmd-tag">
              <CalendarClock aria-hidden strokeWidth={2.4} />
              Reserva {reservation.time} · {reservation.name}
            </li>
          ) : null}
          {reservation?.kind === 'birthday' ? (
            <li className="cmd-tag">
              <Cake aria-hidden strokeWidth={2.4} />
              Cumpleaños
            </li>
          ) : null}
          {reservation?.event ? (
            <li className="cmd-tag">
              <Ticket aria-hidden strokeWidth={2.4} />
              {reservation.event}
            </li>
          ) : null}
          {reservation && reservation.deposit_cents > 0 ? (
            <li className="cmd-tag">
              <Banknote aria-hidden strokeWidth={2.4} />
              Seña {formatCentsShort(reservation.deposit_cents)}
            </li>
          ) : null}
          {reservation && reservation.cake_count > 0 ? (
            <li className="cmd-tag">
              <CakeSlice aria-hidden strokeWidth={2.4} />
              {reservation.cake_count === 1 ? '1 torta' : `${reservation.cake_count} tortas`}
            </li>
          ) : null}
          {reservation && reservation.champagne_count > 0 ? (
            <li className="cmd-tag">
              <Wine aria-hidden strokeWidth={2.4} />
              {reservation.champagne_count === 1
                ? '1 champagne'
                : `${reservation.champagne_count} champagnes`}
            </li>
          ) : null}
        </ul>
      ) : null}

      {note ? (
        <p className="cmd-strip-note">
          <b>Nota:</b> {note}
        </p>
      ) : null}
    </div>
  )
}
