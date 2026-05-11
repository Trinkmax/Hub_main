'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { updateMenuItem } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { MenuImageUploader } from './image-uploader'

export function ItemEditDialog({
  item,
  tenantSlug,
  tenantId,
  categories,
  onClose,
}: {
  item: MenuItem
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [categoryId, setCategoryId] = useState(item.category_id)
  const [priceCents, setPriceCents] = useState(String(item.price_cents))
  const [pointsOverride, setPointsOverride] = useState(
    item.points_override === null ? '' : String(item.points_override),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url ?? null)
  const [pending, start] = useTransition()

  const onSave = () => {
    const price = Number.parseInt(priceCents, 10)
    if (Number.isNaN(price) || price < 0) {
      toast.error('Precio inválido')
      return
    }
    const pts = pointsOverride === '' ? null : Number.parseInt(pointsOverride, 10)
    if (pts !== null && Number.isNaN(pts)) {
      toast.error('Puntos override inválido')
      return
    }
    start(async () => {
      const r = await updateMenuItem(tenantSlug, {
        id: item.id,
        category_id: categoryId,
        name,
        description: description.trim().length > 0 ? description.trim() : null,
        price_cents: price,
        points_override: pts,
        image_url: imageUrl,
        active: item.active,
      })
      if (r.ok) {
        toast.success('Guardado.')
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar ítem</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="item-name">Nombre</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="item-cat">Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="item-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="item-desc">Descripción</Label>
            <Textarea
              id="item-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="item-price">Precio (centavos)</Label>
              <Input
                id="item-price"
                type="number"
                value={priceCents}
                onChange={(e) => setPriceCents(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="item-pts">Puntos override</Label>
              <Input
                id="item-pts"
                type="number"
                value={pointsOverride}
                onChange={(e) => setPointsOverride(e.target.value)}
                placeholder="opcional"
              />
            </div>
          </div>
          <MenuImageUploader tenantId={tenantId} value={imageUrl} onChange={setImageUrl} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
