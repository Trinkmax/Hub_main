'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createItemTag,
  deleteItemTag,
  type TagActionState,
  toggleTagOnMenuItem,
} from '@/lib/item-tags/actions'
import type { ItemTagRow, ItemWithTags } from '@/lib/item-tags/queries'

const initial: TagActionState = { ok: false, message: '' }

export function TagsManager({
  tenantSlug,
  initialTags,
  initialItems,
}: {
  tenantSlug: string
  initialTags: ItemTagRow[]
  initialItems: ItemWithTags[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [items, setItems] = useState(initialItems)
  const [pending, startTransition] = useTransition()
  const [state, action, formPending] = useActionState(
    (prev: TagActionState, fd: FormData) => createItemTag(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) setShowCreate(false)
  }, [state.ok])

  const handleToggle = (menuItemId: string, tagId: string, enable: boolean) => {
    startTransition(async () => {
      const r = await toggleTagOnMenuItem(tenantSlug, menuItemId, tagId, enable)
      if (r.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === menuItemId
              ? {
                  ...it,
                  tag_ids: enable ? [...it.tag_ids, tagId] : it.tag_ids.filter((t) => t !== tagId),
                }
              : it,
          ),
        )
      } else toast.error(r.message)
    })
  }

  const handleDelete = (id: string, name: string) => {
    startTransition(async () => {
      const r = await deleteItemTag(tenantSlug, id)
      if (r.ok) toast.success(`Tag "${name}" eliminado`)
      else toast.error(r.message)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Tags disponibles</h2>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 size-4" />
                Nuevo tag
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo tag</DialogTitle>
              </DialogHeader>
              <form action={action} className="space-y-3">
                <div>
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    name="name"
                    autoFocus
                    required
                    maxLength={40}
                    placeholder="cafe, vegano, sin-tacc..."
                  />
                </div>
                <div>
                  <Label htmlFor="color">Color</Label>
                  <Input id="color" name="color" type="color" defaultValue="#94a3b8" />
                </div>
                {!state.ok && state.message && (
                  <p className="text-sm text-destructive">{state.message}</p>
                )}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={formPending}>
                    {formPending ? 'Creando…' : 'Crear'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex flex-wrap gap-2">
          {initialTags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay tags todavía.</p>
          ) : (
            initialTags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: t.color, color: t.color }}
              >
                #{t.name}
                <button
                  type="button"
                  className="opacity-60 hover:opacity-100"
                  onClick={() => handleDelete(t.id, t.name)}
                  disabled={pending}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-display text-base font-semibold">Asignar tags a ítems</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ítems en la carta todavía.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{it.name}</p>
                    {it.category_name && (
                      <p className="text-xs text-muted-foreground">{it.category_name}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {initialTags.map((tag) => {
                    const enabled = it.tag_ids.includes(tag.id)
                    const cbId = `tag-${it.id}-${tag.id}`
                    return (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                        style={{ borderColor: tag.color }}
                      >
                        <Checkbox
                          id={cbId}
                          checked={enabled}
                          disabled={pending}
                          onCheckedChange={(v) => handleToggle(it.id, tag.id, Boolean(v))}
                          className="size-3"
                        />
                        <Label
                          htmlFor={cbId}
                          className="cursor-pointer"
                          style={{ color: tag.color }}
                        >
                          #{tag.name}
                        </Label>
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Badge variant="outline">
        Tip: estos tags se usan al crear punch cards con trigger_type="tag".
      </Badge>
    </div>
  )
}
