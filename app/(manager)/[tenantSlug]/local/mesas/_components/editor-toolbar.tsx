'use client'

import { Keyboard, Plus, QrCode, Redo2, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ModelGlyph, PlanGlyph, SplitGlyph } from './glyphs'
import { PAPEL } from './papel'
import { ShortcutList } from './shortcut-list'

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
  onAddTable: () => void
  /** «Agregar mesa» también se arrastra al plano. */
  onAddTablePointerDown: (e: React.PointerEvent) => void
  shouldSuppressClick: () => boolean
  /** El botón de «Varias mesas» con su ventanita. */
  bulk: React.ReactNode
  /** `null` = el bar no tiene prendidos los QR de mesa: no se ofrece imprimirlos. */
  qr: { ready: boolean; onPrint: () => void } | null
}

/**
 * Las herramientas del editor, en dos hojitas que flotan sobre el tablero: lo principal arriba a la
 * izquierda (agregar, deshacer) y cómo mirar arriba a la derecha. No ocupan una franja propia: el
 * plano llega hasta arriba y pasa por debajo. En un celular vuelven a ser una fila (ver el CSS).
 */
export function EditorToolbar({
  view,
  canSplit,
  onView,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddTable,
  onAddTablePointerDown,
  shouldSuppressClick,
  bulk,
  qr,
}: EditorToolbarProps) {
  // Sin ancho para partir, «plano y maqueta» se ve como plano.
  const shown: EditorView = view === 'split' && !canSplit ? 'plan' : view

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
      <div
        className="fpe-float fpe-float-add fpe-paper"
        role="group"
        aria-label="Agregar y deshacer"
      >
        <button
          type="button"
          className="fpe-btn fpe-btn-primary fpe-btn-sm fpe-btn-drag"
          title="Tocá para agregarla en el centro, o arrastrala al plano"
          onPointerDown={onAddTablePointerDown}
          onClick={() => {
            if (shouldSuppressClick()) return
            onAddTable()
          }}
        >
          <Plus aria-hidden />
          Agregar mesa
        </button>
        {bulk}
        <span className="fpe-toolbar-sep" aria-hidden />
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
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
      <div className="fpe-float fpe-float-view fpe-paper" role="group" aria-label="Ver e imprimir">
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
            className="fpe-btn fpe-btn-ghost fpe-btn-sm"
            disabled={!qr.ready}
            aria-label="Imprimir los QR de este sector"
            title={qr.ready ? 'Imprimir el QR de cada mesa de este sector' : 'Todavía no hay mesas'}
            onClick={qr.onPrint}
          >
            <QrCode aria-hidden />
            <span className="fpe-wide-only">Imprimir QR</span>
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
    </>
  )
}
