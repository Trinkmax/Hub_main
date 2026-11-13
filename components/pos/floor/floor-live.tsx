'use client'

import {
  AlarmClock,
  ChevronDown,
  LayoutList,
  Map as MapIcon,
  SquareDashed,
  WifiOff,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { planHref } from '@/lib/floor-plan/branches'
import { moveTable, refreshFloor, setActiveBranch } from '@/lib/pos/actions'
import {
  attentionRank,
  deriveFreeState,
  deriveSessionState,
  formatMinutes,
  needsAttention,
  reservationForTable,
  STATE_LABEL,
  serviceMinutesAt,
  summarize,
  type TableState,
} from '@/lib/pos/table-state'
import type { FloorSession, FloorSnapshot, PosBranch } from '@/lib/pos/types'
import { usePosPoke } from '@/lib/pos/use-poke'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { cn } from '@/lib/utils'
import { PosOutboxRunner } from '../order/outbox-runner'
import { PosTopbar } from '../ui/pos-topbar'
import { FloorModel, type FloorTable, STATE_ICON } from './floor-model'
import { OpenTableSheet } from './open-table-sheet'
import '../ui/pos-toast.css'

/**
 * El salón en vivo de una sucursal: la pantalla de inicio del mozo.
 *
 * Arriba, dónde estás y el salón en una línea. Después un sector por vez, con
 * cuántas mesas tienen algo pendiente en cada pestaña. Tocar una mesa libre la
 * abre (dos toques); tocar una ocupada entra a su pedido.
 */

type View = 'model' | 'plan' | 'list'
const VIEW_KEY = 'hub:pos:view'

type TableEntry = {
  tableId: string
  label: string
  capacity: number | null
  areaId: string | null
  session: FloorSession | null
  state: TableState
}

type Props = {
  slug: string
  initial: FloorSnapshot
  branches: PosBranch[]
  timeZone: string
  canEditPlan: boolean
  /** Puede abrir y mover mesas (el salón); la cocina solo mira. */
  canOperate: boolean
  /** Mesa (sesión) que llega pidiendo cambiar de lugar: «Cambiar de mesa» desde la comanda. */
  initialMove?: string | null
  /** El botón de la cuenta, armado en la página. */
  account?: React.ReactNode
}

/** Una mesa levantada, esperando a dónde va. */
type Moving = { sessionId: string; fromTableId: string; label: string }

/** Lo que se puede aislar tocando una ficha del resumen. */
type FocusKey = 'ready' | 'bill' | 'kitchen' | 'late'

function matchesFocus(state: TableState, key: FocusKey): boolean {
  return key === 'late' ? state.urgency === 'late' : state.key === key
}

function useNow(serverNow: string): number {
  // El reloj del celular puede estar corrido: se usa la hora de la base y se la hace avanzar acá.
  const offset = useRef(Date.parse(serverNow) - Date.now())
  const [now, setNow] = useState(() => Date.parse(serverNow))
  useEffect(() => {
    offset.current = Date.parse(serverNow) - Date.now()
    setNow(Date.now() + offset.current)
  }, [serverNow])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offset.current), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function FloorLive({
  slug,
  initial,
  branches,
  timeZone,
  canEditPlan,
  canOperate,
  initialMove = null,
  account,
}: Props) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState(initial)
  const [view, setView] = useState<View>('model')
  const [areaId, setAreaId] = useState<string | null>(initial.areas[0]?.id ?? null)
  const [opening, setOpening] = useState<TableEntry | null>(null)
  const [switching, startSwitch] = useTransition()
  const [branchMenu, setBranchMenu] = useState(false)
  const [focus, setFocus] = useState<FocusKey | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  const now = useNow(snapshot.now)

  useEffect(() => setSnapshot(initial), [initial])
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === 'model' || saved === 'plan' || saved === 'list') setView(saved)
    } catch {
      // sin almacenamiento (modo privado): arranca en maqueta
    }
  }, [])
  const chooseView = (next: View) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // idem
    }
  }

  const inFlight = useRef(false)
  const reload = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const result = await refreshFloor(slug, snapshot.branch.id)
      if (result.ok) setSnapshot(result.data)
    } finally {
      inFlight.current = false
    }
  }, [slug, snapshot.branch.id])
  const reloadSoon = useDebouncedRefresh(reload, 220)
  const live = usePosPoke(snapshot.branch.id, reloadSoon)
  // Red de seguridad: si un aviso en vivo se pierde, igual se pone al día.
  useVisibleInterval(reload, 40_000)

  const nowService = useMemo(() => serviceMinutesAt(new Date(now), timeZone), [now, timeZone])

  const entries = useMemo<TableEntry[]>(() => {
    const byTable = new Map<string, FloorSession>()
    for (const session of snapshot.sessions) {
      if (session.table_id) byTable.set(session.table_id, session)
    }
    const build = (
      tableId: string,
      label: string,
      capacity: number | null,
      area: string | null,
    ): TableEntry => {
      const session = byTable.get(tableId) ?? null
      const state = session
        ? deriveSessionState(session, now, snapshot.settings)
        : deriveFreeState(reservationForTable(label, snapshot.reservations, nowService))
      return { tableId, label, capacity, areaId: area, session, state }
    }
    const placed = snapshot.elements
      .filter((el) => el.kind === 'table' && el.table_id)
      .map((el) => build(el.table_id as string, el.table_label ?? '', el.capacity, el.area_id))
    const loose = snapshot.loose_tables.map((t) => build(t.id, t.label, t.capacity, null))
    return [...placed, ...loose]
  }, [snapshot, now, nowService])

  const summary = useMemo(
    () =>
      summarize(entries.map((e) => ({ state: e.state, partySize: e.session?.party_size ?? null }))),
    [entries],
  )

  const pendingByArea = useMemo(() => {
    const out: Record<string, number> = {}
    for (const entry of entries) {
      if (entry.areaId && needsAttention(entry.state))
        out[entry.areaId] = (out[entry.areaId] ?? 0) + 1
    }
    return out
  }, [entries])

  const activeArea = snapshot.areas.find((a) => a.id === areaId) ?? snapshot.areas[0] ?? null
  const areaElements = useMemo(
    () => (activeArea ? snapshot.elements.filter((el) => el.area_id === activeArea.id) : []),
    [snapshot.elements, activeArea],
  )
  const tables = useMemo(() => {
    const out: Record<string, FloorTable> = {}
    for (const entry of entries) {
      out[entry.tableId] = {
        state: entry.state,
        partySize: entry.session?.party_size ?? null,
        alias: entry.session?.alias ?? null,
      }
    }
    return out
  }, [entries])

  const areaName = useMemo(
    () => Object.fromEntries(snapshot.areas.map((a) => [a.id, a.name])) as Record<string, string>,
    [snapshot.areas],
  )
  const byId = useMemo(() => new Map(entries.map((e) => [e.tableId, e])), [entries])

  // ── Cambiar una mesa de lugar ──
  // Se levanta manteniéndola apretada (o con «Cambiar de mesa» desde la comanda) y va a una libre.
  const holdable = useMemo(
    () => (canOperate ? new Set(entries.filter((e) => e.session).map((e) => e.tableId)) : null),
    [entries, canOperate],
  )
  const moveTargets = useMemo(
    () =>
      moving
        ? new Set(entries.filter((e) => !e.session && e.state.key === 'free').map((e) => e.tableId))
        : null,
    [entries, moving],
  )
  const startMove = useCallback(
    (tableId: string) => {
      const entry = byId.get(tableId)
      if (!entry?.session) return
      setFocus(null)
      setMoving({ sessionId: entry.session.id, fromTableId: tableId, label: entry.label })
    },
    [byId],
  )
  const sendTo = useCallback(
    async (sessionId: string, toTableId: string) => {
      // Se ve al instante; si la base dice que no, vuelve a como estaba.
      setSnapshot((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId ? { ...session, table_id: toTableId } : session,
        ),
      }))
      const result = await moveTable(slug, sessionId, toTableId)
      if (!result.ok) {
        toast.error(result.message)
        void reload()
      }
      return result.ok
    },
    [slug, reload],
  )
  const finishMove = useCallback(
    async (toTableId: string) => {
      if (!moving) return
      const target = byId.get(toTableId)
      if (!target || target.session || target.state.key !== 'free') return
      const { sessionId, fromTableId, label } = moving
      setMoving(null)
      const moved = await sendTo(sessionId, toTableId)
      if (!moved) return
      toast(`La mesa ${label} pasó a la ${target.label}`, {
        action: { label: 'Deshacer', onClick: () => void sendTo(sessionId, fromTableId) },
      })
    },
    [moving, byId, sendTo],
  )
  // La lista no tiene mesas para elegir con el dedo, y con Escape se sale.
  useEffect(() => {
    if (moving && view === 'list') setMoving(null)
  }, [moving, view])
  useEffect(() => {
    if (!moving) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving])
  // Si la mesa que se estaba moviendo se cerró o la movió otro, se suelta.
  useEffect(() => {
    if (!moving) return
    const still = byId.get(moving.fromTableId)?.session?.id === moving.sessionId
    if (!still) setMoving(null)
  }, [moving, byId])
  // «Cambiar de mesa» desde la comanda: llega con la mesa ya levantada, en su sector.
  const askedMove = useRef(initialMove)
  useEffect(() => {
    const sessionId = askedMove.current
    if (!sessionId || !canOperate) return
    askedMove.current = null
    const entry = entries.find((e) => e.session?.id === sessionId)
    if (!entry) return
    if (entry.areaId) setAreaId(entry.areaId)
    setView((current) => (current === 'list' ? 'model' : current))
    setMoving({ sessionId, fromTableId: entry.tableId, label: entry.label })
    // Que al recargar no vuelva a levantarla (sin cambiar de sucursal).
    router.replace(`/${slug}/salon/mapa?sucursal=${encodeURIComponent(snapshot.branch.slug)}`, {
      scroll: false,
    })
  }, [entries, canOperate, router, slug, snapshot.branch.slug])

  const onTable = useCallback(
    (tableId: string) => {
      const entry = byId.get(tableId)
      if (!entry) return
      if (moving) {
        if (tableId === moving.fromTableId) setMoving(null)
        else if (moveTargets?.has(tableId)) void finishMove(tableId)
        else toast('Esa mesa no está libre. Elegí una de las marcadas.')
        return
      }
      if (entry.session) router.push(`/${slug}/salon/mesa/${entry.session.id}`)
      else if (canOperate) setOpening(entry)
    },
    [byId, router, slug, moving, moveTargets, finishMove, canOperate],
  )

  const switchBranch = (branch: PosBranch) => {
    setBranchMenu(false)
    if (branch.id === snapshot.branch.id) return
    startSwitch(async () => {
      const result = await setActiveBranch(slug, branch.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      router.refresh()
    })
  }

  const listed = useMemo(() => {
    const scope = view === 'list' ? entries : []
    return [...scope].sort(
      (a, b) =>
        attentionRank(a.state) - attentionRank(b.state) ||
        a.label.localeCompare(b.label, 'es', { numeric: true }),
    )
  }, [entries, view])

  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat('es-AR', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(now)),
    [now, timeZone],
  )
  const empty = entries.length === 0

  const chips = (
    [
      { key: 'ready', count: summary.ready, label: 'para llevar', icon: STATE_ICON.ready },
      {
        key: 'bill',
        count: summary.bill,
        label: summary.bill === 1 ? 'pidió la cuenta' : 'pidieron la cuenta',
        icon: STATE_ICON.bill,
      },
      {
        key: 'kitchen',
        count: summary.waitingFood,
        label: 'esperando comida',
        icon: STATE_ICON.kitchen,
      },
      { key: 'late', count: summary.late, label: 'con demora', icon: AlarmClock },
    ] as const
  ).filter((chip) => chip.count > 0)

  // Si lo que estaba filtrando ya se resolvió, el filtro se va solo.
  const focusAlive = focus !== null && chips.some((chip) => chip.key === focus)
  useEffect(() => {
    if (focus !== null && !focusAlive) setFocus(null)
  }, [focus, focusAlive])

  const toggleFocus = (key: FocusKey) => {
    const next = focus === key ? null : key
    setFocus(next)
    if (!next || view === 'list') return
    // Si en este sector no hay ninguna, salta al primero que tenga.
    const here = entries.some((e) => e.areaId === activeArea?.id && matchesFocus(e.state, next))
    if (here) return
    const first = entries.find((e) => e.areaId && matchesFocus(e.state, next))
    if (first?.areaId) setAreaId(first.areaId)
  }

  const dimmed = useMemo(() => {
    // Moviendo una mesa, todo lo que no es la mesa ni un destino se apaga.
    if (moving && moveTargets) {
      return new Set(
        entries
          .filter((e) => e.tableId !== moving.fromTableId && !moveTargets.has(e.tableId))
          .map((e) => e.tableId),
      )
    }
    if (!focusAlive || focus === null) return null
    return new Set(entries.filter((e) => !matchesFocus(e.state, focus)).map((e) => e.tableId))
  }, [entries, focus, focusAlive, moving, moveTargets])

  const focusChip = focusAlive ? (chips.find((chip) => chip.key === focus) ?? null) : null
  const visibleList =
    focusAlive && focus !== null ? listed.filter((e) => matchesFocus(e.state, focus)) : listed
  const occupancy = `${summary.people} ${summary.people === 1 ? 'persona' : 'personas'} · ${summary.open} de ${summary.tables} mesas`

  return (
    <div className="pos-floor-screen" style={{ ['--branch' as string]: snapshot.branch.color }}>
      <PosTopbar account={account}>
        <div className="pos-top-branch-wrap">
          <button
            type="button"
            className="pos-top-branch"
            onClick={() => branches.length > 1 && setBranchMenu((v) => !v)}
            aria-haspopup={branches.length > 1 ? 'true' : undefined}
            aria-expanded={branches.length > 1 ? branchMenu : undefined}
            disabled={switching}
          >
            <span
              className={cn(
                'pos-top-dot',
                live === 'live' && 'is-live',
                live === 'offline' && 'is-off',
              )}
              aria-hidden
            />
            <span className="truncate">{snapshot.branch.short_name ?? snapshot.branch.name}</span>
            {branches.length > 1 ? (
              <ChevronDown className="size-4 shrink-0 opacity-80" aria-hidden />
            ) : null}
            <span className="sr-only">
              {live === 'live'
                ? ', en vivo'
                : live === 'offline'
                  ? ', sin conexión'
                  : ', conectando'}
            </span>
          </button>
          {branchMenu ? (
            <ul className="pos-branch-menu" aria-label="Sucursal">
              {branches.map((branch) => (
                <li key={branch.id}>
                  <button
                    type="button"
                    aria-current={branch.id === snapshot.branch.id ? 'true' : undefined}
                    onClick={() => switchBranch(branch)}
                    style={{ ['--branch' as string]: branch.color }}
                  >
                    <span className="pos-band-swatch" aria-hidden />
                    {branch.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {empty ? (
          <span className="pos-top-meta is-always">Sin mesas todavía</span>
        ) : (
          <div className="pos-top-tabs" role="tablist" aria-label="Sectores">
            {snapshot.areas.map((area) => {
              const selected = view !== 'list' && area.id === activeArea?.id
              const pending = pendingByArea[area.id] ?? 0
              return (
                <button
                  key={area.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn('pos-top-tab', selected && 'is-active')}
                  onClick={() => {
                    setAreaId(area.id)
                    if (view === 'list') chooseView('model')
                  }}
                >
                  {area.name}
                  {pending > 0 ? (
                    <span className="pos-tab-count">
                      {pending}
                      <span className="sr-only"> con algo pendiente</span>
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}

        {empty ? null : (
          <span className="pos-top-meta">
            {occupancy} · <b>{clock}</b>
          </span>
        )}
      </PosTopbar>

      {empty ? (
        <div className="pos-empty">
          <SquareDashed className="size-10 opacity-60" aria-hidden />
          <h2>Armá el salón de {snapshot.branch.name}</h2>
          <p>
            El mapa se dibuja una vez: los sectores, las mesas y cuántos entran en cada una.
            Después, acá vas a ver en vivo qué le pasa a cada mesa.
          </p>
          {canEditPlan ? (
            <Link href={planHref(slug, snapshot.branch.slug)} className="pos-btn pos-btn-primary">
              Dibujar el plano
            </Link>
          ) : (
            <p className="text-sm opacity-80">Pedile al dueño que lo arme desde el panel.</p>
          )}
        </div>
      ) : (
        <div className="pos-stage" data-view={view}>
          {view === 'list' ? (
            <ul className="pos-list">
              {visibleList.map((entry) => {
                const Icon = STATE_ICON[entry.state.key]
                const who =
                  entry.session?.alias ??
                  (entry.state.key === 'reserved' && entry.state.reservation
                    ? `${entry.state.reservation.time} · ${entry.state.reservation.name}`
                    : null)
                const people = entry.session?.party_size ?? entry.state.reservation?.guests ?? null
                return (
                  <li key={entry.tableId}>
                    <button
                      type="button"
                      className={cn(
                        'pos-row',
                        `pos-st-${entry.state.key}`,
                        entry.state.urgency === 'late' && 'pos-urg-late',
                      )}
                      onClick={() => onTable(entry.tableId)}
                    >
                      <span className="pos-row-num">{entry.label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="pos-row-who">
                          {who ??
                            (entry.state.key === 'free'
                              ? 'Libre'
                              : (areaName[entry.areaId ?? ''] ?? 'Sin nombre'))}
                          {people ? <em> ×{people}</em> : null}
                        </span>
                        {entry.state.nextCourseDue ? (
                          <span className="pos-row-note">Hay una tanda para marchar</span>
                        ) : null}
                      </span>
                      {entry.state.key !== 'free' ? (
                        <span className="pos-chip">
                          <Icon aria-hidden strokeWidth={2.4} />
                          {STATE_LABEL[entry.state.key]}
                          {entry.state.minutes !== null && entry.state.key !== 'reserved' ? (
                            <b>{formatMinutes(entry.state.minutes)}</b>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <FloorModel
              className="pos-floor-stage"
              elements={areaElements}
              tables={tables}
              view={view}
              onTable={onTable}
              insetBottom={68}
              dimmed={dimmed}
              holdable={holdable}
              onHold={startMove}
              move={
                moving && moveTargets ? { from: moving.fromTableId, targets: moveTargets } : null
              }
              onDrop={(tableId) => void finishMove(tableId)}
              label={`${activeArea?.name ?? 'Salón'}: ${areaElements.filter((e) => e.kind === 'table').length} mesas`}
            />
          )}

          {live === 'offline' ? (
            <p className="pos-offline" role="status">
              <WifiOff className="size-4" aria-hidden />
              Sin conexión: lo que ves puede estar viejo. Se pone al día sola cuando vuelva.
            </p>
          ) : null}

          {/* El resumen del salón, sobre el mapa: cada ficha cuenta y además filtra. */}
          {moving ? (
            <div className="pos-move" role="status">
              <p className="pos-move-text">
                <b>Mesa {moving.label}:</b>{' '}
                {moveTargets && moveTargets.size > 0
                  ? 'tocá la mesa libre a la que pasa, o arrastrala hasta ahí.'
                  : 'no hay ninguna mesa libre. Probá en otro sector.'}
              </p>
              <button type="button" className="pos-move-cancel" onClick={() => setMoving(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <p className={cn('pos-caption', focusChip && 'is-focus')}>
              {focusChip
                ? `Solo ${focusChip.count} ${focusChip.label}. Tocá la ficha de nuevo para ver todo.`
                : occupancy}
            </p>
          )}
          <div className="pos-hud">
            {chips.length > 0 ? (
              <div className="pos-hud-chips">
                {chips.map((chip) => {
                  const Icon = chip.icon
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      className={cn(
                        'pos-hud-chip',
                        `is-${chip.key}`,
                        focus === chip.key && 'is-on',
                      )}
                      aria-pressed={focus === chip.key}
                      onClick={() => toggleFocus(chip.key)}
                    >
                      <Icon aria-hidden strokeWidth={2.4} />
                      <b>{chip.count}</b>
                      <span>{chip.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <fieldset className="pos-view">
            <legend className="sr-only">Cómo ver el salón</legend>
            <button
              type="button"
              className={cn(view === 'model' && 'is-active')}
              aria-pressed={view === 'model'}
              onClick={() => chooseView('model')}
              title="Maqueta"
            >
              <CubeIcon />
              <span className="sr-only">Maqueta</span>
            </button>
            <button
              type="button"
              className={cn(view === 'plan' && 'is-active')}
              aria-pressed={view === 'plan'}
              onClick={() => chooseView('plan')}
              title="Plano"
            >
              <MapIcon className="size-4" aria-hidden />
              <span className="sr-only">Plano</span>
            </button>
            <button
              type="button"
              className={cn(view === 'list' && 'is-active')}
              aria-pressed={view === 'list'}
              onClick={() => chooseView('list')}
              title="Lista"
            >
              <LayoutList className="size-4" aria-hidden />
              <span className="sr-only">Lista</span>
            </button>
          </fieldset>
        </div>
      )}

      {/* Las tandas que quedaron sin enviar (sin señal) se siguen mandando desde el mapa. */}
      <PosOutboxRunner slug={slug} />

      <OpenTableSheet
        slug={slug}
        table={opening}
        reservations={snapshot.reservations}
        nowService={nowService}
        onClose={() => setOpening(null)}
        onOpened={(sessionId) => {
          setOpening(null)
          router.push(`/${slug}/salon/mesa/${sessionId}?nueva=1`)
        }}
      />
    </div>
  )
}

function CubeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Maqueta</title>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </svg>
  )
}
