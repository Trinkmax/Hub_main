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
import { updateCategory } from '@/lib/menu/actions'
import type { MenuCategory } from '@/lib/menu/queries'
import { MenuImageUploader } from './image-uploader'

export function CategoryEditDialog({
  category,
  tenantId,
  tenantSlug,
  onClose,
}: {
  category: MenuCategory
  tenantId: string
  tenantSlug: string
  onClose: () => void
}) {
  const [name, setName] = useState(category.name)
  const [imageUrl, setImageUrl] = useState<string | null>(category.image_url)
  const [pending, start] = useTransition()

  const onSave = () => {
    start(async () => {
      const r = await updateCategory(tenantSlug, {
        id: category.id,
        name,
        active: category.active,
        image_url: imageUrl,
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
          <DialogTitle>Editar categoría</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cat-edit-name">Nombre</Label>
            <Input
              id="cat-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <MenuImageUploader
            tenantId={tenantId}
            value={imageUrl}
            onChange={setImageUrl}
            label="Foto de la categoría"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending || name.trim().length === 0}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
