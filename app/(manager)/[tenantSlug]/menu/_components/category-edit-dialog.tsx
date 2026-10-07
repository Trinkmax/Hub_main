'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { updateCategory } from '@/lib/menu/actions'
import type { MenuCategory } from '@/lib/menu/queries'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'

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

  const onSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (name.trim().length === 0) return
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
          <DialogDescription>El nombre y la foto de portada que ve el cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4">
            <Field label="Nombre" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <MenuImageUploader
              tenantId={tenantId}
              value={imageUrl}
              onChange={setImageUrl}
              label="Foto de la categoría"
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={pending}
              loadingText="Guardando…"
              disabled={name.trim().length === 0}
            >
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
