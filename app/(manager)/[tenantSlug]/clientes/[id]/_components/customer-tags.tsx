'use client'

import { Plus } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { assignTag, createAndAssignTag, removeTag } from '@/lib/customers/actions'
import { TagPill } from '../../_components/tag-pill'

type Tag = { id: string; name: string; color: string }

const DEFAULT_COLOR = '#94a3b8'

/**
 * Las etiquetas del cliente, debajo del nombre en la ficha. Asignar y quitar
 * son optimistas (se ven al toque y vuelven atrás con un aviso si falla).
 *
 * Sigue siendo un Popover propio y no el Combobox múltiple del kit: la etiqueta
 * nueva se crea con un color elegido a mano, y el Combobox no tiene dónde.
 */
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
  const listLabelId = useId()

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
          <Button
            variant="secondary"
            size="sm"
            className="h-6 gap-1 rounded-full border-dashed px-2 type-caption font-medium text-muted-foreground"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Etiqueta
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" size="sm" className="p-0">
          {available.length > 0 ? (
            <div className="border-b border-border p-1">
              <p id={listLabelId} className="px-2 pt-1 pb-1.5 type-caption text-subtle-foreground">
                Asignar una del bar
              </p>
              <ul aria-labelledby={listLabelId} className="max-h-44 overflow-y-auto">
                {available.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => assign(t)}
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left type-body outline-(--ring) -outline-offset-2 hover:bg-accent focus-visible:outline-2 pointer-coarse:min-h-11"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
            className="grid gap-2 p-3"
          >
            <p className="type-label">Nueva etiqueta</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="size-(--control-sm) shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
                aria-label="Color de la etiqueta"
              />
              <Input
                size="sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre"
                maxLength={40}
                aria-label="Nombre de la etiqueta"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full"
              loading={pending}
              loadingText="Guardando…"
              disabled={!newName.trim()}
            >
              Crear y asignar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
