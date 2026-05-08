'use client'

import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CaptureActionState, submitCapture } from '@/lib/capture/actions'

const initial: CaptureActionState | null = null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full gap-2">
      {pending ? 'Enviando…' : 'Sumar puntos'}
      {!pending ? <ArrowRight className="size-4" /> : null}
    </Button>
  )
}

async function action(_prev: CaptureActionState | null, formData: FormData) {
  return await submitCapture(formData)
}

export function CaptureForm({ linkSlug, tenantName }: { linkSlug: string; tenantName: string }) {
  const [state, formAction] = useActionState(action, initial)

  if (state?.ok) {
    return (
      <div className="space-y-3 py-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-7" />
        </div>
        <h2 className="font-display text-xl font-semibold tracking-tight">¡Listo!</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {state.was_new
            ? `Te sumamos a la base de ${tenantName}. Disfrutá tu visita.`
            : `Bienvenido de vuelta a ${tenantName}. Disfrutá tu visita.`}
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="link_slug" value={linkSlug} />

      {/* Honeypot anti-bot */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <Label htmlFor="website">Website</Label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="phone">Teléfono</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          autoComplete="tel"
          placeholder="351 555 1234"
          className="h-11 text-base"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="first_name">Nombre</Label>
          <Input
            id="first_name"
            name="first_name"
            required
            maxLength={60}
            autoComplete="given-name"
            className="h-11 text-base"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="last_name">Apellido</Label>
          <Input
            id="last_name"
            name="last_name"
            required
            maxLength={60}
            autoComplete="family-name"
            className="h-11 text-base"
          />
        </div>
      </div>

      <Label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3.5">
        <Checkbox name="opt_in_marketing" id="opt_in_marketing" defaultChecked className="mt-0.5" />
        <div className="space-y-0.5">
          <span className="text-sm font-medium leading-none">
            Quiero recibir promos por WhatsApp
          </span>
          <span className="block text-xs text-muted-foreground">
            Te avisamos de eventos y descuentos. Te podés dar de baja cuando quieras.
          </span>
        </div>
      </Label>

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}
