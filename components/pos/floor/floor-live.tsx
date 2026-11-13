'use client'

import { ChevronDown, LayoutList, Map as MapIcon, SquareDashed, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { refreshFloor, setActiveBranch } from '@/lib/pos/actions'
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
import { FloorModel, type FloorTable, STATE_ICON } from './floor-model'
import { OpenTableSheet } from './open-table-sheet'

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

function summaryLine(s: ReturnType<typeof summarize>): string {
  const parts = [
    `${s.open} de ${s.tables} mesas`,
    `${s.people} ${s.people === 1 ? 'persona' : 'personas'}`,
  ]
  if (s.ready > 0) parts.push(`${s.ready} para llevar`)
  if (s.waitingFood > 0) parts.push(`${s.waitingFood} esperando comida`)
  if (s.bill > 0) parts.push(`${s.bill} ${s.bill === 1 ? 'pidió' : 'pidieron'} la cuenta`)
  if (s.late > 0) parts.push(`${s.late} con demora`)
  return parts.join(' · ')
}

export function FloorLive({ slug, initial, branches, timeZone, canEditPlan }: Props) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState(initial)
  const [view, setView] = useState<View>('model')
  const [areaId, setAreaId] = useState<string | null>(initial.areas[0]?.id ?? null)
  const [opening, setOpening] = useState<TableEntry | null>(null)
  const [switching, startSwitch] = useTransition()
  const [branchMenu, setBranchMenu] = useState(false)
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

  const byId = useMemo(() => new Map(entries.map((e) => [e.tableId, e])), [entries])
  const onTable = useCallback(
    (tableId: string) => {
      const entry = byId.get(tableId)
      if (!entry) return
      if (entry.session) router.push(`/${slug}/salon/mesa/${entry.session.id}`)
      else setOpening(entry)
    },
    [byId, router, slug],
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

  return (
    <div className="pos-floor-screen" style={{ ['--branch' as string]: snapshot.branch.color }}>
      <header className="pos-band">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="pos-band-branch"
            onClick={() => branches.length > 1 && setBranchMenu((v) => !v)}
            aria-haspopup={branches.length > 1 ? 'true' : undefined}
            aria-expanded={branches.length > 1 ? branchMenu : undefined}
            disabled={switching}
          >
            <span className="truncate">{snapshot.branch.name}</span>
            {branches.length > 1 ? (
              <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
            ) : null}
          </button>
          <span
            className={cn('pos-live', live === 'live' && 'is-live', live === 'offline' && 'is-off')}
            role="status"
          >
            {live === 'offline' ? (
              <WifiOff className="size-3.5" aria-hidden />
            ) : (
              <span className="pos-live-dot" aria-hidden />
            )}
            {live === 'live' ? 'En vivo' : live === 'offline' ? 'Sin conexión' : 'Conectando'}
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums opacity-90">{clock}</span>
        </div>
        <p className="pos-band-summary">
          {empty ? 'Todavía no hay mesas en esta sucursal.' : summaryLine(summary)}
        </p>

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
      </header>

      {empty ? (
        <div className="pos-empty">
          <SquareDashed className="size-10 opacity-60" aria-hidden />
          <h2>Armá el salón de {snapshot.branch.name}</h2>
          <p>
            El mapa se dibuja una vez: los sectores, las mesas y cuántos entran en cada una.
            Después, acá vas a ver en vivo qué le pasa a cada mesa.
          </p>
          {canEditPlan ? (
            <Link href={`/${slug}/local/mesas`} className="pos-btn pos-btn-primary">
              Dibujar el plano
            </Link>
          ) : (
            <p className="text-sm opacity-80">Pedile al dueño que lo arme desde el panel.</p>
          )}
        </div>
      ) : (
        <>
          <div className="pos-tabs" role="tablist" aria-label="Sectores">
            {snapshot.areas.map((area) => {
              const selected = view !== 'list' && area.id === activeArea?.id
              const pending = pendingByArea[area.id] ?? 0
              return (
                <button
                  key={area.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn('pos-tab', selected && 'is-active')}
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

          {view === 'list' ? (
            <ul className="pos-list">
              {listed.map((entry) => {
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
                          {who ?? (entry.state.key === 'free' ? 'Libre' : 'Mesa abierta')}
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
              label={`${activeArea?.name ?? 'Salón'}: ${areaElements.filter((e) => e.kind === 'table').length} mesas`}
            />
          )}

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
        </>
      )}

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
