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
import type { AlignKind } from '@/lib/floor-plan/snap'

// ─── Varios elegidos: alinear de una ─────────────────────────────────────────

const ALIGN: { kind: AlignKind; label: string; Icon: typeof X }[] = [
  { kind: 'left', label: 'Izquierda', Icon: AlignStartVertical },
  { kind: 'hcenter', label: 'Columna', Icon: AlignCenterVertical },
  { kind: 'right', label: 'Derecha', Icon: AlignEndVertical },
  { kind: 'top', label: 'Arriba', Icon: AlignStartHorizontal },
  { kind: 'vcenter', label: 'Fila', Icon: AlignCenterHorizontal },
  { kind: 'bottom', label: 'Abajo', Icon: AlignEndHorizontal },
]

export type GroupPanelProps = {
  count: number
  onAlign: (kind: AlignKind) => void
  onRemove: () => void
  onClose: () => void
}

/** La ficha de una selección de varios: se mueven juntos, se alinean o se quitan de una. */
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
          <h3 className="fpe-group-title" id="fpe-align-title">
            Alinear
          </h3>
          {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
          <div className="fpe-acts" data-cols="3" role="group" aria-labelledby="fpe-align-title">
            {ALIGN.map(({ kind, label, Icon }) => (
              <button key={kind} type="button" className="fpe-act" onClick={() => onAlign(kind)}>
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
