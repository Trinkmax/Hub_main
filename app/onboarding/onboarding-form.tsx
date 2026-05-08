'use client'

import { ArrowRight, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { slugify } from '@/lib/tenant/slugify'
import { type CreateTenantState, createTenant } from './actions'

const initialState: CreateTenantState = { status: 'idle' }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full gap-2" size="lg">
      {pending ? 'Creando bar…' : 'Crear mi bar'}
      {!pending ? <ArrowRight className="size-4" /> : null}
    </Button>
  )
}

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
    <div className="space-y-7">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-6 shadow-lg backdrop-blur-xl sm:p-8">
        <div className="space-y-3 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-[--cream-tint] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3" aria-hidden />
            Empezá tu bar
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Creá tu bar en HUB!</h1>
          <p className="text-sm text-muted-foreground text-balance">
            Solo necesitamos el nombre. El resto lo configurás en 5 minutos.
          </p>
        </div>

        <form action={formAction} className="mt-6 space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Nombre del bar</Label>
            <Input
              id="name"
              name="name"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bar HUB"
              autoComplete="off"
              className="h-11"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slug">URL del bar</Label>
            <div className="flex items-center rounded-lg border border-input bg-background/40 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
              <span className="border-r border-border/60 px-3 py-2.5 text-sm text-muted-foreground">
                hub.com/
              </span>
              <input
                id="slug"
                name="slug"
                required
                pattern="[a-z0-9-]{2,40}"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
                placeholder="bar-hub"
                autoComplete="off"
                className="h-11 flex-1 bg-transparent px-3 text-sm font-mono outline-none"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Solo minúsculas, números y guiones. Lo podés cambiar después.
            </p>
          </div>
          <SubmitButton />
        </form>
      </div>
    </div>
  )
}
