'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createMenuItem, type MenuActionState } from '@/lib/menu/actions'
import { MenuImageUploader } from './image-uploader'

const initial: MenuActionState = { ok: true }

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Agregar ítem'}
    </Button>
  )
}

export function NewItemForm({
  tenantSlug,
  tenantId,
  categoryId,
  onCreated,
}: {
  tenantSlug: string
  tenantId: string
  categoryId: string
  // Callback opcional para que el contenedor (p. ej. un Popover) se cierre tras
  // crear el ítem con éxito. Si no se pasa, el form sólo se resetea.
  onCreated?: () => void
}) {
  const action = createMenuItem.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setImageUrl(null)
      onCreated?.()
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state, onCreated])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-3 rounded-lg border border-dashed border-border/60 bg-background/30 p-3"
    >
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />

      <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
        <div className="grid gap-1">
          <Label
            htmlFor={`name-${categoryId}`}
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Nombre
          </Label>
          <Input
            id={`name-${categoryId}`}
            name="name"
            required
            maxLength={80}
            placeholder="Fernet con cola"
          />
        </div>
        <div className="grid gap-1">
          <Label
            htmlFor={`price-${categoryId}`}
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Precio (¢)
          </Label>
          <Input
            id={`price-${categoryId}`}
            name="price_cents"
            type="number"
            required
            min={0}
            step={1}
            placeholder="150000"
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1">
          <Label
            htmlFor={`pts-${categoryId}`}
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Pts override
          </Label>
          <Input
            id={`pts-${categoryId}`}
            name="points_override"
            type="number"
            step={1}
            placeholder="opcional"
            className="tabular-nums"
          />
        </div>
        <SubmitBtn />
      </div>

      <MenuImageUploader tenantId={tenantId} value={imageUrl} onChange={setImageUrl} />
    </form>
  )
}
