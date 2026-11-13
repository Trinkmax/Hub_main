'use client'

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Trash2,
  X,
} from 'lucide-react'
import type { UnplacedTable } from '@/lib/floor-plan/queries'
import type { AlignKind } from '@/lib/floor-plan/snap'
import { ShortcutList } from './shortcut-list'
import { UnplacedTray } from './unplaced-tray'

// ─── Nada elegido: el sector de un vistazo, lo que falta ubicar y cómo se usa ──

export type SectorPanelProps = {
  areaName: string
  tables: number
  seats: number
  unplaced: UnplacedTable[]
  onPlace: (tableId: string) => Promise<void>
  onDeleteTable: (tableId: string) => void
}

export function SectorPanel({
  areaName,
  tables,
  seats,
  unplaced,
  onPlace,
  onDeleteTable,
}: SectorPanelProps) {
  const summary =
    tables === 0
      ? 'Todavía sin mesas.'
      : `${tables} ${tables === 1 ? 'mesa' : 'mesas'} · ${seats} ${seats === 1 ? 'lugar' : 'lugares'}`

  return (
    <>
      <div className="fpe-side-head">
        <h2 className="fpe-side-title">
          {areaName}
          <span className="fpe-side-sub">{summary}</span>
        </h2>
      </div>
      <div className="fpe-side-body">
        <UnplacedTray
          tables={unplaced}
          areaName={areaName}
          onPlace={onPlace}
          onDelete={onDeleteTable}
        />
        <div className="fpe-group">
          <h3 className="fpe-group-title">Cómo se arma</h3>
          <p className="fpe-hint">
            Tocá una mesa para cambiarle el número, los lugares o la forma. Arrastrala para moverla:
            se imanta a la cuadrícula y a las otras mesas.
          </p>
        </div>
        <div className="fpe-group fpe-keys-only">
          <h3 className="fpe-group-title">Con el teclado</h3>
          <ShortcutList />
        </div>
      </div>
    </>
  )
}

// ─── Varios elegidos: alinear de una ─────────────────────────────────────────

const ALIGN: { kind: AlignKind; label: string; Icon: typeof X }[] = [
  { kind: 'left', label: 'A la izquierda', Icon: AlignStartVertical },
  { kind: 'hcenter', label: 'En columna', Icon: AlignCenterVertical },
  { kind: 'right', label: 'A la derecha', Icon: AlignEndVertical },
  { kind: 'top', label: 'Arriba', Icon: AlignStartHorizontal },
  { kind: 'vcenter', label: 'En fila', Icon: AlignCenterHorizontal },
  { kind: 'bottom', label: 'Abajo', Icon: AlignEndHorizontal },
]

export type GroupPanelProps = {
  count: number
  onAlign: (kind: AlignKind) => void
  onRemove: () => void
  onClose: () => void
}

export function GroupPanel({ count, onAlign, onRemove, onClose }: GroupPanelProps) {
  return (
    <>
      <div className="fpe-side-head">
        <h2 className="fpe-side-title">
          {count} elegidos
          <span className="fpe-side-sub">Arrastrá uno y se mueven todos juntos.</span>
        </h2>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          onClick={onClose}
          aria-label="Soltar la selección"
          title="Soltar la selección (Esc)"
        >
          <X aria-hidden />
        </button>
      </div>
      <div className="fpe-side-body">
        <div className="fpe-group">
          <h3 className="fpe-group-title">Alinear</h3>
          <div className="fpe-grid-2">
            {ALIGN.map(({ kind, label, Icon }) => (
              <button
                key={kind}
                type="button"
                className="fpe-btn fpe-btn-quiet fpe-btn-sm"
                onClick={() => onAlign(kind)}
              >
                <Icon aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="fpe-group">
          <button type="button" className="fpe-btn fpe-btn-danger fpe-btn-sm" onClick={onRemove}>
            <Trash2 aria-hidden />
            Quitar los {count} del plano
          </button>
        </div>
      </div>
    </>
  )
}
