'use client'

import { ExternalLink, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FloorModel, STATE_ICON } from '@/components/pos/floor/floor-model'
import type { LiveEntry } from '@/lib/floor-plan/live-model'
import { liveSummaryLine } from '@/lib/floor-plan/live-model'
import { formatCentsShort } from '@/lib/money/format'
import { formatMinutes, STATE_LABEL, type TableStateKey } from '@/lib/pos/table-state'
import { cn } from '@/lib/utils'
import type { LiveModel } from './use-live-model'

export type LivePaneProps = {
  slug: string
  branch: { name: string; slug: string } | null
  /** El sector que se está mirando (el de las pestañas). */
  areaId: string
  areaName: string
  live: LiveModel
}

// Qué mide el reloj de cada estado.
const SINCE: Record<TableStateKey, string> = {
  free: '',
  reserved: 'Pasó la hora hace',
  seated: 'Sentados hace',
  kitchen: 'Esperando la comida hace',
  ready: 'Lista para llevar hace',
  eating: 'Última tanda hace',
  bill: 'Pidió la cuenta hace',
}

function TableCard({ entry, onClose }: { entry: LiveEntry; onClose: () => void }) {
  const { state, session } = entry
  const Icon = STATE_ICON[state.key]
  const late = state.urgency === 'late'
  const reservation = state.reservation

  return (
    <div className="fpe-live-card fpe-paper fpe-ui" role="status">
      <div className="fpe-live-card-head">
        <h3>Mesa {entry.label}</h3>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X aria-hidden />
        </button>
      </div>
      <span className={cn('fpe-statechip', `pos-st-${state.key}`, late && 'pos-urg-late')}>
        <Icon aria-hidden strokeWidth={2.4} />
        {STATE_LABEL[state.key]}
        {late ? ' · demorada' : ''}
      </span>
      <dl className="fpe-live-facts">
        {session?.alias ? (
          <div>
            <dt>A nombre de</dt>
            <dd>{session.alias}</dd>
          </div>
        ) : null}
        {session?.party_size ? (
          <div>
            <dt>Son</dt>
            <dd>
              {session.party_size} {session.party_size === 1 ? 'persona' : 'personas'}
            </dd>
          </div>
        ) : null}
        {session && state.minutes !== null ? (
          <div>
            <dt>{SINCE[state.key]}</dt>
            <dd>{formatMinutes(state.minutes)}</dd>
          </div>
        ) : null}
        {session ? (
          <div>
            <dt>Lleva pedido</dt>
            <dd>{formatCentsShort(session.total_cents)}</dd>
          </div>
        ) : null}
        {state.heldTickets > 0 ? (
          <div>
            <dt>Tandas en espera</dt>
            <dd>{state.heldTickets}</dd>
          </div>
        ) : null}
        {!session && reservation ? (
          <div>
            <dt>{state.key === 'reserved' ? 'Reserva' : 'Próxima reserva'}</dt>
            <dd>
              {reservation.time} · {reservation.name} ×{reservation.guests}
            </dd>
          </div>
        ) : null}
        {!session && entry.capacity ? (
          <div>
            <dt>Entran</dt>
            <dd>{entry.capacity}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

/**
 * «En vivo»: el dueño mira su salón con la misma maqueta que usa el mozo y los
 * estados reales (nadie los marca: salen de las comandas). Es para mirar: abrir
 * una mesa, cargar un pedido o cobrar se hace en el salón.
 */
export function LivePane({ slug, branch, areaId, areaName, live }: LivePaneProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  const elements = useMemo(
    () => (live.snapshot ? live.snapshot.elements.filter((el) => el.area_id === areaId) : []),
    [live.snapshot, areaId],
  )
  const opened = openId ? (live.entries.find((e) => e.tableId === openId) ?? null) : null

  // Otra pestaña de sector: la ficha de la mesa anterior ya no viene al caso.
  // biome-ignore lint/correctness/useExhaustiveDependencies: areaId es el disparador
  useEffect(() => {
    setOpenId(null)
  }, [areaId])

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  if (!live.snapshot) {
    return live.error ? (
      <div className="fpe-empty">
        <h2>No pude leer el salón</h2>
        <p>{live.error}</p>
        <button type="button" className="fpe-btn fpe-btn-quiet" onClick={() => void live.reload()}>
          Probar de nuevo
        </button>
      </div>
    ) : (
      <p className="fpe-loading" role="status">
        Mirando el salón…
      </p>
    )
  }

  const tableCount = elements.filter((el) => el.kind === 'table' && el.table_id).length
  const salonHref = `/${slug}/salon/mapa${branch ? `?sucursal=${encodeURIComponent(branch.slug)}` : ''}`

  return (
    <div className="fpe-live">
      <div className="fpe-live-bar fpe-paper">
        <span
          className={cn(
            'fpe-live-pill',
            live.connection === 'live' && 'is-live',
            live.connection === 'offline' && 'is-off',
          )}
          role="status"
        >
          {live.connection === 'offline' ? (
            <WifiOff aria-hidden />
          ) : (
            <span className="fpe-live-dot" aria-hidden />
          )}
          {live.connection === 'live'
            ? 'En vivo'
            : live.connection === 'offline'
              ? 'Sin conexión'
              : 'Conectando'}
        </span>
        <p className="fpe-live-summary">
          {live.summary && live.summary.tables > 0
            ? liveSummaryLine(live.summary)
            : 'Todavía no hay mesas en esta sucursal.'}
        </p>
        <a
          className="fpe-btn fpe-btn-quiet fpe-btn-sm"
          href={salonHref}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink aria-hidden />
          Abrir el salón
        </a>
      </div>

      <div className="fpe-pane fpe-live-stage">
        <FloorModel
          className="fpe-model"
          elements={elements}
          tables={live.tables}
          view="model"
          onTable={setOpenId}
          label={`${areaName} en vivo: ${tableCount} ${tableCount === 1 ? 'mesa' : 'mesas'}`}
        />
        {tableCount === 0 ? (
          <p className="fpe-model-empty">
            Este sector todavía no tiene mesas. Pasá a Editar para dibujarlas.
          </p>
        ) : null}
        {opened ? <TableCard entry={opened} onClose={() => setOpenId(null)} /> : null}
      </div>
    </div>
  )
}
