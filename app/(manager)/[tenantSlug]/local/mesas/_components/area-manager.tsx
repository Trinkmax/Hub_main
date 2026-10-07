'use client'

import { ChevronDown, ChevronUp, Plus, Settings2, Trash2 } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Field, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Separator } from '@/components/ui/separator'
import {
  createAreaAction,
  deleteAreaAction,
  renameAreaAction,
  reorderAreasAction,
  updateAreaCanvasAction,
} from '@/lib/floor-plan/actions'
import type { AreaRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'

type AreaManagerProps = {
  slug: string
  areas: AreaRow[]
  activeAreaId: string
  onActiveAreaChange: (id: string) => void
  onChanged: () => void
}

/**
 * Las áreas del plano (pisos o salones): cuál se edita, el orden, el nombre,
 * el tamaño del lienzo y la numeración. Es una tarjeta del costado del editor
 * (arriba en pantallas angostas).
 *
 * El área que se edita es «dónde estoy» (kit §3.0): fondo `--selected` + barra
 * de 2 px, como el ítem activo del menú.
 */
export function AreaManager({
  slug,
  areas,
  activeAreaId,
  onActiveAreaChange,
  onChanged,
}: AreaManagerProps) {
  const baseId = useId()
  const [pending, start] = useTransition()
  // «Nueva área»
  const [newName, setNewName] = useState('')
  const [newNameError, setNewNameError] = useState<string | null>(null)
  const [newStart, setNewStart] = useState<number | null>(1)
  // Edición en línea de un área
  const [editingId, setEditingId] = useState<string | null>(null)

  const onCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newName.trim()
    if (name.length === 0) {
      setNewNameError('Poné un nombre para el área.')
      return
    }
    start(async () => {
      const r = await createAreaAction(slug, {
        name,
        number_start: newStart ?? 0,
      })
      if (r.ok) {
        toast.success('Área creada.')
        setNewName('')
        setNewStart(1)
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

  const titleId = `${baseId}-titulo`

  return (
    <Card padding="sm" asChild>
      <section aria-labelledby={titleId}>
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="type-subtitle text-foreground">
            Áreas
          </h2>
          <p className="type-small text-pretty text-muted-foreground">
            Cada piso o salón tiene su plano. Elegí cuál querés editar.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-1 xl:gap-4">
          <ul className="flex flex-col gap-1">
            {areas.map((area, index) => {
              const isActive = area.id === activeAreaId
              const isEditing = editingId === area.id
              const editorId = `${baseId}-editar-${area.id}`
              return (
                <li key={area.id} className="flex flex-col">
                  <div className="flex items-center gap-1 pointer-coarse:gap-2">
                    <button
                      type="button"
                      onClick={() => onActiveAreaChange(area.id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'relative flex min-h-8 min-w-0 flex-1 items-center rounded-md px-2.5 text-start type-body pointer-coarse:min-h-11',
                        'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
                        isActive
                          ? 'bg-selected font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                      )}
                    >
                      {isActive ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary forced-colors:bg-[Highlight]"
                        />
                      ) : null}
                      <span className="truncate">{area.name}</span>
                    </button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending || index === 0}
                      onClick={() => onReorder(index, -1)}
                      aria-label={`Subir ${area.name}`}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending || index === areas.length - 1}
                      onClick={() => onReorder(index, 1)}
                      aria-label={`Bajar ${area.name}`}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setEditingId(isEditing ? null : area.id)}
                      aria-label={`Editar ${area.name}`}
                      aria-expanded={isEditing}
                      aria-controls={isEditing ? editorId : undefined}
                    >
                      <Settings2 aria-hidden />
                    </Button>
                  </div>

                  {isEditing ? (
                    <AreaEditor
                      id={editorId}
                      slug={slug}
                      area={area}
                      areas={areas}
                      activeAreaId={activeAreaId}
                      onActiveAreaChange={onActiveAreaChange}
                      onChanged={onChanged}
                      onClose={() => setEditingId(null)}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>

          {/* Crear área */}
          <form
            onSubmit={onCreate}
            aria-label="Nueva área"
            className="flex flex-col gap-3 border-t border-border pt-4 md:border-t-0 md:pt-0 xl:border-t xl:pt-4"
          >
            <Field label="Nueva área" error={newNameError}>
              <Input
                value={newName}
                maxLength={40}
                onChange={(e) => {
                  setNewName(e.target.value)
                  if (newNameError) setNewNameError(null)
                }}
                placeholder="Planta baja, Terraza…"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Numerar mesas desde"
              required
              hint="Las mesas nuevas de esta área arrancan en este número."
            >
              <NumberField min={0} max={100000} value={newStart} onValueChange={setNewStart} />
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={pending}
              loadingText="Creando…"
              className="self-start"
            >
              <Plus aria-hidden />
              Crear área
            </Button>
          </form>
        </div>
      </section>
    </Card>
  )
}

/**
 * Edición en línea de un área: nombre, lienzo y numeración con un solo
 * «Guardar» (renombra y cambia el lienzo solo si cambiaron), y «Borrar área».
 */
function AreaEditor({
  id,
  slug,
  area,
  areas,
  activeAreaId,
  onActiveAreaChange,
  onChanged,
  onClose,
}: {
  id: string
  slug: string
  area: AreaRow
  areas: AreaRow[]
  activeAreaId: string
  onActiveAreaChange: (id: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [name, setName] = useState(area.name)
  const [nameError, setNameError] = useState<string | null>(null)
  // El último número que vale de cada campo, o null.
  const [width, setWidth] = useState<number | null>(area.width)
  const [height, setHeight] = useState<number | null>(area.height)
  const [numberStart, setNumberStart] = useState<number | null>(area.number_start)

  const onSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('El nombre no puede quedar vacío.')
      return
    }
    const nameChanged = trimmed !== area.name
    const canvasChanged =
      width !== area.width || height !== area.height || numberStart !== area.number_start
    if (!nameChanged && !canvasChanged) {
      onClose()
      return
    }
    start(async () => {
      if (nameChanged) {
        const r = await renameAreaAction(slug, { id: area.id, name: trimmed })
        if (!r.ok) {
          toast.error(r.message)
          return
        }
      }
      if (canvasChanged) {
        const r = await updateAreaCanvasAction(slug, {
          id: area.id,
          width: width ?? 0,
          height: height ?? 0,
          number_start: numberStart ?? 0,
        })
        if (!r.ok) {
          toast.error(r.message)
          // El nombre sí quedó guardado: que se vea.
          if (nameChanged) onChanged()
          return
        }
      }
      toast.success('Área actualizada.')
      onClose()
      onChanged()
    })
  }

  // Espera con el diálogo abierto y, si el server no deja (tiene mesas, es la única), muestra por qué.
  const onDelete = async (): Promise<ConfirmResult> => {
    const r = await deleteAreaAction(slug, area.id)
    if (!r.ok) return r
    toast.success('Área borrada.')
    if (area.id === activeAreaId) {
      const next = areas.find((a) => a.id !== area.id)
      if (next) onActiveAreaChange(next.id)
    }
    onChanged()
  }

  return (
    <form
      id={id}
      onSubmit={onSave}
      aria-label={`Editar ${area.name}`}
      className="mt-2 mb-2 flex flex-col gap-3 border-t border-border pt-3"
    >
      <Field label="Nombre" error={nameError}>
        <Input
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value)
            if (nameError) setNameError(null)
          }}
          autoComplete="off"
        />
      </Field>
      <div className="flex flex-col gap-1">
        <FieldRow>
          <Field label="Ancho" required>
            <NumberField
              min={200}
              max={6000}
              steppers={false}
              value={width}
              onValueChange={setWidth}
            />
          </Field>
          <Field label="Alto" required>
            <NumberField
              min={200}
              max={6000}
              steppers={false}
              value={height}
              onValueChange={setHeight}
            />
          </Field>
        </FieldRow>
        <p className="type-caption text-pretty text-subtle-foreground">
          El tamaño del lienzo, de 200 a 6.000.
        </p>
      </div>
      <Field
        label="Numerar mesas desde"
        required
        hint="Por ejemplo, 101 para que la planta alta empiece en la mesa 101."
      >
        <NumberField min={0} max={100000} value={numberStart} onValueChange={setNumberStart} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending} loadingText="Guardando…">
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
      <Separator />
      <ConfirmDialog
        tone="danger"
        icon={Trash2}
        title={`¿Borrar el área «${area.name}»?`}
        description="Se borra su decoración. No se puede borrar si tiene mesas activas ubicadas ni si es la única área."
        confirmLabel="Borrar área"
        pendingLabel="Borrando…"
        onConfirm={onDelete}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="danger-ghost"
            disabled={pending}
            className="self-start"
          >
            <Trash2 aria-hidden />
            Borrar área
          </Button>
        }
      />
    </form>
  )
}
