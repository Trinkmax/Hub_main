'use client'

import { ArrowDownToLine, ArrowUpToLine, Copy, RotateCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { updateDecorAction } from '@/lib/floor-plan/actions'
import { type ElementPatch, KIND_LABELS } from '@/lib/floor-plan/model'
import type { ElementRow } from '@/lib/floor-plan/queries'

export type DecorInspectorProps = {
  slug: string
  element: ElementRow
  /** Cambia al instante lo que se ve en el plano. */
  onPatch: (elementId: string, patch: ElementPatch) => void
  /** Sostiene el cambio por encima de un refresco mientras viaja al servidor (`null` = ya llegó). */
  onHold: (elementId: string, patch: ElementPatch | null) => void
  /** Guarda lo que haya pendiente de posición antes de hablar con el servidor. */
  flushGeometry: () => Promise<void>
  onRotate: () => void
  onDuplicate: () => void
  onFront: () => void
  onBack: () => void
  /** Quitar del plano (se puede deshacer). */
  onRemove: () => void
  onClose: () => void
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const SAVE_DELAY_MS = 450

// El color del material de cada pieza (lo que muestra el selector cuando el dueño no eligió ninguno).
const MATERIAL_HEX: Partial<Record<ElementRow['kind'], string>> = {
  bar: '#bda27d',
  wall: '#b6c4b7',
  pillar: '#b6c4b7',
  island: '#e3ded4',
  stage: '#e3ded4',
  booth: '#e3ded4',
}

// Qué es cada cosa y cómo la ve el salón, dicho en una línea.
const ABOUT: Partial<Record<ElementRow['kind'], string>> = {
  door: 'Ponele un nombre (por ejemplo «Entrada») y queda escrito en el mapa del salón.',
  text: 'Lo que escribas se ve como un cartel sobre el piso, también en el salón.',
  bar: 'Las banquetas se dibujan solas a lo largo de la barra.',
  wall: 'Estirala desde las manijas y girala para armar el contorno del sector.',
  stage: 'Una tarima baja: el escenario, o cualquier desnivel.',
}

/**
 * La ficha de lo que no es una mesa (pared, barra, columna, isla, puerta,
 * escenario, texto). El nombre y el color se guardan solos al escribir.
 *
 * Se monta con `key` = id del elemento: otro elemento, otra ficha.
 */
export function DecorInspector({
  slug,
  element,
  onPatch,
  onHold,
  flushGeometry,
  onRotate,
  onDuplicate,
  onFront,
  onBack,
  onRemove,
  onClose,
}: DecorInspectorProps) {
  const id = useId()
  const [label, setLabel] = useState(element.label ?? '')
  const [color, setColor] = useState(element.color ?? '')

  const saved = useRef({ label: element.label, color: element.color })
  const queued = useRef<{ label: string | null; color: string | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ slug, elementId: element.id, onPatch, onHold, flushGeometry })
  latest.current = { slug, elementId: element.id, onPatch, onHold, flushGeometry }

  const send = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = queued.current
    if (!next) return
    queued.current = null
    const ctx = latest.current
    await ctx.flushGeometry()
    const result = await updateDecorAction(ctx.slug, { id: ctx.elementId, ...next })
    if (result.ok) {
      saved.current = next
    } else {
      toast.error(result.message)
      ctx.onPatch(ctx.elementId, saved.current)
    }
    // Si mientras tanto llegó otro cambio, sigue en espera; si no, se suelta.
    if (!queued.current) ctx.onHold(ctx.elementId, null)
  }, [])

  const queue = useCallback(
    (next: { label: string | null; color: string | null }, delay: number) => {
      queued.current = next
      const ctx = latest.current
      ctx.onPatch(ctx.elementId, next)
      ctx.onHold(ctx.elementId, next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void send()
      }, delay)
    },
    [send],
  )

  // Si la ficha se cierra con algo sin mandar, se manda igual.
  useEffect(() => {
    return () => {
      if (queued.current) void send()
    }
  }, [send])

  const current = () => queued.current ?? saved.current
  const cleanColor = color.trim()
  const colorInvalid = cleanColor.length > 0 && !HEX_RE.test(cleanColor)

  const onLabel = (value: string) => {
    setLabel(value)
    const clean = value.trim()
    queue({ label: clean.length > 0 ? clean : null, color: current().color }, SAVE_DELAY_MS)
  }

  const onColor = (value: string) => {
    setColor(value)
    const clean = value.trim()
    if (clean.length > 0 && !HEX_RE.test(clean)) return
    queue({ label: current().label, color: clean.length > 0 ? clean : null }, SAVE_DELAY_MS)
  }

  const kind = element.kind
  const flat = kind === 'door' || kind === 'text'
  const about = ABOUT[kind]

  return (
    <>
      <div className="fpe-side-head">
        <h2 className="fpe-side-title">
          {KIND_LABELS[kind]}
          {about ? <span className="fpe-side-sub">{about}</span> : null}
        </h2>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          onClick={onClose}
          aria-label="Cerrar la ficha"
          title="Cerrar (Esc)"
        >
          <X aria-hidden />
        </button>
      </div>

      <div className="fpe-side-body">
        <div className="fpe-group">
          <div className="fpe-field">
            <label className="fpe-label" htmlFor={`${id}-label`}>
              {kind === 'text' ? 'Qué dice' : 'Nombre'}
            </label>
            <input
              id={`${id}-label`}
              className="fpe-input"
              value={label}
              maxLength={40}
              autoComplete="off"
              placeholder={
                kind === 'text'
                  ? 'Entrada, Baños, Cocina…'
                  : kind === 'door'
                    ? 'Entrada'
                    : 'Opcional'
              }
              onChange={(e) => onLabel(e.target.value)}
            />
          </div>

          {flat ? null : (
            <div className="fpe-field">
              <label className="fpe-label" htmlFor={`${id}-color`}>
                Color
              </label>
              <div className="fpe-color">
                <input
                  type="color"
                  aria-label="Elegir el color"
                  value={HEX_RE.test(cleanColor) ? cleanColor : (MATERIAL_HEX[kind] ?? '#e3ded4')}
                  onChange={(e) => onColor(e.target.value)}
                />
                <input
                  id={`${id}-color`}
                  className="fpe-input"
                  value={color}
                  autoComplete="off"
                  placeholder="El del material"
                  aria-invalid={colorInvalid ? true : undefined}
                  aria-describedby={`${id}-color-hint`}
                  onChange={(e) => onColor(e.target.value)}
                />
                {cleanColor ? (
                  <button
                    type="button"
                    className="fpe-btn fpe-btn-ghost fpe-btn-sm"
                    onClick={() => onColor('')}
                  >
                    Sacar
                  </button>
                ) : null}
              </div>
              {colorInvalid ? (
                <p className="fpe-error" id={`${id}-color-hint`} role="alert">
                  Escribilo como #4f7d58: numeral y seis letras o números.
                </p>
              ) : (
                <p className="fpe-hint" id={`${id}-color-hint`}>
                  El color se ve en este plano. La maqueta del salón dibuja todo en sus materiales.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="fpe-group">
          {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
          <div className="fpe-acts" data-cols="5" role="group" aria-label="Qué hacer con esto">
            <button
              type="button"
              className="fpe-act"
              onClick={onRotate}
              title="Girar un cuarto de vuelta (R)"
            >
              <RotateCw aria-hidden />
              Girar
            </button>
            <button
              type="button"
              className="fpe-act"
              onClick={onDuplicate}
              title="Duplicar (Ctrl D)"
            >
              <Copy aria-hidden />
              Duplicar
            </button>
            <button
              type="button"
              className="fpe-act"
              onClick={onFront}
              title="Traer al frente ( ] )"
            >
              <ArrowUpToLine aria-hidden />
              Frente
            </button>
            <button
              type="button"
              className="fpe-act"
              onClick={onBack}
              title="Mandar al fondo ( [ )"
            >
              <ArrowDownToLine aria-hidden />
              Fondo
            </button>
            <button
              type="button"
              className="fpe-act is-danger"
              onClick={onRemove}
              title="Quitar del plano (Supr)"
            >
              <Trash2 aria-hidden />
              Quitar
            </button>
          </div>
          <p className="fpe-hint">El tamaño se cambia estirando las manijas en el plano.</p>
        </div>
      </div>
    </>
  )
}
