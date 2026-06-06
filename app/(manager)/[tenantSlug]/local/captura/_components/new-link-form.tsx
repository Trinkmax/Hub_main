'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCaptureLink, type LinkActionState } from '@/lib/capture/actions'

const initial: LinkActionState = { ok: true }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear link'}
    </Button>
  )
}

export function NewLinkForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createCaptureLink.bind(null, tenantSlug)
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
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <div className="grid gap-1.5">
        <Label
          htmlFor="slug"
          className="text-[11px] uppercase tracking-wider text-muted-foreground"
        >
          Slug del QR
        </Label>
        <Input
          id="slug"
          name="slug"
          required
          minLength={4}
          maxLength={32}
          pattern="[a-zA-Z0-9_\-]+"
          placeholder="mesa-1, barra, jueves-trivia"
          autoComplete="off"
          className="font-mono text-sm"
        />
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="label"
          className="text-[11px] uppercase tracking-wider text-muted-foreground"
        >
          Etiqueta interna
        </Label>
        <Input
          id="label"
          name="label"
          required
          maxLength={60}
          placeholder="QR Mesa 1"
          autoComplete="off"
        />
      </div>
      <SubmitButton />
    </form>
  )
}
