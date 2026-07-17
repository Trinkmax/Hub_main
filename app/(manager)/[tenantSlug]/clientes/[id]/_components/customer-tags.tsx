'use client'

import { Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { assignTag, createAndAssignTag, removeTag } from '@/lib/customers/actions'
import { TagPill } from '../../_components/tag-pill'

type Tag = { id: string; name: string; color: string }

const DEFAULT_COLOR = '#94a3b8'

export function CustomerTags({
  tenantSlug,
  customerId,
  currentTags,
  allTags,
}: {
  tenantSlug: string
  customerId: string
  currentTags: Tag[]
  allTags: Tag[]
}) {
  const [tags, setTags] = useState<Tag[]>(currentTags)
  // Etiquetas conocidas del bar; crece cuando creamos una nueva sin recargar.
  const [known, setKnown] = useState<Tag[]>(allTags)
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)

  const available = known.filter((t) => !tags.some((x) => x.id === t.id))

  const assign = (tag: Tag) => {
    if (tags.some((x) => x.id === tag.id)) return
    const previous = tags
    setTags([...tags, tag])
    setOpen(false)
    start(async () => {
      const result = await assignTag(tenantSlug, { customer_id: customerId, tag_id: tag.id })
      if (!result.ok) {
        setTags(previous)
        toast.error(result.message)
      }
    })
  }

  const remove = (tagId: string) => {
    const previous = tags
    setTags(tags.filter((t) => t.id !== tagId))
    start(async () => {
      const result = await removeTag(tenantSlug, { customer_id: customerId, tag_id: tagId })
      if (!result.ok) {
        setTags(previous)
        toast.error(result.message)
      }
    })
  }

  const create = () => {
    const name = newName.trim()
    if (!name || pending) return
    start(async () => {
      const result = await createAndAssignTag(tenantSlug, {
        customer_id: customerId,
        name,
        color: newColor,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const { tag } = result
      setKnown((k) => (k.some((t) => t.id === tag.id) ? k : [...k, tag]))
      setTags((cur) => (cur.some((t) => t.id === tag.id) ? cur : [...cur, tag]))
      setNewName('')
      setNewColor(DEFAULT_COLOR)
      setOpen(false)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
      {tags.map((t) => (
        <TagPill key={t.id} tag={t} onRemove={() => remove(t.id)} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed bg-transparent px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            aria-label="Agregar etiqueta"
          >
            <Plus className="size-3" />
            Etiqueta
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          {available.length > 0 ? (
            <ul className="max-h-44 overflow-y-auto border-b border-border/60 py-1">
              {available.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => assign(t)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-secondary/40"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: t.color }}
                      aria-hidden
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
            className="space-y-2 px-3 py-2.5"
          >
            <p className="text-[11px] font-semibold text-foreground">Nueva etiqueta</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="size-7 shrink-0 cursor-pointer rounded border border-border/60 bg-transparent p-0"
                aria-label="Color de la etiqueta"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre…"
                maxLength={40}
                className="h-8 flex-1 text-xs"
                aria-label="Nombre de la etiqueta"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="h-7 w-full text-[11px]"
              disabled={pending || !newName.trim()}
            >
              {pending ? 'Guardando…' : 'Crear y asignar'}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
