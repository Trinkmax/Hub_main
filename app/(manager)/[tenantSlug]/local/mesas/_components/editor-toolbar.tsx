'use client'

import { Keyboard, MapPin, Minus, Plus, QrCode, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { UnplacedTable } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import type { StageApi } from './editor-stage'
import { ModelGlyph, PlanGlyph, SplitGlyph } from './glyphs'
import { PAPEL } from './papel'
import { ShortcutList } from './shortcut-list'
import { UnplacedTray } from './unplaced-tray'

/** Cómo se mira el sector mientras se edita. */
export type EditorView = 'plan' | 'split' | 'model'

export type EditorToolbarProps = {
  view: EditorView
  /** Hay ancho para ver plano y maqueta a la vez: si no, la opción ni se ofrece. */
  canSplit: boolean
  onView: (view: EditorView) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** El sector de un vistazo: cuántas mesas dibujadas y cuántos lugares suman. */
  areaName: string
  tables: number
  seats: number
  /** Mesas de la sucursal que no están dibujadas en ningún sector. */
  unplaced: UnplacedTable[]
  onPlace: (tableId: string) => Promise<void>
  onDeleteTable: (tableId: string) => void
  /** El lienzo, para acercar y alejar. Mirando solo la maqueta no hay nada que acercar. */
  stage: React.RefObject<StageApi | null>
  zoomLabelRef: React.RefObject<HTMLSpanElement | null>
  /** `null` = el bar no tiene prendidos los QR de mesa: no se ofrece imprimirlos. */
  qr: { ready: boolean; onPrint: () => void } | null
}

/**
 * La fila de arriba del tablero, flotando sobre el plano. A la izquierda, lo que se sabe del sector
 * (deshacer, cuántas mesas y lugares, y las que faltan ubicar); a la derecha, cómo mirarlo (zoom,
 * plano o maqueta) y lo que se hace de vez en cuando (imprimir los QR, ver los atajos).
 *
 * Agregar cosas no está acá: está en la paleta del costado, que es de donde se arrastran.
 */
export function EditorToolbar({
  view,
  canSplit,
  onView,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  areaName,
  tables,
  seats,
  unplaced,
  onPlace,
  onDeleteTable,
  stage,
  zoomLabelRef,
  qr,
}: EditorToolbarProps) {
  // Sin ancho para partir, «plano y maqueta» se ve como plano.
  const shown: EditorView = view === 'split' && !canSplit ? 'plan' : view
  const [trayOpen, setTrayOpen] = useState(false)
  // Sin mesas por ubicar el botón desaparece: que la ventanita no reaparezca abierta la próxima vez.
  const anyUnplaced = unplaced.length > 0
  useEffect(() => {
    if (!anyUnplaced) setTrayOpen(false)
  }, [anyUnplaced])

  const summary =
    tables === 0
      ? 'Sin mesas todavía'
      : `${tables} ${tables === 1 ? 'mesa' : 'mesas'} · ${seats} ${seats === 1 ? 'lugar' : 'lugares'}`

  return (
    <div className="fpe-top">
      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
      <div className="fpe-float fpe-float-status fpe-paper" role="group" aria-label="El sector">
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Deshacer"
          title="Deshacer (Ctrl Z)"
        >
          <Undo2 aria-hidden />
        </button>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label="Rehacer"
          title="Rehacer (Ctrl Shift Z)"
        >
          <Redo2 aria-hidden />
        </button>
        <span className="fpe-toolbar-sep" aria-hidden />
        <p className="fpe-caption" title={`${areaName}: ${summary.toLowerCase()}`}>
          {summary}
        </p>
        {anyUnplaced ? (
          <Popover open={trayOpen} onOpenChange={setTrayOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="fpe-pending"
                title="Mesas que existen pero no están dibujadas en ningún sector"
              >
                <MapPin aria-hidden />
                {unplaced.length} sin ubicar
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} className={cn(PAPEL, 'fpe-pop')}>
              <UnplacedTray
                tables={unplaced}
                areaName={areaName}
                onPlace={onPlace}
                onDelete={onDeleteTable}
              />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
      <div className="fpe-float fpe-float-view fpe-paper" role="group" aria-label="Cómo mirarlo">
        {shown === 'model' ? null : (
          <>
            {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
            <div className="fpe-zoom" role="group" aria-label="Zoom del plano">
              <button
                type="button"
                onClick={() => stage.current?.zoomOut()}
                aria-label="Alejar"
                title="Alejar"
              >
                <Minus aria-hidden />
              </button>
              <button
                type="button"
                className="fpe-zoom-value"
                onClick={() => stage.current?.fit()}
                aria-label="Encajar el plano en la pantalla"
                title="Ver todo el piso (otro toque: acercar a las mesas)"
              >
                <span ref={zoomLabelRef}>100 %</span>
              </button>
              <button
                type="button"
                onClick={() => stage.current?.zoomIn()}
                aria-label="Acercar"
                title="Acercar"
              >
                <Plus aria-hidden />
              </button>
            </div>
            <span className="fpe-toolbar-sep" aria-hidden />
          </>
        )}

        <fieldset className="fpe-seg">
          <legend className="fpe-sr">Cómo ver el sector</legend>
          <button
            type="button"
            aria-pressed={shown === 'plan'}
            title="Ver el plano"
            onClick={() => onView('plan')}
          >
            <PlanGlyph />
            <span>Plano</span>
          </button>
          {canSplit ? (
            <button
              type="button"
              aria-pressed={shown === 'split'}
              title="Ver el plano y la maqueta a la vez"
              onClick={() => onView('split')}
            >
              <SplitGlyph />
              <span>Los dos</span>
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={shown === 'model'}
            title="Ver la maqueta, como la ve el salón"
            onClick={() => onView('model')}
          >
            <ModelGlyph />
            <span>Maqueta</span>
          </button>
        </fieldset>

        {qr ? (
          <button
            type="button"
            className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
            disabled={!qr.ready}
            aria-label="Imprimir los QR de este sector"
            title={qr.ready ? 'Imprimir el QR de cada mesa de este sector' : 'Todavía no hay mesas'}
            onClick={qr.onPrint}
          >
            <QrCode aria-hidden />
          </button>
        ) : null}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon fpe-keys-only"
              aria-label="Atajos del teclado"
              title="Atajos del teclado"
            >
              <Keyboard aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className={cn(PAPEL, 'fpe-pop')}>
            <div className="fpe-form">
              <h2 className="fpe-pop-title">Atajos del teclado</h2>
              <ShortcutList />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
