'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCategory, type MenuActionState } from '@/lib/menu/actions'

const initial: MenuActionState = { ok: true }

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear categoría'}
    </Button>
  )
}

export function NewCategoryForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createCategory.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (!state.ok) toast.error(state.message)
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <Input
        name="name"
        required
        maxLength={60}
        placeholder="Tragos, Comida, Postres…"
        className="flex-1"
      />
      <SubmitBtn />
    </form>
  )
}
