'use client'

import './kitchen.css'
import {
  ArrowRight,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeOff,
  VolumeX,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AgeLevel, ageLevel, elapsedMinutes } from '@/lib/pos/kitchen/age'
import {
  type AdvanceTo,
  advanceTarget,
  buildCards,
  CARD_STATUS_LABEL,
  hasExpired,
  type KitchenCard,
  newArrivals,
  splitEvents,
  ticketShape,
  totalsOf,
  undoTarget,
  unseenCards,
} from '@/lib/pos/kitchen/cards'
import { ticketSpan } from '@/lib/pos/kitchen/layout'
import {
  nextSelection,
  railView,
  reconcileSelection,
  selectionAfterReady,
  selectionModel,
} from '@/lib/pos/kitchen/selection'
import type { KitchenQueue } from '@/lib/pos/types'
import type { LiveStatus } from '@/lib/pos/use-poke'
import { cn } from '@/lib/utils'
import { KitchenEvent } from './kitchen-event'
import { useClipped, useKitchenLayout, useServerNow, useWakeLock } from './kitchen-hooks'
import { DoneStub, QueueStub } from './kitchen-stubs'
import { FrameHint, HOLD_STYLE, KitchenTicket } from './kitchen-ticket'
import { KitchenTotals } from './kitchen-totals'
import { StationPicker } from './station-picker'
import { type SoundState, useKitchenSound } from './use-kitchen-sound'
import { useTwoButtons } from './use-two-buttons'

/**
 * La pantalla de cocina: el riel de comandas, para un cocinero a tres metros de una tele y con las manos
 * ocupadas. Se maneja con dos botones (ver `lib/pos/kitchen/buttons.ts`).
 *
 *   arriba   la hora y la tira de lo que hay que hacer ahora, sumado entre todas las comandas;
 *   al medio el riel: las comandas más viejas sin terminar, enteras, en orden de llegada;
 *   abajo    los talones: lo listo (se puede deshacer por diez minutos) y lo que todavía no entra en el riel.
 *
 * El riel es una sola fila: la de más a la izquierda es la próxima que tiene que salir, y al terminarla
 * las demás se corren un lugar, como en el riel de verdad. A esta letra entran cuatro; lo que no entra
 * espera abajo, en «En cola», con su número y su reloj (nada queda escondido). Una comanda larguísima
 * ocupa dos lugares antes que achicarse hasta no leerse.
 *
 * Lo listo baja a un talón en vez de quedarse colgado: una comanda terminada ocupando un lugar diez
 * minutos taparía una que todavía hay que cocinar. Es el pincho de las comandas hechas: a la vista,
 * apartado, y con vuelta.
 *
 * Con un evento la pantalla se parte: a la izquierda lo que falta de cada plato (`kitchen-event.tsx`) y
 * a la derecha el riel de la carta.
 *
 * Acá no se habla con el servidor: eso es de `kitchen-live.tsx`. Esta pantalla recibe la cola (ya con lo
 * que se acaba de tocar aplicado) y avisa qué se apretó.
 */

export type KitchenLink = {
  /** El canal de avisos en vivo. */
  live: LiveStatus
  /** No hay forma de saber qué está pasando ahora: va el cartel grande. */
  down: boolean
  /** Por qué, si lo dijo el servidor («Se cerró tu sesión…»). Vacío = se cortó la conexión. */
  reason: string | null
  /** Hora (ms) del último dato bueno. */
  lastOkMs: number
}

/** Algo que se apretó y la base no aceptó. `ticketId` es la comanda sobre la que se había apretado. */
export type KitchenFailure = { key: number; ticketId: string; title: string; detail: string }

type Props = {
  /** A dónde vuelve quien abrió la cocina desde un celular (la tele con botonera no lo ve). */
  backHref?: string
  /** La cola a mostrar, con lo recién tocado ya aplicado. */
  queue: KitchenQueue
  /** Estaciones de esta pantalla (vacío = todas). */
  stations: string[]
  onStations: (next: string[]) => void
  onAdvance: (ticketId: string, to: AdvanceTo, context: { spoken: string; undo: boolean }) => void
  /** «Cocina lo vio». Devuelve si se pudo avisar; si no, se reintenta en la próxima lectura. */
  onShown: (ticketIds: string[]) => Promise<boolean>
  /**
   * Quien mira es la cocina (su usuario). El tilde «cocina lo vio» lo pone la cocina: su usuario en
   * cualquier pantalla, o una pantalla grande (la tele, una tablet). El dueño o un mozo que espían la cola
   * desde el celular no lo ponen.
   */
  isKitchen: boolean
  link: KitchenLink
  failure: KitchenFailure | null
  onDismissFailure: () => void
  timeZone: string
}

const ACK_MS = 120
const ARRIVAL_MS = 2600
const FAILURE_MS = 9000
const NONE: ReadonlySet<string> = new Set()

const SOUND_ICON = { on: Volume2, locked: Volume1, muted: VolumeOff, none: VolumeX } as const
const SOUND_WORD: Record<SoundState, string> = {
  on: 'Sonido',
  locked: 'Sonido',
  muted: 'Silencio',
  none: 'Sin sonido',
}
const SOUND_LABEL: Record<SoundState, string> = {
  on: 'Sonido prendido. Tocá para silenciar.',
  locked: 'El sonido se activa con el primer toque. Tocá para silenciar.',
  muted: 'En silencio. Tocá para prender el sonido.',
  none: 'Este dispositivo no puede reproducir sonido.',
}
const LIVE_WORD: Record<LiveStatus, string> = {
  live: 'En vivo',
  connecting: 'Conectando',
  offline: 'Sin avisos en vivo',
}

export function KitchenScreen({
  backHref,
  queue,
  stations: filter,
  onStations,
  onAdvance,
  onShown,
  isKitchen,
  link,
  failure,
  onDismissFailure,
  timeZone,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLOListElement>(null)
  const layout = useKitchenLayout(track)
  const now = useServerNow(queue.now)
  const sound = useKitchenSound()
  useWakeLock()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [touch, setTouch] = useState(false)
  const [ack, setAck] = useState<string | null>(null)
  const [arriving, setArriving] = useState<ReadonlySet<string>>(NONE)
  const [announcement, setAnnouncement] = useState('')

  // ── De la cola a lo que se dibuja ──────────────────────────────────────────
  const built = useMemo(() => buildCards(queue, filter), [queue, filter])
  const cards = useMemo(() => built.filter((card) => !hasExpired(card, now)), [built, now])
  const { events, alaCarte } = useMemo(() => splitEvents(cards), [cards])
  const eventCards = useMemo(() => events.flatMap((event) => event.cards), [events])
  const model = useMemo(() => selectionModel(alaCarte, eventCards), [alaCarte, eventCards])
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const totals = useMemo(() => totalsOf(alaCarte), [alaCarte])

  // ── El marco ───────────────────────────────────────────────────────────────
  // Sale de la cola: si la comanda enmarcada se va, el marco pasa a la que seguía. Se ajusta al dibujar
  // (no en un efecto) para que nunca haya un cuadro sin marco o con el marco en una comanda que ya no está.
  const [frame, setFrame] = useState<{ id: string | null; order: readonly string[]; key: string }>({
    id: null,
    order: [],
    key: '',
  })
  const orderKey = model.order.join('|')
  const selected = reconcileSelection(frame.order, model, frame.id)
  if (selected !== frame.id || orderKey !== frame.key) {
    setFrame({ id: selected, order: model.order, key: orderKey })
  }

  // Una comanda que a letra entera no entra en el alto del riel ocupa dos lugares (y va en dos columnas).
  const wide = useMemo(() => {
    const ids = new Set<string>()
    if (layout.mode === 'list') return ids
    for (const card of cards) {
      if (ticketSpan(ticketShape(card), layout.column, layout.room, layout.slots) === 2) {
        ids.add(card.id)
      }
    }
    return ids
  }, [cards, layout.mode, layout.column, layout.room, layout.slots])

  const pick = (ids: readonly string[]) =>
    ids.map((id) => byId.get(id)).filter((card): card is KitchenCard => card !== undefined)
  const current = selected ? byId.get(selected) : undefined

  // La mesa del evento que está enmarcada se abre como una comanda entera en el primer lugar del riel:
  // en la ficha no entra lo que lleva. Mientras tanto, a la carta le queda un lugar menos.
  const lens = current && model.event.includes(current.id) ? current : null
  const carteSlots = lens ? layout.slots - (wide.has(lens.id) ? 2 : 1) : layout.slots

  // Qué tramo del riel se ve: arranca en la más vieja y solo se corre para mostrar la enmarcada.
  const [startAt, setStartAt] = useState(0)
  const view =
    carteSlots >= 1
      ? railView(model.active, carteSlots, startAt, selected, (id) => (wide.has(id) ? 2 : 1))
      : { start: 0, count: 0 }
  if (view.start !== startAt) setStartAt(view.start)

  const railEnd = view.start + view.count
  const onRail = pick(model.active.slice(view.start, railEnd))
  const hanging = lens ? [lens, ...onRail] : onRail
  const waiting =
    layout.mode === 'list'
      ? []
      : pick([...model.active.slice(0, view.start), ...model.active.slice(railEnd)])
  const done = pick(model.done)

  // Los talones que no entran en la fila se esconden enteros y se cuentan.
  const doneList = useRef<HTMLUListElement>(null)
  const waitingList = useRef<HTMLUListElement>(null)
  const doneHidden = useClipped(doneList, model.done.join('|'))
  const waitingHidden = useClipped(waitingList, waiting.map((card) => card.id).join('|'))

  const ageOf = (card: KitchenCard): { minutes: number; level: AgeLevel } => {
    const minutes = elapsedMinutes(card.firedMs, now)
    // Lo que ya está listo no se demora más: su reloj no avisa nada.
    return { minutes, level: card.status === 'ready' ? 'ok' : ageLevel(minutes, queue.settings) }
  }

  // ── Los dos botones ────────────────────────────────────────────────────────
  const select = useCallback((id: string) => {
    setFrame((prev) => (prev.id === id ? prev : { ...prev, id }))
  }, [])

  const ackTimer = useRef<number | null>(null)
  const flash = (id: string) => {
    setAck(id)
    if (ackTimer.current !== null) window.clearTimeout(ackTimer.current)
    ackTimer.current = window.setTimeout(() => setAck(null), ACK_MS)
  }

  const goNext = () => {
    const next = nextSelection(model.order, selected)
    if (next) select(next)
  }

  const act = (undo: boolean) => {
    if (!current) return
    const to = undo ? undoTarget(current.status) : advanceTarget(current.status)
    if (!to) return
    onAdvance(current.id, to, { spoken: current.spoken, undo })
    flash(current.id)
    // Terminada una comanda, el marco vuelve solo a la más vieja que falta.
    if (to === 'ready') {
      const next = selectionAfterReady(model, current.id)
      if (next) select(next)
    }
  }

  const buttons = useTwoButtons({
    enabled: !pickerOpen,
    onNext: goNext,
    onAdvance: () => act(false),
    onUndo: () => act(true),
    onPress: () => {
      sound.unlock()
      if (failure) onDismissFailure()
    },
  })

  // ── Lo que entra: suena y se destaca ───────────────────────────────────────
  const { beep } = sound
  const filterKey = filter.join(',')
  const known = useRef<{ filter: string; ids: Set<string> | null }>({
    filter: filterKey,
    ids: null,
  })
  const timers = useRef<number[]>([])
  useEffect(() => {
    // Cambiar de estaciones hace aparecer comandas que no entraron recién: no suenan.
    if (known.current.filter !== filterKey) known.current = { filter: filterKey, ids: null }
    const fresh = newArrivals(known.current.ids, cards)
    known.current.ids = new Set(cards.map((card) => card.id))
    if (fresh.length === 0) return
    beep()
    setArriving((prev) => new Set([...prev, ...fresh]))
    const names = cards.filter((card) => fresh.includes(card.id)).map((card) => card.spoken)
    setAnnouncement(`Entró ${names.join(', ')}.`)
    const timer = window.setTimeout(() => {
      setArriving((prev) => {
        const next = new Set(prev)
        for (const id of fresh) next.delete(id)
        return next.size === 0 ? NONE : next
      })
    }, ARRIVAL_MS)
    timers.current.push(timer)
  }, [cards, filterKey, beep])

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      if (ackTimer.current !== null) window.clearTimeout(ackTimer.current)
    },
    [],
  )

  // ── «Cocina lo vio» ────────────────────────────────────────────────────────
  const reported = useRef(new Set<string>())
  const acknowledges = isKitchen || layout.mode === 'rail'
  useEffect(() => {
    if (document.hidden || !acknowledges) return
    const ids = unseenCards(cards, reported.current)
    if (ids.length === 0) return
    for (const id of ids) reported.current.add(id)
    void onShown(ids).then((ok) => {
      if (!ok) for (const id of ids) reported.current.delete(id)
    })
  }, [cards, onShown, acknowledges])

  // ── Lo demás ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.matchMedia('(any-pointer: coarse)').matches) setTouch(true)
  }, [])

  const failureKey = failure?.key
  const failedId = failure?.ticketId
  useEffect(() => {
    if (failureKey === undefined) return
    // El marco vuelve a la comanda que no se pudo mover: «probá de nuevo» es apretar otra vez, y tiene
    // que caer sobre la misma (al marcarla lista el marco ya se había ido a la siguiente).
    if (failedId) select(failedId)
    const timer = window.setTimeout(onDismissFailure, FAILURE_MS)
    return () => window.clearTimeout(timer)
  }, [failureKey, failedId, select, onDismissFailure])

  // La comanda enmarcada siempre a la vista (en el celular la lista se corre; en la tele, los talones).
  // Al abrir no se corre nada: la pantalla arranca arriba.
  const shownFrame = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const first = shownFrame.current === undefined
    if (shownFrame.current === selected) return
    shownFrame.current = selected
    if (first || !selected) return
    root.current
      ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  const clockFormat = useMemo(
    () =>
      new Intl.DateTimeFormat('es-AR', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    [timeZone],
  )
  const clock = clockFormat.format(new Date(now))

  const forward = current ? advanceTarget(current.status) : null
  const back = current ? undoTarget(current.status) : null
  const goMain = !current
    ? 'Avanzar'
    : buttons.holding && back
      ? 'Deshacer…'
      : forward === 'preparing'
        ? 'Empezar'
        : forward === 'ready'
          ? 'Listo'
          : 'Deshacer'
  const goSub = !current
    ? 'No hay comandas'
    : forward
      ? `${current.spoken}${back ? ' · mantené para deshacer' : ''}`
      : `${current.spoken} · mantené apretado`

  const SoundIcon = SOUND_ICON[sound.state]
  const soundNote =
    sound.state === 'locked'
      ? 'Tocá un botón para activar el sonido'
      : sound.justActivated && sound.state === 'on'
        ? 'Sonido activado'
        : null

  const emptyTitle =
    cards.length === 0
      ? 'Sin comandas.'
      : alaCarte.length === 0
        ? 'Sin comandas a la carta.'
        : 'Todo listo.'

  return (
    <div
      ref={root}
      className="kds"
      data-touch={touch ? 'true' : undefined}
      style={layout.unit === null ? undefined : { ['--u' as string]: `${layout.unit}px` }}
      onPointerDownCapture={() => {
        sound.unlock()
        if (!touch) setTouch(true)
      }}
    >
      <h1 className="sr-only">Cocina · {queue.branch.name}</h1>

      {/* Sin conexión, toda la franja de arriba es el cartel: no corre las comandas de lugar y no se puede
          no ver. Vuelve a ser la hora y los totales cuando hay datos frescos. */}
      <header className="kds-top" data-down={link.down ? 'true' : undefined}>
        {link.down ? (
          <div className="kds-down" role="alert">
            <WifiOff aria-hidden strokeWidth={2.6} />
            <p>
              <strong>{link.reason ? 'Sin datos nuevos' : 'Sin conexión'}</strong>
              <span> · último dato {clockFormat.format(new Date(link.lastOkMs))}</span>
              {link.reason ? <small>{link.reason}</small> : null}
            </p>
          </div>
        ) : (
          <>
            <div className="kds-now">
              <p className="kds-now-time">{clock}</p>
              <p className="kds-now-place">
                {backHref ? (
                  <a href={backHref} className="kds-back">
                    <span className="kds-back-arrow" aria-hidden>
                      ‹
                    </span>
                    {queue.branch.name}
                    <span className="sr-only">: volver al salón</span>
                  </a>
                ) : (
                  <span>{queue.branch.name}</span>
                )}
                <span className="kds-live" data-state={link.live} role="status">
                  {link.live === 'offline' ? (
                    <WifiOff aria-hidden strokeWidth={2.6} />
                  ) : (
                    <span className="kds-live-dot" aria-hidden />
                  )}
                  {LIVE_WORD[link.live]}
                </span>
              </p>
            </div>

            {totals.length === 0 && events.length > 0 ? (
              <p className="kds-totals is-empty">A la carta, nada para preparar ahora.</p>
            ) : (
              <KitchenTotals totals={totals} scroll={layout.mode === 'list'} />
            )}
          </>
        )}

        <div className="kds-tools">
          <StationPicker
            stations={queue.stations}
            selected={filter}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onChange={onStations}
          />
          <button
            type="button"
            className="kds-tool"
            data-state={sound.state}
            aria-label={SOUND_LABEL[sound.state]}
            aria-pressed={sound.state === 'none' ? undefined : sound.state !== 'muted'}
            disabled={sound.state === 'none'}
            onClick={sound.toggle}
          >
            <SoundIcon aria-hidden strokeWidth={2.4} />
            <span>{SOUND_WORD[sound.state]}</span>
          </button>
        </div>
      </header>

      <div className="kds-floor">
        {soundNote ? (
          <p className="kds-sound-note" role="status">
            <SoundIcon aria-hidden strokeWidth={2.6} />
            {soundNote}
          </p>
        ) : null}
        {events.length > 0 ? (
          <KitchenEvent
            events={events}
            selectedId={selected}
            ackId={ack}
            arriving={arriving}
            now={now}
            settings={queue.settings}
            onSelect={select}
          />
        ) : null}

        <section className="kds-rail" aria-label="Comandas sin terminar, por orden de llegada">
          <div className="kds-rail-bar" aria-hidden />
          <ol
            ref={track}
            className="kds-rail-track"
            style={{ ['--cols' as string]: layout.mode === 'list' ? 1 : layout.slots }}
          >
            {hanging.map((card) => (
              <li
                key={card.id}
                className="kds-slot"
                style={wide.has(card.id) ? { gridColumn: 'span 2' } : undefined}
              >
                <KitchenTicket
                  card={card}
                  {...ageOf(card)}
                  selected={card.id === selected}
                  arriving={arriving.has(card.id)}
                  ack={card.id === ack}
                  holding={card.id === selected && buttons.holding}
                  fit={layout.mode === 'rail'}
                  wide={wide.has(card.id)}
                  onSelect={select}
                />
              </li>
            ))}
          </ol>
          {hanging.length === 0 ? (
            <div className="kds-empty">
              <p className="kds-empty-time" aria-hidden>
                {clock}
              </p>
              <h2 className="kds-empty-title">{emptyTitle}</h2>
              <p className="kds-empty-hint">Lo que entre aparece acá.</p>
            </div>
          ) : null}
        </section>
      </div>

      <footer
        className="kds-shelf"
        data-empty={done.length + waiting.length === 0 ? 'true' : undefined}
      >
        {done.length > 0 ? (
          <div className="kds-shelf-group is-done">
            <h2 className="kds-shelf-label">
              Listos <b>{done.length}</b>
            </h2>
            <ul ref={doneList} className="kds-shelf-list">
              {done.map((card) => (
                <DoneStub
                  key={card.id}
                  card={card}
                  minutes={elapsedMinutes(card.doneMs ?? now, now)}
                  selected={card.id === selected}
                  ack={card.id === ack}
                  onSelect={select}
                />
              ))}
            </ul>
            {doneHidden > 0 ? (
              <p className="kds-shelf-more">
                +{doneHidden}
                <span className="sr-only"> listas más</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {/* El pie del marco, cuando lo enmarcado es un talón: al lado, sin sacarle lugar a los listos. */}
        {current && model.done.includes(current.id) ? (
          <FrameHint status="ready" holding={buttons.holding} />
        ) : null}
        {waiting.length > 0 ? (
          <div className="kds-shelf-group is-waiting">
            <h2 className="kds-shelf-label">
              En cola <b>{waiting.length}</b>
            </h2>
            <ul ref={waitingList} className="kds-shelf-list">
              {waiting.map((card) => (
                <QueueStub
                  key={card.id}
                  card={card}
                  {...ageOf(card)}
                  arriving={arriving.has(card.id)}
                  onSelect={select}
                />
              ))}
            </ul>
            {waitingHidden > 0 ? (
              <p className="kds-shelf-more">
                +{waitingHidden}
                <span className="sr-only"> en cola más</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {done.length + waiting.length === 0 ? (
          <p className="kds-legend">
            <span>
              <b>Siguiente</b> mueve el marco
            </span>
            <span>
              <b>Avanzar</b> empieza y termina la comanda enmarcada
            </span>
            <span>
              <b>Avanzar mantenido</b> deshace
            </span>
          </p>
        ) : null}
      </footer>

      <div className="kds-actions">
        <button type="button" className="kds-action is-next" onClick={goNext} disabled={!current}>
          <span className="kds-action-main">
            Siguiente <ArrowRight aria-hidden strokeWidth={3} />
          </span>
        </button>
        <button
          type="button"
          className={cn('kds-action is-go', current && `is-${current.status}`)}
          disabled={!current}
          data-holding={buttons.holding && back ? 'true' : undefined}
          style={HOLD_STYLE}
          aria-label={
            current
              ? `${forward ? `Avanzar ${current.spoken}: ${CARD_STATUS_LABEL[forward].toLowerCase()}` : `Deshacer ${current.spoken}`}. Mantené apretado para deshacer.`
              : 'Avanzar'
          }
          onPointerDown={() => buttons.down('pointer')}
          onPointerUp={() => buttons.up('pointer')}
          onPointerLeave={buttons.cancel}
          onPointerCancel={buttons.cancel}
          onContextMenu={(event) => event.preventDefault()}
          // Con el teclado (sin puntero) el botón avanza; mantener es cosa del puntero y de la caja de botones.
          onClick={(event) => {
            if (event.detail === 0) act(false)
          }}
        >
          <span className="kds-action-main">{goMain}</span>
          <span className="kds-action-sub">{goSub}</span>
        </button>
      </div>

      {failure ? (
        <div className="kds-failure" role="alert" key={failure.key}>
          <TriangleAlert aria-hidden strokeWidth={2.6} />
          <p>
            <strong>{failure.title}</strong>
            <span>{failure.detail}</span>
          </p>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
