'use client'

import { Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { assignTag, removeTag } from '@/lib/customers/actions'
import { TagPill } from '../../_components/tag-pill'

type Tag = { id: string; name: string; color: string }

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
  const [tags, setTags] = useState(currentTags)
  const [pending, start] = useTransition()

  const available = allTags.filter((t) => !tags.find((x) => x.id === t.id))

  const onAdd = (tagId: string) => {
    const tag = allTags.find((t) => t.id === tagId)
    if (!tag) return
    const previous = tags
    setTags([...tags, tag])
    start(async () => {
      const result = await assignTag(tenantSlug, { customer_id: customerId, tag_id: tagId })
      if (!result.ok) {
        setTags(previous)
        toast.error(result.message)
      }
    })
  }

  const onRemove = (tagId: string) => {
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

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
      {tags.map((t) => (
        <TagPill key={t.id} tag={t} onRemove={() => onRemove(t.id)} />
      ))}
      {available.length > 0 ? (
        <Select onValueChange={onAdd} value="">
          <SelectTrigger className="h-6 w-auto gap-1 rounded-full border-dashed bg-transparent px-2 text-[11px] text-muted-foreground hover:bg-secondary/40">
            <Plus className="size-3" />
            <SelectValue placeholder="Etiqueta" />
          </SelectTrigger>
          <SelectContent>
            {available.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {tags.length === 0 && available.length === 0 ? (
        <span className="text-xs text-muted-foreground/70">Sin etiquetas creadas todavía.</span>
      ) : null}
    </div>
  )
}
