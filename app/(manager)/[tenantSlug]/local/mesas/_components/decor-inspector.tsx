'use client'

import { ArrowDownToLine, ArrowUpToLine, Trash2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  deleteDecorAction,
  setElementZIndexAction,
  updateDecorAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'

type DecorInspectorProps = {
  slug: string
  element: ElementRow
  onChanged: () => void
  onClose: () => void
}

const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
  door: 'Puerta',
  text: 'Texto',
  stage: 'Escenario',
  booth: 'Box',
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function DecorInspector({ slug, element, onChanged, onClose }: DecorInspectorProps) {
  const [label, setLabel] = useState(element.label ?? '')
  const [color, setColor] = useState(element.color ?? '')
  const [pending, start] = useTransition()

  // Re-sincroniza si cambia el elemento seleccionado (clave: element.id).
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.id es el disparador
  // intencional del re-sync al cambiar de elemento; el cuerpo solo lee label/color.
  useEffect(() => {
    setLabel(element.label ?? '')
    setColor(element.color ?? '')
  }, [element.id, element.label, element.color])

  const colorInvalid = color.trim().length > 0 && !HEX_RE.test(color.trim())

  const onSave = () => {
    if (colorInvalid) {
      toast.error('El color debe ser un hex de 6 dígitos (ej. #4f7d58).')
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

  const onDelete = () => {
    start(async () => {
      const r = await deleteDecorAction(slug, element.id)
      if (r.ok) {
        toast.success('Decoración borrada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <aside
      aria-label="Panel de decoración"
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">{KIND_LABELS[element.kind]}</h2>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="di-label">Etiqueta</Label>
        <Input
          id="di-label"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Opcional"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="di-color">Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Selector de color"
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            value={HEX_RE.test(color.trim()) ? color.trim() : '#888888'}
            onChange={(e) => setColor(e.target.value)}
          />
          <Input
            id="di-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#4f7d58 (opcional)"
            aria-invalid={colorInvalid}
          />
        </div>
        {colorInvalid ? (
          <p className="text-xs text-destructive">Usá un hex de 6 dígitos, ej. #4f7d58.</p>
        ) : null}
      </div>

      <Button size="sm" onClick={onSave} disabled={pending || colorInvalid}>
        {pending ? 'Guardando…' : 'Guardar'}
      </Button>

      <p className="text-xs text-muted-foreground">
        El tamaño se ajusta arrastrando los controladores del elemento en el plano.
      </p>

      <Separator />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={pending}
        >
          <ArrowUpToLine className="size-3.5" />
          Al frente
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={pending}
        >
          <ArrowDownToLine className="size-3.5" />
          Al fondo
        </Button>
      </div>

      <Separator />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            <Trash2 className="size-3.5" />
            Borrar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la decoración?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina del plano. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
