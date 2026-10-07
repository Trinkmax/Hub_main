'use client'

import { ChevronDown, ChevronUp, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
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
  createAreaAction,
  deleteAreaAction,
  renameAreaAction,
  reorderAreasAction,
  updateAreaCanvasAction,
} from '@/lib/floor-plan/actions'
import type { AreaRow } from '@/lib/floor-plan/queries'

type AreaManagerProps = {
  slug: string
  areas: AreaRow[]
  activeAreaId: string
  onActiveAreaChange: (id: string) => void
  onChanged: () => void
}

export function AreaManager({
  slug,
  areas,
  activeAreaId,
  onActiveAreaChange,
  onChanged,
}: AreaManagerProps) {
  const [pending, start] = useTransition()
  // Estado de "agregar área"
  const [newName, setNewName] = useState('')
  const [newStart, setNewStart] = useState('1')
  // Edición inline por área (renombrar + lienzo)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editWidth, setEditWidth] = useState('')
  const [editHeight, setEditHeight] = useState('')
  const [editStart, setEditStart] = useState('')

  const onCreate = () => {
    const name = newName.trim()
    if (name.length === 0) {
      toast.error('Poné un nombre para el área.')
      return
    }
    start(async () => {
      const r = await createAreaAction(slug, {
        name,
        number_start: Number(newStart) || 0,
      })
      if (r.ok) {
        toast.success('Área creada.')
        setNewName('')
        setNewStart('1')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const openEditor = (area: AreaRow) => {
    setEditingId(area.id)
    setEditName(area.name)
    setEditWidth(String(area.width))
    setEditHeight(String(area.height))
    setEditStart(String(area.number_start))
  }

  const onRename = (id: string) => {
    const name = editName.trim()
    if (name.length === 0) {
      toast.error('El nombre no puede estar vacío.')
      return
    }
    start(async () => {
      const r = await renameAreaAction(slug, { id, name })
      if (r.ok) {
        toast.success('Área renombrada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onSaveCanvas = (id: string) => {
    start(async () => {
      const r = await updateAreaCanvasAction(slug, {
        id,
        width: Number(editWidth) || 0,
        height: Number(editHeight) || 0,
        number_start: Number(editStart) || 0,
      })
      if (r.ok) {
        toast.success('Lienzo actualizado.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onReorder = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= areas.length) return
    const ids = areas.map((a) => a.id)
    const [moved] = ids.splice(index, 1)
    if (!moved) return
    ids.splice(target, 0, moved)
    start(async () => {
      const r = await reorderAreasAction(slug, ids)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const onDelete = (id: string) => {
    start(async () => {
      const r = await deleteAreaAction(slug, id)
      if (r.ok) {
        toast.success('Área borrada.')
        if (id === activeAreaId) {
          const next = areas.find((a) => a.id !== id)
          if (next) onActiveAreaChange(next.id)
        }
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <section
      aria-label="Áreas del plano"
      className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-card p-4"
    >
      <h2 className="font-display text-sm font-semibold">Áreas</h2>

      <ul className="grid gap-1.5">
        {areas.map((area, index) => {
          const isActive = area.id === activeAreaId
          const isEditing = editingId === area.id
          return (
            <li key={area.id} className="rounded-lg border">
              <div
                className={`flex items-center gap-1 rounded-t-lg px-2 py-1.5 ${
                  isActive ? 'bg-primary/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onActiveAreaChange(area.id)}
                  className={`flex-1 truncate text-left text-sm ${isActive ? 'font-semibold' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {area.name}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending || index === 0}
                  onClick={() => onReorder(index, -1)}
                  aria-label={`Subir ${area.name}`}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending || index === areas.length - 1}
                  onClick={() => onReorder(index, 1)}
                  aria-label={`Bajar ${area.name}`}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending}
                  onClick={() => (isEditing ? setEditingId(null) : openEditor(area))}
                  aria-label={`Editar ${area.name}`}
                >
                  <Settings2 className="size-3.5" />
                </Button>
              </div>

              {isEditing ? (
                <div className="grid gap-2 border-t p-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`area-name-${area.id}`} className="text-xs">
                      Nombre
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        id={`area-name-${area.id}`}
                        value={editName}
                        maxLength={40}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8 shrink-0"
                        disabled={pending}
                        onClick={() => onRename(area.id)}
                        aria-label="Guardar nombre"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    <div className="grid gap-1">
                      <Label htmlFor={`area-w-${area.id}`} className="text-xs">
                        Ancho
                      </Label>
                      <Input
                        id={`area-w-${area.id}`}
                        type="number"
                        min={200}
                        max={6000}
                        value={editWidth}
                        onChange={(e) => setEditWidth(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`area-h-${area.id}`} className="text-xs">
                        Alto
                      </Label>
                      <Input
                        id={`area-h-${area.id}`}
                        type="number"
                        min={200}
                        max={6000}
                        value={editHeight}
                        onChange={(e) => setEditHeight(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`area-n-${area.id}`} className="text-xs">
                        Desde N°
                      </Label>
                      <Input
                        id={`area-n-${area.id}`}
                        type="number"
                        min={0}
                        max={100000}
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        className="h-8"
                      />
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onSaveCanvas(area.id)}
                  >
                    Guardar lienzo
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={pending}>
                        <Trash2 className="size-3.5" />
                        Borrar área
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Borrar el área "{area.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se borran sus elementos de decoración. No se puede borrar si tiene mesas
                          activas ubicadas, ni si es la única área.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(area.id)}>
                          Borrar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <Separator />

      {/* Crear área */}
      <div className="grid gap-2">
        <Label htmlFor="new-area-name" className="text-xs">
          Nueva área
        </Label>
        <Input
          id="new-area-name"
          value={newName}
          maxLength={40}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Planta Baja, Terraza…"
          className="h-8"
        />
        <div className="grid gap-1">
          <Label htmlFor="new-area-start" className="text-xs">
            Numerar desde
          </Label>
          <Input
            id="new-area-start"
            type="number"
            min={0}
            max={100000}
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="h-8"
          />
        </div>
        <Button size="sm" onClick={onCreate} disabled={pending}>
          <Plus className="size-3.5" />
          Crear área
        </Button>
      </div>
    </section>
  )
}
