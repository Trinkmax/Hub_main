import { ArrowRight, CalendarCheck, Plus } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { RESERVATION_STATUS } from '@/components/reservations/status-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { Section } from '@/components/ui/section'
import { capitalizeFirst, monthName, parseIsoDay, weekdayName } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import type { TodaySalonOverview as Overview } from '@/lib/salon/queries'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

type TodayStatus = keyof Overview['byStatus']

const STATUS_ORDER: TodayStatus[] = ['pending', 'arrived', 'seated', 'closed']

/**
 * El desglose de hoy dice la cuenta con la palabra en plural («3 pendientes»),
 * así que el texto va acá; el tono y lo que significa cada estado salen del
 * mapa compartido de reservas, el mismo de la lista y la vista rápida.
 */
const STATUS_WORDS: Readonly<Record<TodayStatus, { one: string; many: string }>> = {
  pending: { one: 'pendiente', many: 'pendientes' },
  arrived: { one: 'llegó', many: 'llegaron' },
  seated: { one: 'sentada', many: 'sentadas' },
  closed: { one: 'cerrada', many: 'cerradas' },
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

/** `'2026-10-07'` → `'Miércoles 7 de octubre'`, armado a mano (sin `Intl`: kit, riesgo 15). */
function formatDayTitle(iso: string): string {
  const civil = parseIsoDay(iso)
  if (!civil) return iso
  return `${capitalizeFirst(weekdayName(iso))} ${civil.day} de ${monthName(civil.month)}`
}

export function TodaySalonOverview({
  tenantSlug,
  overview,
}: {
  tenantSlug: string
  overview: Overview
}) {
  const { reservationsCount, estimatedGuests, peak, byStatus, byMeal, date } = overview
  const hasReservations = reservationsCount > 0
  const activeMeals = MEAL_ORDER.filter((m) => byMeal[m].count > 0)
  const activeStatuses = STATUS_ORDER.filter((s) => byStatus[s] > 0)
  const mealsLabelId = React.useId()

  return (
    <Section
      title="Hoy en el salón"
      description={formatDayTitle(date)}
      actions={
        // El salón es otro workspace (su propio <html> y su Toaster): se entra
        // recargando, con un <a> común y no con <Link> (kit §7.a.4, riesgo 19).
        <Button asChild variant="secondary" size="sm">
          <a href={`/${tenantSlug}/salon/reservas-operativo?date=${date}`}>
            Ver en el salón
            <ArrowRight aria-hidden="true" />
          </a>
        </Button>
      }
    >
      {hasReservations ? (
        <div className="flex flex-col gap-3">
          <KPIGroup columns={3}>
            <KPI
              label="Reservas"
              value={formatNumber(reservationsCount)}
              status={
                activeStatuses.length > 0 ? (
                  <ul aria-label="Por estado" className="flex flex-wrap gap-1.5">
                    {activeStatuses.map((status) => {
                      const words = STATUS_WORDS[status]
                      const meta = RESERVATION_STATUS[status]
                      return (
                        <li key={status}>
                          <Badge tone={meta.tone} dot title={meta.description}>
                            {plural(byStatus[status], words.one, words.many)}
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                ) : null
              }
            />
            <KPI
              label="Personas estimadas"
              value={formatNumber(estimatedGuests)}
              hint={
                estimatedGuests > 0
                  ? `${formatNumber(estimatedGuests / reservationsCount, 1)} por reserva en promedio`
                  : null
              }
            />
            <KPI
              label="Hora pico estimada"
              value={peak ? `${peak.startHHMM}–${peak.endHHMM}` : '—'}
              hint={
                peak
                  ? `Hasta ${plural(peak.guests, 'persona', 'personas')} a la vez, contando 1 h 30 por reserva`
                  : 'Faltan datos para calcularla'
              }
            />
          </KPIGroup>

          {activeMeals.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span id={mealsLabelId} className="type-small text-muted-foreground">
                Por servicio
              </span>
              <ul aria-labelledby={mealsLabelId} className="flex flex-wrap gap-2">
                {activeMeals.map((m) => (
                  <li key={m}>
                    <Badge size="md">
                      {`${MEAL_TYPE_LABELS[m]} · ${plural(byMeal[m].count, 'reserva', 'reservas')} · ${plural(byMeal[m].guests, 'persona', 'personas')}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <Card padding="none">
          <EmptyState
            size="sm"
            icon={CalendarCheck}
            title="Todavía no hay reservas para hoy"
            description="Cuando se carguen, vas a ver acá cuántas personas esperar y a qué hora se llena el salón."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href={`/${tenantSlug}/reservas/nuevo`}>
                  <Plus aria-hidden="true" />
                  Nueva reserva
                </Link>
              </Button>
            }
          />
        </Card>
      )}
    </Section>
  )
}
