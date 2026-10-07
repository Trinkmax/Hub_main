'use client'

import { ArrowDownToLine, ArrowUpToLine, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  deleteDecorAction,
  setElementZIndexAction,
  updateDecorAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { KIND_LABELS, KIND_WITH_ARTICLE } from './element-labels'

type DecorInspectorProps = {
  slug: string
  element: ElementRow
  onChanged: () => void
  onClose: () => void
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const HEX_ERROR = 'Usá un color de 6 dígitos con #, por ejemplo #4f7d58.'

/** Panel de la decoración elegida (pared, barra, columna…): etiqueta, color, orden y borrar. */
export function DecorInspector({ slug, element, onChanged, onClose }: DecorInspectorProps) {
  const titleId = useId()
  const [label, setLabel] = useState(element.label ?? '')
  const [color, setColor] = useState(element.color ?? '')
  const [pending, start] = useTransition()

  // Re-sincroniza si cambia el elemento seleccionado (clave: element.id).
  // El cuerpo solo lee label/color, pero element.id es el disparador intencional
  // del re-sync al cambiar de elemento (mismos valores en otro elemento ≠ mismo draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.id dispara el re-sync a propósito
  useEffect(() => {
    setLabel(element.label ?? '')
    setColor(element.color ?? '')
  }, [element.id, element.label, element.color])

  const colorRef = useRef<HTMLInputElement>(null)
  const colorInvalid = color.trim().length > 0 && !HEX_RE.test(color.trim())
  const kindLabel = KIND_LABELS[element.kind]
  const deleteTitle = `¿Borrar ${KIND_WITH_ARTICLE[element.kind]}${
    element.label ? ` «${element.label}»` : ''
  }?`

  const onSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // El error ya se ve al lado del campo: se lleva el foco ahí.
    if (colorInvalid) {
      colorRef.current?.focus()
      return
    }
    start(async () => {
      const r = await updateDecorAction(slug, {
        id: element.id,
        label: label.trim().length > 0 ? label.trim() : null,
        color: color.trim().length > 0 ? color.trim() : null,
      })
      if (r.ok) {
        toast.success('Decoración actualizada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onZIndex = (zIndex: number) => {
    start(async () => {
      const r = await setElementZIndexAction(slug, element.id, zIndex)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  // Espera con el diálogo abierto y, si falla, muestra el error adentro.
  const onDelete = async (): Promise<ConfirmResult> => {
    const r = await deleteDecorAction(slug, element.id)
    if (!r.ok) return { ok: false, error: r.message }
    toast.success('Decoración borrada.')
    onChanged()
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="min-w-0 truncate type-subtitle text-foreground">
          {kindLabel}
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Cerrar el panel de la decoración"
          className="-my-1"
        >
          <X aria-hidden />
        </Button>
      </div>

      <form onSubmit={onSave} className="flex flex-col gap-3">
        <Field label="Etiqueta" optional>
          <Input
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Color"
          optional
          hint={colorInvalid ? undefined : 'Vacío: el color de siempre del plano.'}
          error={colorInvalid ? HEX_ERROR : null}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir el color en la paleta"
              className="size-(--control-md) shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
              value={HEX_RE.test(color.trim()) ? color.trim() : '#888888'}
              onChange={(e) => setColor(e.target.value)}
            />
            {/* El campo de texto es el control del Field: toma su etiqueta, ayuda y error. */}
            <Input
              ref={colorRef}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#4f7d58"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
        </Field>

        <Button type="submit" size="sm" loading={pending} loadingText="Guardando…">
          Guardar
        </Button>
        <p className="type-caption text-pretty text-subtle-foreground">
          El tamaño se cambia arrastrando las manijas del elemento en el plano.
        </p>
      </form>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={pending}
        >
          <ArrowUpToLine aria-hidden />
          Al frente
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={pending}
        >
          <ArrowDownToLine aria-hidden />
          Al fondo
        </Button>
      </div>

      <Separator />

      <ConfirmDialog
        tone="danger"
        icon={Trash2}
        title={deleteTitle}
        description="Se borra del plano. No se puede deshacer."
        confirmLabel="Borrar"
        pendingLabel="Borrando…"
        onConfirm={onDelete}
        trigger={
          <Button type="button" size="sm" variant="danger-ghost" disabled={pending}>
            <Trash2 aria-hidden />
            Borrar {kindLabel.toLowerCase()}
          </Button>
        }
      />
    </section>
  )
}
