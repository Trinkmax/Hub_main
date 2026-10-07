'use client'

import { Plus, Tag } from 'lucide-react'
import { useActionState, useEffect, useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  type ConversationTagActionState,
  createConversationTag,
  setConversationTags,
} from '@/lib/conversation-tags/actions'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import { cn } from '@/lib/utils'

const INITIAL_STATE: ConversationTagActionState = { ok: true }

export function ConversationTagPicker({
  tenantSlug,
  conversationId,
  allTags,
  assignedTagIds,
}: {
  tenantSlug: string
  conversationId: string
  allTags: ConversationTag[]
  assignedTagIds: string[]
}) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedTagIds))
  const [saving, startSaving] = useTransition()

  // Inline-create state
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#94a3b8')

  const [createState, createAction, creating] = useActionState<
    ConversationTagActionState,
    FormData
  >((prev, formData) => createConversationTag(tenantSlug, prev, formData), INITIAL_STATE)

  // Reset form after successful create
  useEffect(() => {
    if (createState.ok && showCreate) {
      setNewName('')
      setNewColor('#94a3b8')
      setShowCreate(false)
    }
  }, [createState, showCreate])

  function toggle(tagId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }

  function save() {
    startSaving(async () => {
      await setConversationTags(tenantSlug, conversationId, Array.from(selected))
    })
    setOpen(false)
  }

  const hasChanges =
    selected.size !== assignedTagIds.length ||
    assignedTagIds.some((id) => !selected.has(id)) ||
    Array.from(selected).some((id) => !assignedTagIds.includes(id))

  // Cerrar el popover guarda solo, como espera cualquiera: nada de cambios
  // perdidos en silencio por no tocar «Aplicar».
  function handleOpenChange(next: boolean) {
    if (!next && hasChanges) {
      startSaving(async () => {
        await setConversationTags(tenantSlug, conversationId, Array.from(selected))
      })
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* El ícono redondo del encabezado de WhatsApp. El foco es el contorno del
          panel (regla base), no un anillo de sombra. */}
      <PopoverTrigger
        aria-label="Etiquetas de la charla"
        title="Etiquetas de la charla"
        className="relative hit-area flex size-9 items-center justify-center rounded-full text-(--wa-text-soft) transition-colors hover:bg-(--wa-hover) hover:text-(--wa-text)"
      >
        <Tag className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" size="sm" className="p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="type-label text-foreground">Etiquetas de la charla</p>
        </div>

        {allTags.length === 0 && !showCreate ? (
          <p className="px-3 py-4 text-center type-small text-muted-foreground">
            Todavía no hay etiquetas. Creá la primera acá abajo.
          </p>
        ) : (
          <ul className="max-h-52 overflow-y-auto p-1">
            {allTags.map((tag) => {
              const checked = selected.has(tag.id)
              const checkboxId = `${baseId}-${tag.id}`
              return (
                <li key={tag.id}>
                  {/* La fila entera es la etiqueta de la casilla (sin un botón
                      adentro de otro, como antes). */}
                  <Label
                    htmlFor={checkboxId}
                    className={cn(
                      'flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 type-small font-normal hover:bg-hover pointer-coarse:min-h-11',
                      checked && 'bg-selected',
                    )}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      onCheckedChange={() => toggle(tag.id)}
                    />
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden
                    />
                    <span className="truncate">{tag.name}</span>
                  </Label>
                </li>
              )
            })}
          </ul>
        )}

        {/* Crear una etiqueta sin salir del chat */}
        {showCreate ? (
          <form action={createAction} className="space-y-2 border-t border-border px-3 py-2">
            <input type="hidden" name="color" value={newColor} />
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                aria-label="Color de la etiqueta"
              />
              <Input
                name="name"
                size="sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre de la etiqueta"
                aria-label="Nombre de la etiqueta"
                maxLength={40}
                autoFocus
              />
            </div>
            {'ok' in createState && !createState.ok ? (
              <p role="alert" className="type-caption text-destructive-text">
                {createState.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                className="flex-1"
                loading={creating}
                disabled={!newName.trim()}
              >
                Crear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreate(false)
                  setNewName('')
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowCreate(true)}
            >
              <Plus aria-hidden />
              Nueva etiqueta
            </Button>
          </div>
        )}

        {/* Pie: aplicar (cerrar el popover también guarda) */}
        {hasChanges ? (
          <div className="border-t border-border px-3 py-2">
            <Button size="sm" className="w-full" onClick={save} loading={saving}>
              Aplicar
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
