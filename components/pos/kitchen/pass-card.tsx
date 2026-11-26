'use client'

import {
  Check,
  Circle,
  CirclePlus,
  Flame,
  GlassWater,
  Leaf,
  TriangleAlert,
  UsersRound,
  Zap,
} from 'lucide-react'
import { memo } from 'react'
import { AGE_WORD, type AgeLevel, elapsedText, formatElapsed } from '@/lib/pos/kitchen/age'
import {
  CARD_STATUS_LABEL,
  type CardLine,
  type CardStatus,
  type KitchenCard,
  OTHER_STATUS_LABEL,
  PLAIN_VARIANT,
} from '@/lib/pos/kitchen/cards'
import { glassesFor, stationIcon } from '@/lib/pos/kitchen/station-kind'
import type { MenuStation } from '@/lib/pos/types'
import { cn } from '@/lib/utils'

/**
 * Una comanda del muro: lo que una mesa tiene pedido en ESTA estación.
 *
 * Arriba, la franja con el color del estado: el número de mesa (que es lo que se teclea), quién la
 * atiende y el reloj. Después los renglones: cantidad, producto y las aclaraciones pasadas con
 * resaltador. En una estación de bebidas, los vasos de la mesa. Al pie, lo que la mesa espera de las
 * otras estaciones.
 *
 * Con el mouse o con el dedo: un toque la enmarca, dos la avanzan; tocar la cantidad de un renglón lo
 * marca listo a él solo; y se puede arrastrar (entera, o un renglón) a otra estación.
 */

const STATUS_ICON = { queued: Circle, preparing: Flame, ready: Check } as const

/** Cómo se llama una comanda en marcha a la que le agregaron algo. */
export const GREW_LABEL = 'Se sumó'

/** Lo que viaja al arrastrar una comanda (o un renglón) hacia otra estación. */
export const DRAG_TYPE = 'application/x-hub-kds'
export type DragPayload = { station: string; itemIds: string[]; label: string }

/** Cuántos vasos se dibujan de a uno; con más, va el número. */
const GLASS_ICONS = 8

type Props = {
  card: KitchenCard
  station: MenuStation
  /** El número que se teclea para llamarla. */
  code: string
  minutes: number
  level: AgeLevel
  selected: boolean
  /** Acaba de entrar: se destaca un momento. */
  arriving: boolean
  /** Acuse de la última tecla. */
  ack: boolean
  /** Es tan larga que ocupa dos columnas del muro. */
  wide: boolean
  /** Cuánto se achica la letra para que entre en el alto del muro (1 = entera). */
  fit: number
  /** No entra en el muro: se sigue dibujando para medirla, pero no se ve (está en «En cola»). */
  hidden: boolean
  /** Dónde cuelga en el muro y cuánto mide de ancho, en px. `null` en la lista del celular. */
  left: number | null
  top: number | null
  width: number | null
  /** Hay más de una estación en esta pantalla: se puede arrastrar a otra. */
  draggable: boolean
  onSelect: (cardId: string) => void
  onAdvance: (cardId: string) => void
  onLine: (cardId: string, line: CardLine) => void
}

function Marks({
  modifiers,
  notes,
  plain = false,
}: {
  modifiers: readonly string[]
  notes: string | null
  plain?: boolean
}) {
  if (modifiers.length === 0 && !notes) {
    return plain ? <span className="kds-plain">{PLAIN_VARIANT}</span> : null
  }
  return (
    <span className="kds-mods">
      {modifiers.map((modifier, index) => (
        // Dos aclaraciones iguales en un mismo renglón son posibles: la posición desempata.
        // biome-ignore lint/suspicious/noArrayIndexKey: lista fija por renglón, nunca se reordena
        <mark key={`${modifier}:${index}`} className="kds-mod">
          {modifier}
        </mark>
      ))}
      {notes ? <mark className="kds-mod is-note">«{notes}»</mark> : null}
    </span>
  )
}

function dragData(event: React.DragEvent, payload: DragPayload) {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', payload.label)
  event.dataTransfer.effectAllowed = 'move'
}

function PassCardImpl({
  card,
  station,
  code,
  minutes,
  level,
  selected,
  arriving,
  ack,
  wide,
  fit,
  hidden,
  left,
  top,
  width,
  draggable,
  onSelect,
  onAdvance,
  onLine,
}: Props) {
  const critical = card.alerts.filter((alert) => alert.critical)
  const diet = card.alerts.filter((alert) => !alert.critical)
  const Icon = card.grew ? CirclePlus : STATUS_ICON[card.status]
  const clock = formatElapsed(minutes)
  const age = AGE_WORD[level]
  const glasses = glassesFor(station.kind, card.partySize)
  const numeric = card.titleFit !== 'small'
  const label = [
    `Elegir ${card.spoken}`,
    card.grew ? 'se sumó algo sin empezar' : CARD_STATUS_LABEL[card.status].toLowerCase(),
    `hace ${elapsedText(minutes)}`,
    age ? age.toLowerCase() : null,
    code !== card.title ? `código ${code.split('').join(' ')}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const live = card.lines.flatMap((line) => (line.status === 'served' ? [] : line.itemIds))

  return (
    // El toque en cualquier parte de la comanda la enmarca (dos toques la avanzan). Con teclado, el
    // camino es el botón de adentro («Elegir la mesa 12…») y el teclado numérico de la pantalla.
    <li
      className={cn('kds-card', `is-${card.status}`)}
      data-card={card.id}
      data-selected={selected ? 'true' : undefined}
      data-arriving={arriving ? 'true' : undefined}
      data-ack={ack ? 'true' : undefined}
      data-wide={wide ? 'true' : undefined}
      data-grew={card.grew ? 'true' : undefined}
      data-level={level}
      data-hidden={hidden ? 'true' : undefined}
      aria-hidden={hidden ? true : undefined}
      style={{
        ...(fit < 1 ? { ['--fit' as string]: String(fit) } : null),
        ...(width === null ? null : { width }),
        ...(left === null || top === null
          ? null
          : { transform: `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)` }),
      }}
      draggable={draggable && !hidden}
      onDragStart={(event) =>
        dragData(event, { station: station.id, itemIds: live, label: card.spoken })
      }
      onClick={() => onSelect(card.id)}
      onDoubleClick={() => onAdvance(card.id)}
    >
      <header className="kds-card-head">
        <h2 className="kds-card-num" data-fit={card.titleFit}>
          {numeric ? <span className="sr-only">Mesa </span> : null}
          {card.title}
        </h2>
        <p className="kds-card-meta">
          <span className="kds-card-state">
            <Icon aria-hidden strokeWidth={2.8} />
            {card.grew ? GREW_LABEL : CARD_STATUS_LABEL[card.status]}
          </span>
          {card.waiter ? <span className="kds-card-waiter">{card.waiter}</span> : null}
          {card.where ? <span className="kds-card-where">{card.where}</span> : null}
        </p>
        <p className="kds-card-clock" data-level={level}>
          <span className="sr-only">Hace </span>
          <b>{clock.value}</b>
          {clock.unit ? <span aria-hidden>′</span> : null}
          {clock.unit ? <span className="sr-only"> {clock.unit}</span> : null}
        </p>
        {code !== card.title ? (
          <span className="kds-card-code" aria-hidden>
            {code}
          </span>
        ) : null}
      </header>

      {critical.length > 0 ? (
        <p className="kds-card-alert is-critical">
          <TriangleAlert aria-hidden strokeWidth={2.8} />
          <span>{critical.map((alert) => alert.label).join(' · ')}</span>
        </p>
      ) : null}
      {diet.length > 0 ? (
        <p className="kds-card-alert">
          <Leaf aria-hidden strokeWidth={2.8} />
          <span>{diet.map((alert) => alert.label).join(' · ')}</span>
        </p>
      ) : null}

      {/* Lo que no es el pedido pero hay que saber: cuántos son, el nombre, el evento, si es de prueba. */}
      {glasses !== null ||
      card.partySize ||
      card.alias ||
      card.event ||
      card.isPractice ||
      card.course > 1 ? (
        <p className="kds-card-facts">
          {glasses !== null ? (
            <span className="kds-glasses" role="img" aria-label={`${glasses} vasos`}>
              {glasses <= GLASS_ICONS ? (
                Array.from({ length: glasses }, (_, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: vasos iguales, sin identidad
                  <GlassWater key={at} aria-hidden strokeWidth={2.4} />
                ))
              ) : (
                <GlassWater aria-hidden strokeWidth={2.4} />
              )}
              <b aria-hidden>
                {glasses} {glasses === 1 ? 'vaso' : 'vasos'}
              </b>
            </span>
          ) : card.partySize ? (
            <span className="kds-people">
              <UsersRound aria-hidden strokeWidth={2.6} />
              {card.partySize}
              <span className="sr-only"> personas</span>
            </span>
          ) : null}
          {card.alias ? <span className="kds-alias">{card.alias}</span> : null}
          {card.course > 1 ? <span className="kds-tag">Tanda {card.course}</span> : null}
          {card.event ? <span className="kds-tag is-event">{card.event}</span> : null}
          {card.isPractice ? <span className="kds-tag is-practice">Prueba</span> : null}
        </p>
      ) : null}

      <div className="kds-card-body">
        {card.groups.map((group) => (
          <section key={group.key} data-first={group.priority ? 'true' : undefined}>
            {group.label ? (
              <h3 className={cn('kds-group', group.priority && 'is-first')}>
                {group.priority ? <Zap aria-hidden strokeWidth={2.8} /> : null}
                {group.label}
              </h3>
            ) : null}
            <ul className="kds-lines">
              {group.lines.map((line) => (
                <Line
                  key={line.id}
                  line={line}
                  cardStatus={card.status}
                  spoken={card.spoken}
                  station={station.id}
                  draggable={draggable && !hidden}
                  onToggle={() => onLine(card.id, line)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {card.others.length > 0 ? (
        <p className="kds-card-others">
          {card.others.map((other) => (
            <span
              key={other.stationId}
              data-status={other.status}
              title={`${other.name}: ${other.quantity} · ${OTHER_STATUS_LABEL[other.status]}`}
            >
              <i aria-hidden>{stationIcon(other)}</i>
              <span className="sr-only">{other.name}: </span>
              {other.quantity}
              {other.status === 'ready' || other.status === 'served' ? (
                <Check aria-hidden strokeWidth={3.2} />
              ) : other.status === 'preparing' ? (
                <Flame aria-hidden strokeWidth={2.8} />
              ) : null}
              <span className="sr-only"> {OTHER_STATUS_LABEL[other.status]}</span>
            </span>
          ))}
        </p>
      ) : null}

      <button
        type="button"
        className="sr-only"
        tabIndex={hidden ? -1 : 0}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(card.id)
        }}
      >
        {label}
      </button>
    </li>
  )
}

function Line({
  line,
  cardStatus,
  spoken,
  station,
  draggable,
  onToggle,
}: {
  line: CardLine
  cardStatus: CardStatus
  spoken: string
  station: string
  draggable: boolean
  onToggle: () => void
}) {
  // Solo se marca el renglón que va adelantado respecto del resto de la comanda.
  const done = line.status === 'ready' || line.status === 'served'
  const ahead = line.status === 'served' || (line.status === 'ready' && cardStatus !== 'ready')
  const served = line.status === 'served'
  return (
    <li
      className="kds-line"
      data-status={line.status}
      data-ahead={ahead ? 'true' : undefined}
      data-fresh={line.fresh ? 'true' : undefined}
      data-one={line.quantity === 1 ? 'true' : undefined}
      draggable={draggable && !served}
      onDragStart={(event) => {
        event.stopPropagation()
        dragData(event, {
          station,
          itemIds: line.itemIds,
          label: `${line.quantity} ${line.name} de ${spoken}`,
        })
      }}
    >
      <button
        type="button"
        className="kds-qty"
        disabled={served}
        aria-label={
          served
            ? `${line.quantity} ${line.name}: entregado`
            : done
              ? `${line.quantity} ${line.name}: listo. Tocá para volverlo a en preparación.`
              : `${line.quantity} ${line.name}. Tocá para marcarlo listo.`
        }
        aria-pressed={done}
        onClick={(event) => {
          event.stopPropagation()
          // Un doble clic no lo da por listo y lo vuelve atrás (al mozo le llegaban los dos avisos):
          // vale el primer toque.
          if (event.detail > 1) return
          onToggle()
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {ahead ? <Check aria-hidden strokeWidth={3.4} /> : line.quantity}
      </button>
      <div className="kds-what">
        <p className="kds-name">
          {ahead ? <span className="kds-name-qty">{line.quantity} </span> : null}
          {line.name}
          {line.fresh ? (
            <span className="kds-fresh">
              <CirclePlus aria-hidden strokeWidth={3} />
              Nuevo
            </span>
          ) : null}
        </p>
        {line.variants.length > 0 ? (
          // El mismo producto pedido de formas distintas: cada forma con cuántas van así.
          <ul className="kds-variants" aria-label="Cómo va cada uno">
            {line.variants.map((variant, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lista fija por renglón, nunca se reordena
              <li key={at}>
                <b>{variant.quantity}</b>
                <Marks modifiers={variant.modifiers} notes={variant.notes} plain />
              </li>
            ))}
          </ul>
        ) : line.modifiers.length > 0 || line.notes ? (
          <Marks modifiers={line.modifiers} notes={line.notes} />
        ) : null}
      </div>
    </li>
  )
}

export const PassCard = memo(
  PassCardImpl,
  (a, b) =>
    a.card.signature === b.card.signature &&
    a.station === b.station &&
    a.code === b.code &&
    a.minutes === b.minutes &&
    a.level === b.level &&
    a.selected === b.selected &&
    a.arriving === b.arriving &&
    a.ack === b.ack &&
    a.wide === b.wide &&
    a.fit === b.fit &&
    a.hidden === b.hidden &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.draggable === b.draggable &&
    a.onSelect === b.onSelect &&
    a.onAdvance === b.onAdvance &&
    a.onLine === b.onLine,
)
