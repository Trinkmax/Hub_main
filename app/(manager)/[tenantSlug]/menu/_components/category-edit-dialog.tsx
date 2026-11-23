'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setCategoryAvailability, updateCategory } from '@/lib/menu/actions'
import { fromDrafts, sameAvailability, toDrafts, type WindowDraft } from '@/lib/menu/availability'
import type { MenuCategory } from '@/lib/menu/queries'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
import { AvailabilityField } from './availability-field'
import { MenuImageUploader } from './image-uploader'

/**
 * Todo lo de una categoría en un solo lugar: el nombre, la foto y cuándo se muestra en la carta
 * (`availability-field.tsx`). El horario se guarda con su propia acción y solo si cambió.
 */
export function CategoryEditDialog({
  category,
  tenantId,
  tenantSlug,
  timeZone,
  onClose,
}: {
  category: MenuCategory
  tenantId: string
  tenantSlug: string
  /** La zona horaria del bar: el horario de la categoría va en su hora. */
  timeZone: string
  onClose: () => void
}) {
  const saved = category.availability ?? null
  const [name, setName] = useState(category.name)
  const [imageUrl, setImageUrl] = useState<string | null>(category.image_url)
  // `null` = se muestra siempre.
  const [drafts, setDrafts] = useState<WindowDraft[] | null>(() => {
    const initial = toDrafts(saved)
    return initial.length === 0 ? null : initial
  })
  const [pending, start] = useTransition()

  const onSave = () => {
    start(async () => {
      // Una acción que se cae adentro de la transición tiraría la pantalla entera.
      try {
        const r = await updateCategory(tenantSlug, {
          id: category.id,
          name,
          active: category.active,
          image_url: imageUrl,
        })
        if (!r.ok) {
          toast.error(r.message)
          return
        }
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

        const availability = drafts === null ? null : fromDrafts(drafts)
        if (!sameAvailability(availability, saved)) {
          const hours = await setCategoryAvailability(tenantSlug, {
            id: category.id,
            availability,
          })
          if (!hours.ok) {
            toast.error(`El nombre y la foto quedaron guardados; el horario no. ${hours.message}`)
            return
          }
        }
        toast.success('Guardado.')
        onClose()
      } catch {
        toast.error('No pudimos guardar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* El mismo armado que «Editar ítem»: encabezado y botones fijos, y lo del medio corre. Con
          ancho, el nombre y la foto van a la izquierda y el horario a la derecha: entra todo sin
          bajar en una notebook, y «Guardar» nunca queda escondido. */}
      <DialogContent className="flex max-h-[92dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[52rem]">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="font-serif text-2xl font-semibold tracking-tight">
            Editar categoría
          </DialogTitle>
          <DialogDescription>El nombre, la foto y cuándo se muestra en la carta.</DialogDescription>
        </DialogHeader>
        {/* `grid-cols-1` = una columna que NO crece con lo de adentro: en el celular los campos se
            achican al ancho del diálogo en vez de salirse por la derecha. */}
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto overflow-x-hidden px-6 py-5 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
          <div className="grid min-w-0 content-start gap-4">
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
          <AvailabilityField
            drafts={drafts}
            onChange={setDrafts}
            timeZone={timeZone}
            disabled={pending}
          />
        </div>
        <DialogFooter className="border-t border-border/60 px-6 py-4">
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
