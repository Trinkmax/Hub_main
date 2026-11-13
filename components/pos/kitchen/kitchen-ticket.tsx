'use client'

import {
  ArrowRight,
  Check,
  Circle,
  Flame,
  Leaf,
  TriangleAlert,
  Undo2,
  UsersRound,
} from 'lucide-react'
import { memo, useLayoutEffect, useRef } from 'react'
import { AGE_WORD, type AgeLevel, elapsedText, formatElapsed } from '@/lib/pos/kitchen/age'
import { HOLD_HINT_MS, HOLD_MS, holdProgress } from '@/lib/pos/kitchen/buttons'
import {
  advanceTarget,
  CARD_STATUS_LABEL,
  type CardLine,
  type CardStatus,
  type KitchenCard,
  OTHER_STATUS_LABEL,
  undoTarget,
} from '@/lib/pos/kitchen/cards'
import { MIN_TICKET_SCALE, nextTicketScale } from '@/lib/pos/kitchen/layout'
import { cn } from '@/lib/utils'

/**
 * Una comanda colgada del riel: una tanda de una mesa.
 *
 * Arriba, la franja del estado (color + ícono + palabra). Después el número de mesa enorme, el reloj
 * desde que salió a cocina, y los renglones: cantidad grande, producto, y las aclaraciones marcadas con
 * resaltador para que no se pasen. Al pie, en chico, lo que la mesa espera de otras estaciones.
 */

const STATUS_ICON = { queued: Circle, preparing: Flame, ready: Check } as const

export function StateWord({ status }: { status: CardStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <>
      <Icon aria-hidden strokeWidth={2.6} />
      {CARD_STATUS_LABEL[status]}
    </>
  )
}

/**
 * El relleno de «mantener» aparece cuando la pulsación ya lleva un rato (un toque normal no lo ve) y
 * termina justo cuando deshace: arranca en lo que ya pasó y dura lo que falta.
 */
export const HOLD_STYLE = {
  ['--hold-from' as string]: holdProgress(HOLD_HINT_MS).toFixed(3),
  ['--hold-ms' as string]: `${HOLD_MS - HOLD_HINT_MS}ms`,
} as React.CSSProperties

/** El pie del marco: qué hace «Avanzar» sobre lo que está enmarcado, y el progreso al mantenerlo. */
export function FrameHint({ status, holding }: { status: CardStatus; holding: boolean }) {
  const forward = advanceTarget(status)
  const back = undoTarget(status)
  if (holding) {
    return (
      <p
        className="kds-hint"
        data-holding={back ? 'true' : undefined}
        style={HOLD_STYLE}
        aria-hidden
      >
        <span className="kds-hint-main">
          {back ? (
            <>
              Deshacer <ArrowRight aria-hidden strokeWidth={3} /> {CARD_STATUS_LABEL[back]}
            </>
          ) : (
            'Nada para deshacer'
          )}
        </span>
      </p>
    )
  }
  return (
    <p className="kds-hint" aria-hidden>
      <span className="kds-hint-main">
        {forward ? (
          <>
            Avanzar <ArrowRight aria-hidden strokeWidth={3} /> {CARD_STATUS_LABEL[forward]}
          </>
        ) : (
          <>
            Mantené <Undo2 aria-hidden strokeWidth={3} /> Deshacer
          </>
        )}
      </span>
      {forward && back ? (
        <span className="kds-hint-alt">
          Mantené <Undo2 aria-hidden strokeWidth={3} />
        </span>
      ) : null}
    </p>
  )
}

export function Clock({ minutes, level }: { minutes: number; level: AgeLevel }) {
  const { value, unit } = formatElapsed(minutes)
  const word = AGE_WORD[level]
  return (
    <p className="kds-clock" data-level={level}>
      <span className="sr-only">Hace </span>
      <span className="kds-clock-time">
        <b>{value}</b>
        {unit ? <span>{unit}</span> : null}
      </span>
      {word ? <em>{word}</em> : null}
    </p>
  )
}

function Line({ line, cardStatus }: { line: CardLine; cardStatus: CardStatus }) {
  // Solo se marca el renglón que va distinto del resto de la comanda.
  const ahead = line.status === 'served' || (line.status === 'ready' && cardStatus !== 'ready')
  return (
    <li className="kds-line" data-status={line.status}>
      <span className="kds-qty" data-many={line.quantity > 1 ? 'true' : undefined}>
        {line.quantity}
      </span>
      <div className="kds-what">
        <p className="kds-name">{line.name}</p>
        {line.modifiers.length > 0 || line.notes ? (
          <ul className="kds-mods" aria-label="Aclaraciones">
            {line.modifiers.map((modifier, index) => (
              // Dos aclaraciones iguales en un mismo renglón son posibles: la posición desempata.
              // biome-ignore lint/suspicious/noArrayIndexKey: lista fija por renglón, nunca se reordena
              <li key={`${modifier}:${index}`} className="kds-mod">
                {modifier}
              </li>
            ))}
            {line.notes ? <li className="kds-mod is-note">«{line.notes}»</li> : null}
          </ul>
        ) : null}
        {ahead ? (
          <p className="kds-line-state">
            <Check aria-hidden strokeWidth={3} />
            {line.status === 'served' ? 'Entregado' : 'Listo'}
          </p>
        ) : null}
      </div>
    </li>
  )
}

type Props = {
  card: KitchenCard
  minutes: number
  level: AgeLevel
  selected: boolean
  /** Acaba de entrar: se destaca un momento. */
  arriving: boolean
  /** Acuse de la última pulsación (120 ms). */
  ack: boolean
  holding: boolean
  /** En el riel la comanda tiene que entrar en el alto disponible; en la lista crece lo que haga falta. */
  fit: boolean
  /** Ocupa dos lugares del riel: los renglones van en dos columnas. */
  wide: boolean
  onSelect: (id: string) => void
}

function KitchenTicketImpl({
  card,
  minutes,
  level,
  selected,
  arriving,
  ack,
  holding,
  fit,
  wide,
  onSelect,
}: Props) {
  const root = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const { signature } = card

  // Una comanda más alta que el riel no se corta ni se esconde: achica sus renglones hasta entrar.
  useLayoutEffect(() => {
    const element = root.current
    const slot = element?.parentElement
    const lines = body.current
    if (!element || !slot || !lines) return
    // No se usan adentro: están para volver a medir cuando cambia lo que se dibuja o cuánto lugar ocupa.
    void signature
    void wide
    const refit = () => {
      element.style.removeProperty('--k')
      if (!fit) return
      const available = slot.clientHeight
      if (available <= 0 || element.offsetHeight <= available) return
      const fitsAt = (scale: number) => {
        element.style.setProperty('--k', String(scale))
        return element.offsetHeight <= available
      }
      // Baja hasta que entra…
      let tooBig = 1
      let scale = 1
      for (let pass = 0; pass < 10; pass++) {
        const measured = element.offsetHeight
        if (measured <= available || scale <= MIN_TICKET_SCALE) break
        tooBig = scale
        scale = nextTicketScale(scale, measured, available, measured - lines.offsetHeight)
        element.style.setProperty('--k', String(scale))
      }
      // …y vuelve a subir todo lo que pueda: la cuenta de arriba es una aproximación (los nombres que
      // dejan de partirse, las dos columnas que se reacomodan) y suele pasarse de chica.
      let fitting = scale
      for (let pass = 0; pass < 5 && tooBig - fitting > 0.02; pass++) {
        const middle = Math.round(((fitting + tooBig) / 2) * 1000) / 1000
        if (fitsAt(middle)) fitting = middle
        else tooBig = middle
      }
      element.style.setProperty('--k', String(fitting))
    }
    refit()
    const observer = new ResizeObserver(refit)
    observer.observe(slot)
    // La letra llega después del primer dibujo y cambia los altos.
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) refit()
    })
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [fit, wide, signature])

  const critical = card.alerts.filter((alert) => alert.critical)
  const diet = card.alerts.filter((alert) => !alert.critical)
  const age = AGE_WORD[level]
  const label = [
    `Elegir ${card.spoken}`,
    CARD_STATUS_LABEL[card.status].toLowerCase(),
    `hace ${elapsedText(minutes)}`,
    age ? age.toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <article
      ref={root}
      className={cn('kds-ticket', `is-${card.status}`)}
      data-card={card.id}
      data-selected={selected ? 'true' : undefined}
      data-arriving={arriving ? 'true' : undefined}
      data-ack={ack ? 'true' : undefined}
      data-wide={wide ? 'true' : undefined}
    >
      <div className="kds-paper">
        <p className="kds-band">
          <StateWord status={card.status} />
        </p>

        {critical.length > 0 ? (
          <p className="kds-alert is-critical">
            <TriangleAlert aria-hidden strokeWidth={2.6} />
            <span>{critical.map((alert) => alert.label).join(' · ')}</span>
          </p>
        ) : null}
        {diet.length > 0 ? (
          <p className="kds-alert">
            <Leaf aria-hidden strokeWidth={2.6} />
            <span>{diet.map((alert) => alert.label).join(' · ')}</span>
          </p>
        ) : null}
        {card.isPractice ? <p className="kds-practice">Prueba</p> : null}

        <header className="kds-head">
          <h2 className="kds-table" data-fit={card.titleFit}>
            {card.titleFit === 'small' ? null : <span className="sr-only">Mesa </span>}
            {card.title}
          </h2>
          <Clock minutes={minutes} level={level} />
          <p className="kds-meta">
            {card.where ? <span>{card.where}</span> : null}
            {card.partySize ? (
              <span className="kds-people">
                <UsersRound aria-hidden strokeWidth={2.6} />
                {card.partySize}
                <span className="sr-only"> personas</span>
              </span>
            ) : null}
            {card.course > 1 ? <span className="kds-course">Tanda {card.course}</span> : null}
            {card.event ? <span className="kds-course is-event">{card.event}</span> : null}
            {card.alias ? <span className="kds-alias">{card.alias}</span> : null}
          </p>
        </header>

        <div ref={body} className="kds-body">
          {card.groups.map((group) => (
            <section key={group.stationId ?? 'sin-estacion'}>
              {group.station ? <h3 className="kds-station">{group.station}</h3> : null}
              <ul className="kds-lines">
                {group.lines.map((line) => (
                  <Line key={line.id} line={line} cardStatus={card.status} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {card.others.length > 0 ? (
          <p className="kds-others">
            {card.others.map((other) => (
              <span key={other.stationId}>
                + {other.name}: {other.quantity} · {OTHER_STATUS_LABEL[other.status]}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="kds-hit"
        aria-label={label}
        aria-pressed={selected}
        onClick={() => onSelect(card.id)}
      />
      {selected ? <FrameHint status={card.status} holding={holding} /> : null}
    </article>
  )
}

export const KitchenTicket = memo(
  KitchenTicketImpl,
  (a, b) =>
    a.card.signature === b.card.signature &&
    a.minutes === b.minutes &&
    a.level === b.level &&
    a.selected === b.selected &&
    a.arriving === b.arriving &&
    a.ack === b.ack &&
    a.holding === b.holding &&
    a.fit === b.fit &&
    a.wide === b.wide &&
    a.onSelect === b.onSelect,
)
