'use client'

import { Flame } from 'lucide-react'
import { memo } from 'react'
import { AGE_WORD, type AgeLevel, elapsedText } from '@/lib/pos/kitchen/age'
import { CARD_STATUS_LABEL, type KitchenCard } from '@/lib/pos/kitchen/cards'
import { cn } from '@/lib/utils'
import { Clock } from './kitchen-ticket'

/**
 * Los talones de abajo: lo que no está colgado del riel.
 *
 *   · Listos: la comanda terminada, con su sello. Se queda diez minutos para poder deshacer.
 *   · En cola: las que todavía no entran en el riel (o quedaron atrás al recorrerlo). Tocarlas las trae.
 */

type DoneProps = {
  card: KitchenCard
  /** Minutos desde que se marcó lista. */
  minutes: number
  selected: boolean
  ack: boolean
  onSelect: (id: string) => void
}

export const DoneStub = memo(function DoneStub({
  card,
  minutes,
  selected,
  ack,
  onSelect,
}: DoneProps) {
  return (
    <li
      className="kds-stub is-done"
      data-card={card.id}
      data-selected={selected ? 'true' : undefined}
      data-ack={ack ? 'true' : undefined}
    >
      <span className="kds-stub-num" data-fit={card.titleFit}>
        {card.title}
      </span>
      {card.course > 1 ? <span className="kds-course">Tanda {card.course}</span> : null}
      <span className="kds-stamp">Listo</span>
      <span className="kds-stub-time">
        {minutes < 1 ? 'recién' : `hace ${elapsedText(minutes)}`}
      </span>
      <button
        type="button"
        className="kds-hit"
        aria-label={`Elegir ${card.spoken}, lista ${minutes < 1 ? 'recién' : `hace ${elapsedText(minutes)}`}`}
        aria-pressed={selected}
        onClick={() => onSelect(card.id)}
      />
    </li>
  )
})

type QueueProps = {
  card: KitchenCard
  minutes: number
  level: AgeLevel
  arriving: boolean
  onSelect: (id: string) => void
}

export const QueueStub = memo(function QueueStub({
  card,
  minutes,
  level,
  arriving,
  onSelect,
}: QueueProps) {
  const age = AGE_WORD[level]
  return (
    <li
      className={cn('kds-stub is-waiting', `is-${card.status}`)}
      data-card={card.id}
      data-arriving={arriving ? 'true' : undefined}
    >
      <span className="kds-stub-num" data-fit={card.titleFit}>
        {card.title}
      </span>
      {card.course > 1 ? <span className="kds-course">Tanda {card.course}</span> : null}
      {card.status === 'preparing' ? (
        <span className="kds-stub-state">
          <Flame aria-hidden strokeWidth={2.6} />
          En prep.
        </span>
      ) : null}
      <Clock minutes={minutes} level={level} />
      <button
        type="button"
        className="kds-hit"
        aria-label={`Traer al riel ${card.spoken}, ${CARD_STATUS_LABEL[card.status].toLowerCase()}, hace ${elapsedText(minutes)}${age ? `, ${age.toLowerCase()}` : ''}`}
        onClick={() => onSelect(card.id)}
      />
    </li>
  )
})
