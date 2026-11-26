'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Qué hace cada tecla, con el teclado numérico dibujado.
 *
 * Cada estación marca los estados con un teclado numérico (`lib/pos/kitchen/keypad.ts`): acá se ve, tecla
 * por tecla, en el mismo lugar que la tiene en la mano. No tapa el trabajo: cualquier tecla lo cierra (y
 * hace lo suyo igual).
 */

type Tone = 'num' | 'go' | 'ready' | 'back' | 'soft' | 'off'

const KEYS: ReadonlyArray<{ area: string; glyph: string; label?: string; tone: Tone }> = [
  { area: 'lock', glyph: 'Bloq', tone: 'off' },
  { area: 'div', glyph: '÷', label: 'estación ‹', tone: 'soft' },
  { area: 'mul', glyph: '×', label: 'estación ›', tone: 'soft' },
  { area: 'sub', glyph: '−', label: 'atrás', tone: 'back' },
  { area: 'k7', glyph: '7', tone: 'num' },
  { area: 'k8', glyph: '8', tone: 'num' },
  { area: 'k9', glyph: '9', tone: 'num' },
  { area: 'add', glyph: '+', label: 'listo ya', tone: 'ready' },
  { area: 'k4', glyph: '4', tone: 'num' },
  { area: 'k5', glyph: '5', tone: 'num' },
  { area: 'k6', glyph: '6', tone: 'num' },
  { area: 'k1', glyph: '1', tone: 'num' },
  { area: 'k2', glyph: '2', tone: 'num' },
  { area: 'k3', glyph: '3', tone: 'num' },
  { area: 'ent', glyph: '↵', label: 'avanza', tone: 'go' },
  { area: 'k0', glyph: '0', tone: 'num' },
  { area: 'dot', glyph: '.', label: 'borra', tone: 'soft' },
]

export function KeypadHelp({
  multi,
  onClose,
}: {
  /** Hay varias estaciones en esta pantalla: ÷ y × cambian de estación. */
  multi: boolean
  onClose: () => void
}) {
  return (
    <aside className="kds-help" aria-label="Qué hace cada tecla del teclado numérico">
      <header>
        <b>El teclado de la estación</b>
        <button type="button" onClick={onClose} aria-label="Cerrar la ayuda del teclado">
          <X aria-hidden strokeWidth={2.6} />
        </button>
      </header>
      <p>
        Tipeá el <b>número de la mesa</b> y <b>Enter</b>: avanza un paso. Sin número, avanza la
        enmarcada.
      </p>
      <div className="kds-help-pad" aria-hidden>
        {KEYS.map((key) => (
          <span
            key={key.area}
            className={cn('kds-cap', `is-${key.tone}`)}
            style={{ gridArea: key.area }}
            data-dim={!multi && (key.area === 'div' || key.area === 'mul') ? '' : undefined}
          >
            <b>{key.glyph}</b>
            {key.label ? <small>{key.label}</small> : null}
          </span>
        ))}
      </div>
      <ul>
        <li>
          <kbd>↵</kbd> Nuevo → En preparación → Listo
        </li>
        <li>
          <kbd>+</kbd> Listo de una (una gaseosa, un café)
        </li>
        <li>
          <kbd>−</kbd> Un paso atrás, o deshace lo último
        </li>
        {multi ? (
          <li>
            <kbd>÷</kbd> <kbd>×</kbd> Pasa a la otra estación
          </li>
        ) : null}
        <li>
          <kbd>.</kbd> Borra lo tecleado · las flechas mueven el marco
        </li>
      </ul>
    </aside>
  )
}
