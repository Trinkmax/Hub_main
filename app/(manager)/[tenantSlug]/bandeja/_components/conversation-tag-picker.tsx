'use client'

import { Tag } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Gestionar etiquetas"
        >
          <Tag className="size-3.5" />
          Etiquetas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Etiquetas</p>
        </div>

        {allTags.length === 0 && !showCreate ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            Sin etiquetas todavía.
          </p>
        ) : (
          <ul className="max-h-52 overflow-y-auto py-1">
            {allTags.map((tag) => {
              const checked = selected.has(tag.id)
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary/40',
                      checked && 'bg-secondary/20',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(tag.id)}
                      aria-label={tag.name}
                      className="pointer-events-none"
                    />
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Inline create */}
        {showCreate ? (
          <form action={createAction} className="border-t border-border/60 px-3 py-2 space-y-2">
            <input type="hidden" name="color" value={newColor} />
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="size-6 shrink-0 rounded cursor-pointer border border-border/60 bg-transparent p-0"
                aria-label="Color de etiqueta"
              />
              <input
                name="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre…"
                maxLength={40}
                className="flex-1 rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
              />
            </div>
            {'ok' in createState && !createState.ok && (
              <p className="text-[10px] text-destructive">{createState.message}</p>
            )}
            <div className="flex gap-1.5">
              <Button
                type="submit"
                size="sm"
                className="h-6 flex-1 text-[11px]"
                disabled={creating || !newName.trim()}
              >
                {creating ? 'Guardando…' : 'Crear'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
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
          <div className="border-t border-border/60 px-3 py-2">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              + Nueva etiqueta
            </button>
          </div>
        )}

        {/* Footer: apply */}
        {hasChanges && (
          <div className="border-t border-border/60 px-3 py-2">
            <Button size="sm" className="h-7 w-full text-xs" onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Aplicar'}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
