'use client'

import './kds.css'
import {
  AArrowDown,
  AArrowUp,
  ArrowRight,
  BellRing,
  Check,
  CornerDownLeft,
  Keyboard,
  LayoutPanelLeft,
  TriangleAlert,
  Undo2,
  Volume1,
  Volume2,
  VolumeOff,
  VolumeX,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHoldReload } from '@/components/shell/hold-reload'
import {
  assignCodes,
  type BoardPane,
  buildBoard,
  cardForCode,
  cardKey,
  promoteStation,
  type WallRect,
  wallNeighbor,
} from '@/lib/pos/kitchen/board'
import {
  type AdvanceTo,
  advanceTarget,
  CARD_STATUS_LABEL,
  type CardLine,
  type CardStatus,
  type ItemsChange,
  itemsToMove,
  type KitchenCard,
  knownTickets,
  newArrivals,
  undoTarget,
  unseenTickets,
} from '@/lib/pos/kitchen/cards'
import {
  KEYPAD_IDLE,
  type KeypadAction,
  type KeypadState,
  keypadKey,
  keypadPress,
  liveTyped,
  TYPED_FORGET_MS,
  UNDO_WINDOW_MS,
} from '@/lib/pos/kitchen/keypad'
import { stationIcon } from '@/lib/pos/kitchen/station-kind'
import type { KitchenQueue, MenuStation, PrepStatus } from '@/lib/pos/types'
import type { LiveStatus } from '@/lib/pos/use-poke'
import { cn } from '@/lib/utils'
import { PosBrand, type PosBrandInfo } from '../ui/pos-brand'
import { KeypadHelp } from './keypad-help'
import { useServerNow, useWakeLock } from './kitchen-hooks'
import { type DragPayload, GREW_LABEL } from './pass-card'
import { PassPane } from './pass-pane'
import { type AlertLevel, type SoundState, useKitchenSound } from './use-kitchen-sound'

/**
 * La pantalla de cocina: un muro de comandas por estación (docs/features/pos.md › La pantalla de cocina).
 *
 *   · Una estación sola (el monitor de la barra, el de los pizzeros): su muro a pantalla completa.
 *   · «El pase» (la tele del encargado): una estación grande y las demás más chicas al costado, todas
 *     a la vista. Con el mouse se maneja cualquiera: enmarcar, avanzar, volver atrás, tildar un renglón
 *     o arrastrar una comanda a otra estación.
 *
 * Cada estación marca los estados con un teclado numérico: el número de la mesa y Enter
 * (`lib/pos/kitchen/keypad.ts`). Mientras se teclea, el marco salta a esa mesa: se ve cuál va a cambiar
 * antes de confirmar.
 *
 * Acá no se habla con el servidor: eso es de `kitchen-live.tsx`. Esta pantalla recibe la cola (con lo
 * recién tocado ya aplicado) y avisa qué se movió.
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

/** Algo que se apretó y la base no aceptó. `card` es la comanda sobre la que se había apretado. */
export type KitchenFailure = {
  key: number
  station: string
  cardId: string
  title: string
  detail: string
}

/** Un movimiento pedido desde la pantalla. */
export type KitchenMove = ItemsChange & {
  itemIds: string[]
  station: string
  cardId: string
  /** Cómo se dice, para el aviso si falla: «avanzar la mesa 12», «pasar la mesa 12 a Barra». */
  what: string
}

type Props = {
  /** A dónde vuelve quien abrió la cocina desde un celular (la tele no lo ve). */
  backHref?: string
  /** La cola a mostrar, con lo recién tocado ya aplicado. */
  queue: KitchenQueue
  /** Las estaciones de esta pantalla, en orden (la primera es la grande). Vacío = todas: el pase. */
  view: string[]
  onView: (next: string[]) => void
  onMove: (move: KitchenMove) => void
  /** «Cocina lo vio», por tanda. Devuelve si se pudo avisar; si no, se reintenta en la próxima lectura. */
  onShown: (ticketIds: string[]) => Promise<boolean>
  /** Quien mira es la cocina (su usuario): es quien pone el tilde de «cocina lo vio». */
  isKitchen: boolean
  link: KitchenLink
  failure: KitchenFailure | null
  onDismissFailure: () => void
  timeZone: string
  /** Lo que va al final de la barra (la comandera de esta compu). */
  tools?: React.ReactNode
  brand?: PosBrandInfo
}

const ACK_MS = 160
/** Cuánto queda marcada la comanda que recibió algo. */
const ARRIVAL_MS = 9000
/** Cuánto dura el cartel a pantalla completa. */
const ALARM_MS = 4200
/** Cada cuánto vuelve a sonar una comanda que nadie empezó (solo con la alerta fuerte)… */
const NUDGE_MS = 25_000
/** …y hasta cuándo insiste. */
const NUDGE_FOR_MS = 95_000
const FAILURE_MS = 9000
const MISS_MS = 1600
const NONE: ReadonlySet<string> = new Set()

/** Tamaños de letra: «deben entrar muchas comandas», pero cada cocina mira su pantalla desde otro lado. */
const DENSITIES = [0.82, 1, 1.2] as const
const DENSITY_WORD = ['Chica', 'Media', 'Grande'] as const
const DENSITY_KEY = 'hub:pos:kitchen:density'
/** Cuánto más chicas van las estaciones del costado en el pase. */
const SIDE_SCALE = 0.8
/** Por debajo de esto no hay muro: una lista que se recorre con el dedo. */
const LIST_BELOW_WIDTH = 720
const LIST_BELOW_HEIGHT = 440

const DESIGN = { width: 1920, height: 1080, minUnit: 0.58, maxUnit: 2.4 }

function unitFor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1
  const fit = Math.min(width / DESIGN.width, height / DESIGN.height)
  return Math.min(DESIGN.maxUnit, Math.max(DESIGN.minUnit, fit))
}

function soundIcon(state: SoundState, level: AlertLevel) {
  if (state === 'none') return VolumeX
  if (state === 'muted') return VolumeOff
  return level === 'loud' ? Volume2 : Volume1
}
function soundWord(state: SoundState, level: AlertLevel): string {
  if (state === 'none') return 'Sin sonido'
  if (state === 'muted') return 'Silencio'
  return level === 'loud' ? 'Fuerte' : 'Suave'
}
function soundLabel(state: SoundState, level: AlertLevel): string {
  if (state === 'none') return 'Este dispositivo no puede reproducir sonido.'
  if (state === 'muted') return 'Alerta en silencio. Tocá para ponerla fuerte.'
  const locked = state === 'locked' ? ' Se activa con el primer toque.' : ''
  return level === 'loud'
    ? `Alerta fuerte: campana, cartel a pantalla completa y se repite hasta que alguien empieza la comanda.${locked} Tocá para ponerla suave.`
    : `Alerta suave: un timbre corto.${locked} Tocá para silenciarla.`
}

type Alarm = { key: number; titles: string[]; more: number; grew: boolean; station: string | null }
/** Lo último que se hizo desde esta pantalla, para deshacerlo con «−». */
type LastAction = {
  station: string
  cardId: string
  title: string
  to: AdvanceTo
  /** A qué paso vuelve cada renglón si se deshace. */
  previous: { status: AdvanceTo; itemIds: string[] }[]
  at: number
}
const LIVE_WORD: Record<LiveStatus, string> = {
  live: 'En vivo',
  connecting: 'Conectando',
  offline: 'Sin avisos en vivo',
}

function asAdvance(status: PrepStatus): AdvanceTo {
  return status === 'served' ? 'ready' : status
}

export function PassScreen({
  backHref,
  queue,
  view,
  onView,
  onMove,
  onShown,
  isKitchen,
  link,
  failure,
  onDismissFailure,
  timeZone,
  tools,
  brand,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const now = useServerNow(queue.now)
  const sound = useKitchenSound()
  useWakeLock()
  // Con la alarma armada, la pantalla no se recarga sola por una versión nueva (`lib/app-version`): el
  // navegador deja sonar recién después de un toque, y una recarga dejaría la cocina sin alarma.
  useHoldReload(sound.state === 'on')

  // ── La pantalla: su tamaño, la letra y cuántas estaciones muestra ──────────
  const [screen, setScreen] = useState<{ unit: number | null; list: boolean }>({
    unit: null,
    list: false,
  })
  useLayoutEffect(() => {
    const measure = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const next = {
        unit: unitFor(width, height),
        list: width < LIST_BELOW_WIDTH || height < LIST_BELOW_HEIGHT,
      }
      setScreen((prev) => (prev.unit === next.unit && prev.list === next.list ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const [density, setDensity] = useState(1)
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DENSITY_KEY))
      if (saved === 0 || saved === 1 || saved === 2) setDensity(saved)
    } catch {
      // sin almacenamiento: letra media
    }
  }, [])
  const changeDensity = (step: 1 | -1) => {
    setDensity((prev) => {
      const next = Math.min(DENSITIES.length - 1, Math.max(0, prev + step))
      try {
        window.localStorage.setItem(DENSITY_KEY, String(next))
      } catch {
        // idem
      }
      return next
    })
  }

  // ── De la cola a lo que se dibuja ──────────────────────────────────────────
  const panes = useMemo(() => buildBoard(queue, view, now), [queue, view, now])
  const paneById = useMemo(() => new Map(panes.map((pane) => [pane.station.id, pane])), [panes])
  const multi = panes.length > 1
  const mainId = panes[0]?.station.id ?? ''

  // El número de cada comanda (su mesa, o uno propio si no tiene): se conserva mientras siga en pantalla.
  const codeMemory = useRef(new Map<string, Map<string, string>>())
  const codes = useMemo(() => {
    const next = new Map<string, Map<string, string>>()
    for (const pane of panes) {
      const before = codeMemory.current.get(pane.station.id) ?? new Map<string, string>()
      next.set(pane.station.id, assignCodes(before, [...pane.wall, ...pane.done]))
    }
    return next
  }, [panes])
  useEffect(() => {
    codeMemory.current = codes
  }, [codes])

  // ── Dónde está el teclado y qué comanda está enmarcada ─────────────────────
  // Sale de la cola al dibujar (no en un efecto): nunca hay un cuadro con el marco en una comanda que
  // ya no está. Si la enmarcada se va, el marco descansa en la más vieja sin terminar.
  const [pick, setPick] = useState<{ station: string; cardId: string | null }>({
    station: mainId,
    cardId: null,
  })
  const focusId = paneById.has(pick.station) ? pick.station : mainId
  const focusPane = paneById.get(focusId) ?? null
  const cardIn = (pane: BoardPane | null, id: string | null): KitchenCard | null =>
    id === null || pane === null
      ? null
      : (pane.wall.find((card) => card.id === id) ??
        pane.done.find((card) => card.id === id) ??
        null)
  const resting = (pane: BoardPane | null): string | null =>
    pane?.wall[0]?.id ?? pane?.done[0]?.id ?? null
  const picked = pick.station === focusId ? cardIn(focusPane, pick.cardId) : null
  const current = picked ?? cardIn(focusPane, resting(focusPane))
  const selectedId = current?.id ?? null

  // La estación grande cambió (se leyó lo que este equipo tenía guardado, o alguien agrandó otra): el
  // teclado va con ella. Si no, un monitor guardado como «Barra» abría con el teclado apuntando a Cocina.
  const lastMain = useRef(mainId)
  useEffect(() => {
    if (lastMain.current === mainId) return
    lastMain.current = mainId
    setPick({ station: mainId, cardId: null })
  }, [mainId])

  // El marco no se queda pegado a una comanda que se fue. Si la enmarcada pasó a «Listos» sin que nadie
  // la eligiera ahí (la terminaron renglón por renglón, o desde otra pantalla), o directamente ya no
  // está, el marco vuelve a descansar en la más vieja sin terminar: si no, Enter quedaba sin hacer nada,
  // y cuando esa mesa volvía a pedir el marco saltaba solo a ella.
  const pickedInWall =
    picked !== null && (focusPane?.wall.some((card) => card.id === picked.id) ?? false)
  const framed = useRef<{ id: string | null; inWall: boolean }>({ id: null, inWall: false })
  useEffect(() => {
    const before = framed.current
    const gone = pick.cardId !== null && pick.station === focusId && picked === null
    const drifted = picked !== null && !pickedInWall && before.id === picked.id && before.inWall
    framed.current = { id: picked?.id ?? null, inWall: pickedInWall }
    if (gone || drifted) setPick((prev) => ({ station: prev.station, cardId: null }))
  }, [pick, focusId, picked, pickedInWall])

  const select = useCallback((station: string, cardId: string | null) => {
    setPick((prev) =>
      prev.station === station && prev.cardId === cardId ? prev : { station, cardId },
    )
  }, [])
  const focusPaneById = useCallback((station: string) => {
    setPick((prev) => (prev.station === station ? prev : { station, cardId: null }))
  }, [])

  // ── Lo tecleado ────────────────────────────────────────────────────────────
  const [keypad, setKeypad] = useState<KeypadState>(KEYPAD_IDLE)
  const keypadRef = useRef(keypad)
  keypadRef.current = keypad
  const typed = liveTyped(keypad, Date.now())
  // Un número a medio teclear se olvida solo.
  useEffect(() => {
    if (keypad.typed === '') {
      typingFrom.current = null
      return
    }
    const timer = window.setTimeout(
      () => setKeypad((prev) => (prev.at === keypad.at ? KEYPAD_IDLE : prev)),
      TYPED_FORGET_MS,
    )
    return () => window.clearTimeout(timer)
  }, [keypad])
  const [miss, setMiss] = useState<{ key: number; typed: string } | null>(null)
  const missKey = miss?.key
  useEffect(() => {
    if (missKey === undefined) return
    const timer = window.setTimeout(() => setMiss(null), MISS_MS)
    return () => window.clearTimeout(timer)
  }, [missKey])

  const [ack, setAck] = useState<string | null>(null)
  const ackTimer = useRef<number | null>(null)
  const flash = (station: string, cardId: string) => {
    setAck(cardKey(station, cardId))
    if (ackTimer.current !== null) window.clearTimeout(ackTimer.current)
    ackTimer.current = window.setTimeout(() => setAck(null), ACK_MS)
  }

  const [last, setLast] = useState<LastAction | null>(null)
  const lastAt = last?.at
  useEffect(() => {
    if (lastAt === undefined) return
    const timer = window.setTimeout(
      () => setLast((prev) => (prev?.at === lastAt ? null : prev)),
      UNDO_WINDOW_MS,
    )
    return () => window.clearTimeout(timer)
  }, [lastAt])

  // ── Mover una comanda ──────────────────────────────────────────────────────
  /** Llevar una comanda a un paso. Devuelve si había algo que mover. */
  const moveCard = (pane: BoardPane, card: KitchenCard, to: AdvanceTo, undo: boolean): boolean => {
    const ids = itemsToMove(card, to)
    if (ids.length === 0) return false
    const wanted = new Set(ids)
    const byStatus = new Map<AdvanceTo, string[]>()
    for (const line of card.lines) {
      const mine = line.itemIds.filter((id) => wanted.has(id))
      if (mine.length === 0) continue
      const status = asAdvance(line.status)
      byStatus.set(status, [...(byStatus.get(status) ?? []), ...mine])
    }
    onMove({
      itemIds: ids,
      to,
      station: pane.station.id,
      cardId: card.id,
      what: `${undo ? 'volver atrás' : 'avanzar'} ${card.spoken}`,
    })
    flash(pane.station.id, card.id)
    setLast({
      station: pane.station.id,
      cardId: card.id,
      title: card.title,
      to,
      previous: [...byStatus.entries()].map(([status, itemIds]) => ({ status, itemIds })),
      at: Date.now(),
    })
    // Terminada una comanda, el marco vuelve solo a la más vieja que falta.
    if (to === 'ready') {
      const next = pane.wall.find((other) => other.id !== card.id)?.id ?? null
      select(pane.station.id, next)
    } else {
      select(pane.station.id, card.id)
    }
    return true
  }

  const stepForward = (pane: BoardPane, card: KitchenCard) => {
    const to = advanceTarget(card.status)
    if (to) moveCard(pane, card, to, false)
  }
  const stepBack = (pane: BoardPane, card: KitchenCard) => {
    const to = undoTarget(card.status)
    if (to) moveCard(pane, card, to, true)
  }
  const straightToReady = (pane: BoardPane, card: KitchenCard) => {
    if (card.status !== 'ready') moveCard(pane, card, 'ready', false)
  }
  const undoLast = (): boolean => {
    if (!last || Date.now() - last.at > UNDO_WINDOW_MS) return false
    for (const group of last.previous) {
      onMove({
        itemIds: group.itemIds,
        to: group.status,
        station: last.station,
        cardId: last.cardId,
        what: `deshacer lo de la ${last.title}`,
      })
    }
    flash(last.station, last.cardId)
    select(last.station, last.cardId)
    setLast(null)
    return true
  }
  const reroute = (
    payload: { itemIds: string[]; label: string },
    from: string,
    to: MenuStation,
  ) => {
    if (payload.itemIds.length === 0) return
    onMove({
      itemIds: payload.itemIds,
      stationId: to.id,
      station: from,
      cardId: '',
      what: `pasar ${payload.label} a ${to.name}`,
    })
    setLast(null)
    setAnnouncement(`${payload.label}: pasó a ${to.name}.`)
  }

  // ── El teclado ─────────────────────────────────────────────────────────────
  const targetOf = (
    typedCode: string | null,
  ): { pane: BoardPane; card: KitchenCard } | 'miss' | null => {
    if (!focusPane) return null
    if (typedCode === null) return current ? { pane: focusPane, card: current } : null
    const id = cardForCode(codes.get(focusPane.station.id) ?? new Map(), typedCode)
    const card = cardIn(focusPane, id)
    return card ? { pane: focusPane, card } : 'miss'
  }
  const notFound = (typedCode: string) => {
    setMiss({ key: Date.now(), typed: typedCode })
    setAnnouncement(
      `No hay ninguna comanda con el número ${typedCode} en ${focusPane?.station.name ?? 'esta pantalla'}.`,
    )
  }

  /** Dónde estaba el marco antes de empezar a teclear un número. */
  const typingFrom = useRef<{ station: string; cardId: string | null } | null>(null)
  const act = (action: KeypadAction) => {
    if (action.type === 'preview') {
      if (!focusPane) return
      typingFrom.current ??= { station: focusPane.station.id, cardId: selectedId }
      const id = cardForCode(codes.get(focusPane.station.id) ?? new Map(), action.typed)
      // Lo tecleado no es ninguna mesa (se tipeó «12» y existe la 1): el marco vuelve a donde estaba.
      // Si no, quedaba en la 1 y un Enter de más la avanzaba.
      if (id) select(focusPane.station.id, id)
      else select(typingFrom.current.station, typingFrom.current.cardId)
      return
    }
    typingFrom.current = null
    if (action.type === 'clear') return
    if (action.type === 'pane') {
      if (panes.length < 2) return
      const at = panes.findIndex((pane) => pane.station.id === focusId)
      const next = panes[(at + action.step + panes.length) % panes.length]
      if (next) focusPaneById(next.station.id)
      return
    }
    if (action.type === 'move') {
      if (!focusPane) return
      const rects: WallRect[] = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          `[data-pane="${CSS.escape(focusPane.station.id)}"] .kds-wall > li:not([data-hidden])`,
        ) ?? [],
      ).map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          id: element.dataset.card ?? '',
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      })
      const next = wallNeighbor(rects, selectedId, action.direction)
      if (next) select(focusPane.station.id, next)
      return
    }
    // «−» sin número, recién hecho algo: deshace eso.
    if (action.type === 'back' && action.typed === null && undoLast()) return
    const target = targetOf(action.typed)
    if (target === 'miss') {
      if (action.typed) notFound(action.typed)
      return
    }
    if (!target) return
    if (action.type === 'advance') stepForward(target.pane, target.card)
    else if (action.type === 'ready') straightToReady(target.pane, target.card)
    else stepBack(target.pane, target.card)
  }
  // Siempre la última versión de lo que hay que hacer, sin volver a enganchar el teclado.
  const actRef = useRef(act)
  actRef.current = act

  /** El dibujo del teclado con qué hace cada tecla. */
  const [help, setHelp] = useState(false)

  const { unlock } = sound
  useEffect(() => {
    /** Quien navega con teclado entró a los controles (Mayúscula + Tab): ahí las teclas son las de siempre. */
    let inControls = false
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      // Con una hoja abierta (la de la comandera, una confirmación) las teclas son de esa hoja: Enter
      // en uno de sus botones no avanza la comanda que quedó atrás.
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        return
      }
      if (event.key === 'Tab' && event.shiftKey) {
        inControls = true
        return
      }
      const focused = document.activeElement
      const hasFocus = focused instanceof HTMLElement && focused !== document.body
      if (event.key === 'Escape') {
        inControls = false
        if (hasFocus) focused.blur()
        setKeypad(KEYPAD_IDLE)
        setHelp(false)
        return
      }
      if (inControls && hasFocus) return
      inControls = false
      const key = keypadKey(event)
      if (!key) return
      event.preventDefault()
      // Un toque en la pantalla pudo dejar el foco en un botón: que Enter no lo vuelva a apretar.
      if (hasFocus) focused.blur()
      if (event.repeat && key.kind !== 'move') return
      // La ayuda del teclado no frena a nadie: la tecla la cierra y hace lo suyo.
      setHelp(false)
      unlock()
      // Cualquier tecla dice «ya lo vi»: el cartel se va, la comanda sigue marcada.
      setAlarm(null)
      const result = keypadPress(keypadRef.current, key, Date.now())
      keypadRef.current = result.state
      setKeypad(result.state)
      actRef.current(result.action)
    }
    const onPointerDown = () => {
      inControls = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [unlock])

  // ── Lo que entra: suena, se anuncia a pantalla completa y queda marcado ────
  const [arriving, setArriving] = useState<ReadonlySet<string>>(NONE)
  const [alarm, setAlarm] = useState<Alarm | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { alarm: ring, nudge } = sound
  const viewKey = view.join(',')
  const known = useRef<{ view: string; ids: Map<string, Set<string>> | null }>({
    view: viewKey,
    ids: null,
  })
  const timers = useRef<number[]>([])
  const alarmCount = useRef(0)
  /** Cuándo entró (o creció) cada comanda en ESTA pantalla: hasta cuándo se insiste. */
  const arrivedAt = useRef(new Map<string, number>())
  useEffect(() => {
    // Cambiar de estaciones hace aparecer comandas que no entraron recién: no suenan.
    if (known.current.view !== viewKey) known.current = { view: viewKey, ids: null }
    const before = known.current.ids
    const after = new Map<string, Set<string>>()
    const fresh: { pane: BoardPane; card: KitchenCard }[] = []
    for (const pane of panes) {
      const cards = [...pane.wall, ...pane.done]
      const seen = before?.get(pane.station.id) ?? null
      // Una estación que recién aparece en pantalla tampoco suena: eso ya estaba.
      const ids = newArrivals(before === null ? null : (seen ?? new Set()), cards)
      for (const id of before !== null && seen === null ? [] : ids) {
        const card = cards.find((other) => other.id === id)
        if (card) fresh.push({ pane, card })
      }
      after.set(pane.station.id, knownTickets(cards))
    }
    known.current.ids = after
    if (fresh.length === 0) return
    const at = Date.now()
    const keys = fresh.map(({ pane, card }) => cardKey(pane.station.id, card.id))
    for (const key of keys) arrivedAt.current.set(key, at)
    setArriving((prev) => new Set([...prev, ...keys]))
    // La estación grande avisa con todo; las del costado, con un timbre y su panel marcado.
    const loudOnes = fresh.filter(({ pane }) => pane.main)
    if (loudOnes.length > 0) ring()
    else nudge()
    const shown = loudOnes.length > 0 ? loudOnes : fresh
    const grew = shown.every(({ card }) => card.grew)
    const names = shown.map(({ pane, card }) =>
      multi ? `${card.spoken} en ${pane.station.name}` : card.spoken,
    )
    setAnnouncement(`${grew ? 'Se sumó algo a' : 'Entró'} ${names.join(', ')}.`)
    if (loudOnes.length > 0) {
      alarmCount.current += 1
      setAlarm({
        key: alarmCount.current,
        titles: loudOnes.slice(0, 3).map(({ card }) => card.title),
        more: Math.max(0, loudOnes.length - 3),
        grew,
        station: multi ? (loudOnes[0]?.pane.station.name ?? null) : null,
      })
    }
    const timer = window.setTimeout(() => {
      setArriving((prev) => {
        const next = new Set(prev)
        for (const key of keys) next.delete(key)
        return next.size === 0 ? NONE : next
      })
    }, ARRIVAL_MS)
    timers.current.push(timer)
  }, [panes, viewKey, ring, nudge, multi])

  // El cartel se va solo.
  const alarmKey = alarm?.key
  useEffect(() => {
    if (alarmKey === undefined) return
    const timer = window.setTimeout(() => setAlarm(null), ALARM_MS)
    return () => window.clearTimeout(timer)
  }, [alarmKey])

  // Una comanda recién entrada que nadie empezó vuelve a sonar un par de veces.
  const queuedKeys = useMemo(
    () =>
      panes
        .flatMap((pane) =>
          pane.wall
            .filter((card) => card.status === 'queued')
            .map((card) => cardKey(pane.station.id, card.id)),
        )
        .join('|'),
    [panes],
  )
  const waitingToStart = queuedKeys === '' ? 0 : queuedKeys.split('|').length
  useEffect(() => {
    if (queuedKeys === '') return
    const keys = queuedKeys.split('|')
    const timer = window.setInterval(() => {
      const fresh = keys.some((key) => {
        const at = arrivedAt.current.get(key)
        return at !== undefined && Date.now() - at < NUDGE_FOR_MS
      })
      if (fresh && !document.hidden) nudge()
    }, NUDGE_MS)
    return () => window.clearInterval(timer)
  }, [queuedKeys, nudge])

  // Si la pestaña quedó atrás, el título avisa cuántas esperan.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s+/, '')
    document.title = waitingToStart > 0 ? `(${waitingToStart}) ${base}` : base
    return () => {
      document.title = base
    }
  }, [waitingToStart])

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      if (ackTimer.current !== null) window.clearTimeout(ackTimer.current)
    },
    [],
  )

  // ── «Cocina lo vio» ────────────────────────────────────────────────────────
  const reported = useRef(new Set<string>())
  const acknowledges = isKitchen || !screen.list
  useEffect(() => {
    if (document.hidden || !acknowledges) return
    const cards = panes.flatMap((pane) => [...pane.wall, ...pane.done])
    const ids = [...new Set(unseenTickets(cards, reported.current))]
    if (ids.length === 0) return
    for (const id of ids) reported.current.add(id)
    void onShown(ids).then((ok) => {
      if (!ok) for (const id of ids) reported.current.delete(id)
    })
  }, [panes, onShown, acknowledges])

  // ── Lo demás ───────────────────────────────────────────────────────────────
  const failureKey = failure?.key
  const failedStation = failure?.station
  const failedCard = failure?.cardId
  useEffect(() => {
    if (failureKey === undefined) return
    // El marco vuelve a la comanda que no se pudo mover: «probá de nuevo» tiene que caer sobre la misma.
    if (failedStation !== undefined && failedCard) select(failedStation, failedCard)
    setLast(null)
    const timer = window.setTimeout(onDismissFailure, FAILURE_MS)
    return () => window.clearTimeout(timer)
  }, [failureKey, failedStation, failedCard, select, onDismissFailure])

  // En el celular la comanda enmarcada siempre queda a la vista. Al abrir no se corre nada.
  const shownFrame = useRef<string | null | undefined>(undefined)
  const frameKey = selectedId === null ? null : cardKey(focusId, selectedId)
  useEffect(() => {
    const first = shownFrame.current === undefined
    if (shownFrame.current === frameKey) return
    shownFrame.current = frameKey
    if (first || !selectedId || !screen.list) return
    root.current
      ?.querySelector<HTMLElement>(
        `[data-pane="${CSS.escape(focusId)}"] [data-card="${CSS.escape(selectedId)}"]`,
      )
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [frameKey, selectedId, focusId, screen.list])

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

  // ── La barra del teclado: qué está enmarcado y qué hace cada tecla ─────────
  const forward = current ? advanceTarget(current.status) : null
  const back = current ? undoTarget(current.status) : null
  const canUndoLast = last !== null
  const currentCode = current
    ? ((codes.get(focusId)?.get(current.id) ?? current.title) as string)
    : null
  const others = focusPane ? panes.filter((pane) => pane.station.id !== focusPane.station.id) : []
  const currentItems = current
    ? current.lines.flatMap((line) => (line.status === 'served' ? [] : line.itemIds))
    : []

  const onSelectCard = useCallback(
    (station: string, cardId: string) => {
      select(station, cardId)
      setKeypad(KEYPAD_IDLE)
    },
    [select],
  )
  const handlers = useRef({ stepForward, stepBack, onMove, paneById })
  handlers.current = { stepForward, stepBack, onMove, paneById }
  const onAdvanceCard = useCallback((station: string, cardId: string) => {
    const pane = handlers.current.paneById.get(station)
    const card =
      pane?.wall.find((other) => other.id === cardId) ??
      pane?.done.find((other) => other.id === cardId)
    if (pane && card) handlers.current.stepForward(pane, card)
  }, [])
  const onLine = useCallback((station: string, cardId: string, line: CardLine) => {
    if (line.status === 'served') return
    const done = line.status === 'ready'
    handlers.current.onMove({
      itemIds: line.itemIds,
      to: done ? 'preparing' : 'ready',
      station,
      cardId,
      what: `${done ? 'volver atrás' : 'marcar listo'} ${line.quantity} ${line.name}`,
    })
    setLast(null)
  }, [])
  const onDropItems = (payload: DragPayload, stationId: string) => {
    const to = paneById.get(stationId)?.station
    if (to) reroute(payload, payload.station, to)
  }
  const onPromote = (stationId: string) => onView(promoteStation(view, stationId, queue.stations))

  const SoundIcon = soundIcon(sound.state, sound.level)
  const soundNote =
    sound.state === 'locked'
      ? 'Tocá una tecla para activar el sonido'
      : sound.justActivated && sound.state === 'on'
        ? 'Sonido activado'
        : null
  const loud = sound.state !== 'muted' && sound.level === 'loud'
  const scale = DENSITIES[density] ?? 1
  const unit = screen.unit ?? 1
  const single = !multi ? (panes[0]?.station ?? null) : null

  return (
    <div
      ref={root}
      className="kds"
      data-mode={screen.list ? 'list' : multi ? 'pass' : 'solo'}
      data-panes={Math.min(panes.length, 4)}
      data-alert={loud ? 'loud' : undefined}
      style={{
        ...(screen.unit === null ? null : { ['--u' as string]: `${screen.unit}px` }),
        ['--d' as string]: String(scale),
      }}
      onPointerDownCapture={() => {
        sound.unlock()
        if (alarm) setAlarm(null)
      }}
    >
      <h1 className="sr-only">Cocina · {queue.branch.name}</h1>

      {/* Sin conexión, toda la franja de arriba es el cartel: no corre las comandas de lugar y no se puede
          no ver. */}
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
                    <span aria-hidden>‹ </span>
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

            {/* Qué muestra esta pantalla: una estación, o todas a la vez (el pase). Queda guardado en el
                dispositivo y en la dirección, que es la que se copia para armar cada monitor. */}
            {queue.stations.length > 1 ? (
              <nav className="kds-views" aria-label="Qué muestra esta pantalla">
                {queue.stations.map((station) => {
                  const on = single?.id === station.id
                  return (
                    <button
                      key={station.id}
                      type="button"
                      className="kds-view"
                      aria-pressed={on}
                      style={{ ['--st' as string]: station.color }}
                      onClick={() => onView([station.id])}
                    >
                      <span aria-hidden>{stationIcon(station)}</span>
                      {station.name}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="kds-view is-all"
                  aria-pressed={multi}
                  onClick={() => onView([])}
                >
                  <LayoutPanelLeft aria-hidden strokeWidth={2.4} />
                  El pase
                </button>
              </nav>
            ) : (
              <span />
            )}
          </>
        )}

        <div className="kds-tools">
          {screen.list ? null : (
            <button
              type="button"
              className="kds-tool"
              aria-expanded={help}
              aria-label="Qué hace cada tecla del teclado numérico"
              title="Qué hace cada tecla"
              onClick={() => setHelp((open) => !open)}
              data-testid="cocina-teclas"
            >
              <Keyboard aria-hidden strokeWidth={2.4} />
            </button>
          )}
          <fieldset className="kds-size">
            <legend className="sr-only">Tamaño de la letra: {DENSITY_WORD[density]}</legend>
            <button
              type="button"
              className="kds-tool"
              onClick={() => changeDensity(-1)}
              disabled={density === 0}
              aria-label="Letra más chica: entran más comandas"
              title="Letra más chica: entran más comandas"
            >
              <AArrowDown aria-hidden strokeWidth={2.4} />
            </button>
            <button
              type="button"
              className="kds-tool"
              onClick={() => changeDensity(1)}
              disabled={density === DENSITIES.length - 1}
              aria-label="Letra más grande"
              title="Letra más grande"
            >
              <AArrowUp aria-hidden strokeWidth={2.4} />
            </button>
          </fieldset>
          <button
            type="button"
            className="kds-tool"
            data-state={sound.state}
            data-level={sound.level}
            aria-label={soundLabel(sound.state, sound.level)}
            disabled={sound.state === 'none'}
            onClick={sound.cycle}
            data-testid="cocina-sonido"
          >
            <SoundIcon aria-hidden strokeWidth={2.4} />
            <span>{soundWord(sound.state, sound.level)}</span>
          </button>
          {tools}
        </div>
      </header>

      {help && !screen.list ? <KeypadHelp multi={multi} onClose={() => setHelp(false)} /> : null}

      <main className="kds-panes">
        {panes.map((pane) => {
          const id = pane.station.id
          const prefix = `${id}:`
          const paneArriving =
            arriving.size === 0
              ? NONE
              : new Set(
                  [...arriving]
                    .filter((key) => key.startsWith(prefix))
                    .map((key) => key.slice(prefix.length)),
                )
          return (
            <PassPane
              key={id}
              pane={pane}
              codes={codes.get(id) ?? new Map()}
              now={now}
              settings={queue.settings}
              unit={unit}
              scale={scale * (pane.main || screen.list ? 1 : SIDE_SCALE)}
              focused={id === focusId}
              selectedId={id === focusId ? selectedId : null}
              ackId={ack?.startsWith(prefix) ? ack.slice(prefix.length) : null}
              arriving={paneArriving}
              list={screen.list}
              multi={multi}
              onFocus={focusPaneById}
              onSelect={onSelectCard}
              onAdvance={onAdvanceCard}
              onLine={onLine}
              onDropItems={onDropItems}
              onPromote={onPromote}
            />
          )
        })}
      </main>

      {/* La barra del teclado: lo tecleado, la comanda enmarcada y qué hace cada tecla. Con el mouse o el
          dedo, las mismas teclas son botones. */}
      <footer className="kds-bar" data-typing={typed ? 'true' : undefined}>
        <p
          className="kds-typed"
          data-empty={typed || miss ? undefined : 'true'}
          data-miss={miss ? 'true' : undefined}
          aria-hidden
        >
          {miss ? miss.typed : typed || (currentCode ?? '—')}
        </p>
        {current && focusPane ? (
          <>
            <p className="kds-bar-what">
              {miss ? (
                <b>No está en {focusPane.station.name}</b>
              ) : (
                <>
                  {multi ? <span>{focusPane.station.name}</span> : null}
                  <b>{current.titleFit === 'small' ? current.title : `Mesa ${current.title}`}</b>
                  <span>{current.grew ? GREW_LABEL : CARD_STATUS_LABEL[current.status]}</span>
                </>
              )}
            </p>
            <div className="kds-keys">
              <button
                type="button"
                className={cn('kds-key is-enter', forward && `to-${forward}`)}
                disabled={!forward}
                onClick={() => stepForward(focusPane, current)}
              >
                <kbd>
                  <CornerDownLeft aria-hidden strokeWidth={3} />
                  <span className="sr-only">Enter</span>
                </kbd>
                {forward === 'preparing' ? 'Empezar' : forward === 'ready' ? 'Listo' : 'Ya salió'}
              </button>
              {current.status === 'queued' ? (
                <button
                  type="button"
                  className="kds-key to-ready"
                  onClick={() => straightToReady(focusPane, current)}
                >
                  <kbd>+</kbd>
                  Listo ya
                </button>
              ) : null}
              <button
                type="button"
                className="kds-key is-back"
                disabled={!back && !canUndoLast}
                onClick={() => {
                  if (!undoLast()) stepBack(focusPane, current)
                }}
              >
                <kbd>−</kbd>
                {canUndoLast ? (
                  <>
                    <Undo2 aria-hidden strokeWidth={3} />
                    Deshacer la {last?.title}
                  </>
                ) : back ? (
                  <>Volver a {CARD_STATUS_LABEL[back as CardStatus].toLowerCase()}</>
                ) : (
                  'Atrás'
                )}
              </button>
              {others.length > 0 && currentItems.length > 0 ? (
                <span className="kds-pass-to">
                  <span>Pasar a</span>
                  {others.map((pane) => (
                    <button
                      key={pane.station.id}
                      type="button"
                      className="kds-key is-pass"
                      style={{ ['--st' as string]: pane.station.color }}
                      onClick={() =>
                        reroute(
                          { itemIds: currentItems, label: current.spoken },
                          focusPane.station.id,
                          pane.station,
                        )
                      }
                      aria-label={`Pasar ${current.spoken} a ${pane.station.name}`}
                    >
                      <span aria-hidden>{stationIcon(pane.station)}</span>
                      {pane.station.name}
                      <ArrowRight aria-hidden strokeWidth={3} />
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="kds-bar-what is-idle">
            <b>Sin comandas</b>
            <span>
              <Check aria-hidden strokeWidth={3} /> Cuando entre una: el número de la mesa y Enter.
            </span>
          </p>
        )}
        {brand ? <PosBrand brand={brand} className="kds-brand" /> : null}
      </footer>

      {soundNote ? (
        <p className="kds-sound-note" role="status">
          <SoundIcon aria-hidden strokeWidth={2.6} />
          {soundNote}
        </p>
      ) : null}

      {/* Entró una comanda: no se puede no ver. No tapa los botones ni recibe toques; el lector de
          pantalla lo oye por el aviso de abajo. */}
      {alarm ? (
        <div
          className="kds-alarm"
          key={alarm.key}
          data-level={loud ? 'loud' : 'soft'}
          data-testid="cocina-alarma"
          aria-hidden
        >
          <p className="kds-alarm-card">
            <span className="kds-alarm-word">
              <BellRing aria-hidden strokeWidth={2.8} />
              {alarm.grew
                ? GREW_LABEL
                : alarm.titles.length > 1
                  ? 'Comandas nuevas'
                  : 'Comanda nueva'}
              {alarm.station ? ` · ${alarm.station}` : ''}
            </span>
            <span className="kds-alarm-tables">
              {alarm.titles.map((title) => (
                <b key={title} data-long={title.length > 3 ? 'true' : undefined}>
                  {title}
                </b>
              ))}
              {alarm.more > 0 ? <em>+{alarm.more}</em> : null}
            </span>
          </p>
        </div>
      ) : null}

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
