'use client'

import { Check, TriangleAlert } from 'lucide-react'
import { ageLevel, elapsedMinutes, elapsedText } from '@/lib/pos/kitchen/age'
import { CARD_STATUS_LABEL, type CardStatus, type EventGroup } from '@/lib/pos/kitchen/cards'
import type { KitchenQueue } from '@/lib/pos/types'
import { cn } from '@/lib/utils'

/**
 * El lado del evento: cuánto falta de cada plato entre todas sus mesas, escrito en el tablero.
 *
 * En un evento se cocina por plato, no por mesa. Las mesas quedan abajo en fichas chicas: «Siguiente»
 * también pasa por ellas, y la que queda enmarcada se abre como una comanda entera en el primer lugar
 * del riel (ver `kitchen-screen.tsx`), por si la cocina quiere ir marcándolas una por una.
 */

const SHORT_STATE: Record<CardStatus, string> = {
  queued: 'Nuevo',
  preparing: 'En prep.',
  ready: 'Listo',
}

type Props = {
  events: EventGroup[]
  selectedId: string | null
  ackId: string | null
  arriving: ReadonlySet<string>
  now: number
  settings: KitchenQueue['settings']
  onSelect: (id: string) => void
}

export function KitchenEvent({
  events,
  selectedId,
  ackId,
  arriving,
  now,
  settings,
  onSelect,
}: Props) {
  return (
    <aside className="kds-event" aria-label="Evento">
      {events.map((event) => {
        const pending = event.total - event.done
        const tables = event.cards.length
        return (
          <section key={event.name} className="kds-event-block">
            <header className="kds-event-head">
              <h2 className="kds-event-title">{event.name}</h2>
              <p className="kds-event-sub">
                {tables} {tables === 1 ? 'mesa' : 'mesas'} ·{' '}
                {pending > 0 ? `faltan ${pending} de ${event.total}` : `listo todo: ${event.total}`}
              </p>
            </header>

            <table className="kds-dishes">
              <thead>
                <tr>
                  <th scope="col">Faltan</th>
                  <th scope="col">Plato</th>
                  <th scope="col">Listos</th>
                </tr>
              </thead>
              <tbody>
                {event.dishes.map((dish) => (
                  <tr key={dish.menuItemId} data-done={dish.pending === 0 ? 'true' : undefined}>
                    <td className="kds-dish-left">
                      {dish.pending > 0 ? (
                        dish.pending
                      ) : (
                        <>
                          <Check aria-hidden strokeWidth={3} />
                          <span className="sr-only">Nada</span>
                        </>
                      )}
                    </td>
                    <th scope="row" className="kds-dish-name">
                      {dish.name}
                    </th>
                    <td className="kds-dish-done">
                      {dish.done} de {dish.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="kds-chips" aria-label={`Mesas de ${event.name}`}>
              {event.cards.map((card) => {
                const minutes = elapsedMinutes(card.firedMs, now)
                const level = card.status === 'ready' ? 'ok' : ageLevel(minutes, settings)
                const hasAlert = card.alerts.some((alert) => alert.critical)
                return (
                  <li
                    key={card.id}
                    className={cn('kds-chip', `is-${card.status}`)}
                    data-card={card.id}
                    data-selected={card.id === selectedId ? 'true' : undefined}
                    data-ack={card.id === ackId ? 'true' : undefined}
                    data-arriving={arriving.has(card.id) ? 'true' : undefined}
                    data-level={level}
                  >
                    <span className="kds-chip-num" data-fit={card.titleFit}>
                      {card.title}
                    </span>
                    <span className="kds-chip-state">
                      {hasAlert ? <TriangleAlert aria-hidden strokeWidth={2.8} /> : null}
                      {SHORT_STATE[card.status]}
                    </span>
                    <button
                      type="button"
                      className="kds-hit"
                      aria-label={`Elegir ${card.spoken}, ${CARD_STATUS_LABEL[card.status].toLowerCase()}, hace ${elapsedText(minutes)}${hasAlert ? ', con aviso de salud' : ''}`}
                      aria-pressed={card.id === selectedId}
                      onClick={() => onSelect(card.id)}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
