'use client'

import { ArrowRight, Store } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AuthCard } from '@/app/(auth)/_components/auth-card'
import { Field } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { slugify } from '@/lib/tenant/slugify'
import { type CreateTenantState, createTenant } from './actions'

const initialState: CreateTenantState = { status: 'idle' }

export function OnboardingForm() {
  const router = useRouter()
  const [state, formAction] = useActionState(createTenant, initialState)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  useEffect(() => {
    if (state.status === 'error' && state.message) toast.error(state.message)
    if (state.status === 'success' && state.redirectTo) {
      toast.success('Bar creado.')
      router.replace(state.redirectTo)
    }
  }, [state, router])

  return (
    <AuthCard
      icon={Store}
      title="Creá tu bar en HUB!"
      description="Solo necesitamos el nombre. El resto lo configurás en 5 minutos."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Nombre del bar" name="name" required>
          <Input
            size="lg"
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bar HUB"
            autoComplete="off"
          />
        </Field>
        <Field
          label="URL del bar"
          name="slug"
          hint="Solo minúsculas, números y guiones. La podés cambiar después."
          required
        >
          <InputGroup size="lg">
            <InputAddon>hub.com/</InputAddon>
            <Input
              pattern="[a-z0-9-]{2,40}"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugTouched(true)
              }}
              placeholder="bar-hub"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono"
            />
          </InputGroup>
        </Field>
        <SubmitButton size="lg" className="mt-2 w-full" pendingText="Creando bar…">
          Crear mi bar
          <ArrowRight aria-hidden="true" />
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
