'use client'

import { BellRing, Check, ChevronRight, Pause, Play, Plus, Receipt, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import type { QuickCard } from '@/lib/pos/floor/quick'
import { formatMinutes, STATE_LABEL, type TableState } from '@/lib/pos/table-state'
import { cn } from '@/lib/utils'
import { STATE_ICON } from './floor-model'
import './table-quick.css'

/**
 * La ficha de la mesa elegida en el mapa: lo que se puede hacer YA, sin entrar a la mesa.
 *
 * Es la barra de abajo de la comanda (`../order/action-bar.tsx`) traída al mapa: las mismas palabras, en el
 * mismo orden, y el botón que manda siempre a la derecha, donde cae el pulgar. Qué ofrece cada mesa lo decide
 * `quickCard` (`lib/pos/floor/quick.ts`). No es un menú: son tres botones como mucho.
 *
 *   arriba   la mesa, en qué está y cuánto lleva; tocarla entra a la comanda
 *   al medio qué hay para retirar (o qué tanda espera), dicho en una línea
 *   abajo    Cuenta · Agregar · y lo que manda: Servido, Marchar tanda o Cobrar
 */

/** Lo que tarda en poder tocarse: un doble toque sobre una mesa de abajo caía en un botón de la ficha. */
const ARM_MS = 350

type Props = {
  /** El número de la mesa. */
  label: string
  alias: string | null
  partySize: number | null
  totalCents: number
  practice: boolean
  state: TableState
  card: QuickCard
  /** Se está pidiendo la cuenta: el botón espera. */
  billBusy: boolean
  onServe: () => void
  onFire: () => void
  onAdd: () => void
  onBill: () => void
  /** Entrar a la comanda. */
  onOpen: () => void
  onClose: () => void
  /** Cuánto mide: el mapa corre la mesa elegida si quedaba debajo. */
  onHeight: (px: number) => void
}

export function TableQuick({
  label,
  alias,
  partySize,
  totalCents,
  practice,
  state,
  card,
  billBusy,
  onServe,
  onFire,
  onAdd,
  onBill,
  onOpen,
  onClose,
  onHeight,
}: Props) {
  const ref = useRef<HTMLElement>(null)
  const [bornAt] = useState(() => performance.now())
  const armed = (run: () => void) => () => {
    if (performance.now() - bornAt < ARM_MS) return
    run()
  }

  const onHeightRef = useRef(onHeight)
  useEffect(() => {
    onHeightRef.current = onHeight
  }, [onHeight])
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const publish = () => onHeightRef.current(Math.round(node.offsetHeight))
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const Icon = STATE_ICON[state.key]
  const { primary } = card
  const title = alias ?? `Mesa ${label}`
  const minutes = state.minutes !== null ? formatMinutes(state.minutes) : ''
  // Lo que se va a llevar (o la tanda que espera), en una línea. Mientras llega el detalle queda el lugar
  // reservado: la ficha no cambia de alto y el mapa no salta.
  const what =
    primary.kind === 'serve'
      ? { icon: BellRing, lead: 'Para retirar', text: primary.label }
      : primary.kind === 'fire'
        ? {
            icon: Pause,
            lead: primary.number ? `Espera la tanda ${primary.number}` : 'Espera una tanda',
            text: primary.label,
          }
        : null
  const inline =
    primary.kind === 'serve'
      ? primary.label
      : primary.kind === 'fire' && primary.label
        ? `espera la tanda${primary.number ? ` ${primary.number}` : ''}: ${primary.label}`
        : ''

  return (
    <section
      ref={ref}
      className={cn(
        'pos-quick',
        `pos-st-${state.key}`,
        state.urgency === 'late' && 'pos-urg-late',
        state.urgency === 'warn' && 'pos-urg-warn',
      )}
      data-primary={primary.kind}
      aria-label={`Mesa ${label}: acciones rápidas`}
      data-testid="table-quick"
    >
      <div className="pos-quick-head">
        <button
          type="button"
          className="pos-quick-open"
          onClick={armed(onOpen)}
          aria-label={`Ver el pedido de la mesa ${label}`}
          data-testid="quick-open"
        >
          <span className="pos-quick-num">{label}</span>
          <span className="pos-quick-who">
            <span className="pos-quick-title">
              <b>{title}</b>
              {partySize ? <em>×{partySize}</em> : null}
              {practice ? <i>Práctica</i> : null}
              {totalCents > 0 ? (
                <span className="pos-quick-total">{formatCentsShort(totalCents)}</span>
              ) : null}
            </span>
            <span className="pos-quick-state">
              <Icon aria-hidden strokeWidth={2.4} />
              <span>
                {STATE_LABEL[state.key]}
                {minutes ? ` · ${minutes}` : ''}
                {/* Con ancho la ficha es una sola fila: lo que hay para llevar va acá mismo. */}
                {inline ? <span className="pos-quick-inline"> · {inline}</span> : null}
              </span>
            </span>
          </span>
          <ChevronRight aria-hidden className="pos-quick-chev" />
        </button>
        <button
          type="button"
          className="pos-quick-close"
          onClick={onClose}
          aria-label="Cerrar las acciones de la mesa"
          data-testid="quick-close"
        >
          <X aria-hidden strokeWidth={2.4} />
        </button>
      </div>

      {what ? (
        <p className="pos-quick-what" data-testid="quick-what">
          <what.icon aria-hidden strokeWidth={2.5} />
          <span>
            <b>{what.lead}</b>
            {what.text ? `: ${what.text}` : <i className="pos-quick-wait" aria-hidden />}
          </span>
        </p>
      ) : null}

      <div className="pos-quick-row">
        {primary.kind === 'bill' ? null : (
          <button
            type="button"
            className="pos-quick-util"
            aria-label={card.billOn ? 'Ver la cuenta: ya la pidieron' : 'Pedir la cuenta y abrirla'}
            onClick={armed(onBill)}
            disabled={billBusy}
            data-testid="quick-bill"
          >
            <Receipt aria-hidden strokeWidth={2.2} />
            {card.billOn ? 'Ver cuenta' : 'Cuenta'}
          </button>
        )}
        <button
          type="button"
          className={primary.kind === 'add' ? 'pos-quick-go' : 'pos-quick-util'}
          onClick={armed(onAdd)}
          data-testid="quick-add"
        >
          <Plus aria-hidden strokeWidth={primary.kind === 'add' ? 2.8 : 2.4} />
          Agregar
        </button>

        {primary.kind === 'serve' ? (
          <button
            type="button"
            className="pos-quick-go is-ready"
            onClick={armed(onServe)}
            data-testid="quick-serve"
          >
            <Check aria-hidden strokeWidth={3} />
            Servido{primary.units ? ` · ${primary.units}` : ''}
          </button>
        ) : null}

        {primary.kind === 'fire' ? (
          <button
            type="button"
            className="pos-quick-go"
            onClick={armed(onFire)}
            data-testid="quick-fire"
          >
            <Play aria-hidden strokeWidth={2.6} />
            Marchar tanda{primary.number ? ` ${primary.number}` : ''}
          </button>
        ) : null}

        {primary.kind === 'bill' ? (
          <button
            type="button"
            className="pos-quick-go is-bill"
            onClick={armed(onBill)}
            disabled={billBusy}
            data-testid="quick-bill"
          >
            <Receipt aria-hidden strokeWidth={2.4} />
            Cobrar
          </button>
        ) : null}
      </div>
    </section>
  )
}
