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
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
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
        // Si se reemplazó o limpió la imagen, borrar la previa del bucket
        // para no dejar archivos huérfanos (deleteMenuImageByUrl corre en el
        // browser con el client anon; es best-effort y no bloquea el guardado).
        if (category.image_url && category.image_url !== imageUrl) {
          try {
            await deleteMenuImageByUrl(category.image_url)
          } catch {
            // best-effort: un fallo de borrado no debe romper el guardado
          }
        }
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
