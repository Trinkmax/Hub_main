'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { createCategory, type MenuActionState } from '@/lib/menu/actions'

const initial: MenuActionState = { ok: true }

export function NewCategoryForm({
  tenantId,
  tenantSlug,
  parentId = null,
}: {
  tenantId: string
  tenantSlug: string
  parentId?: string | null
}) {
  const action = createCategory.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setImageUrl(null)
    } else if (!state.ok) toast.error(state.message)
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <input type="hidden" name="parent_id" value={parentId ?? ''} />
      <Field label="Nombre" name="name" required>
        <Input maxLength={60} placeholder="Tragos, Comida, Postres…" autoComplete="off" />
      </Field>
      <MenuImageUploader
        tenantId={tenantId}
        value={imageUrl}
        onChange={setImageUrl}
        label="Foto de la categoría (opcional)"
      />
      <SubmitButton pendingText="Creando…" className="w-full">
        <Plus aria-hidden="true" />
        Crear categoría
      </SubmitButton>
    </form>
  )
}
