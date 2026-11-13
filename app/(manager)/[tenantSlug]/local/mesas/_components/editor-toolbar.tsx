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
  /** Hay ancho para ver plano y maqueta lado a lado. */
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

/** La barra del editor: lo principal a la izquierda (agregar), cómo mirar a la derecha. */
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
    // biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario
    <div className="fpe-toolbar fpe-paper" role="group" aria-label="Herramientas del plano">
      <div className="fpe-toolbar-group">
        <button
          type="button"
          className="fpe-btn fpe-btn-primary fpe-btn-drag"
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
      </div>

      <span className="fpe-toolbar-sep" aria-hidden />

      <div className="fpe-toolbar-group">
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-icon"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Deshacer"
          title="Deshacer (Ctrl Z)"
        >
          <Undo2 aria-hidden />
        </button>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-icon"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label="Rehacer"
          title="Rehacer (Ctrl Shift Z)"
        >
          <Redo2 aria-hidden />
        </button>
      </div>

      <span className="fpe-toolbar-spacer" />

      <fieldset className="fpe-seg">
        <legend className="fpe-sr">Cómo ver el sector</legend>
        <button type="button" aria-pressed={shown === 'plan'} onClick={() => onView('plan')}>
          <PlanGlyph />
          <span>Plano</span>
        </button>
        <button
          type="button"
          className="fpe-only-split"
          aria-pressed={shown === 'split'}
          onClick={() => onView('split')}
        >
          <SplitGlyph />
          <span>Plano y maqueta</span>
        </button>
        <button type="button" aria-pressed={shown === 'model'} onClick={() => onView('model')}>
          <ModelGlyph />
          <span>Maqueta</span>
        </button>
      </fieldset>

      {qr ? (
        <button
          type="button"
          className="fpe-btn fpe-btn-quiet"
          disabled={!qr.ready}
          title={qr.ready ? 'Imprimir el QR de cada mesa de este sector' : 'Todavía no hay mesas'}
          onClick={qr.onPrint}
        >
          <QrCode aria-hidden />
          Imprimir QR
        </button>
      ) : null}

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="fpe-btn fpe-btn-ghost fpe-btn-icon fpe-keys-only"
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
  )
}
