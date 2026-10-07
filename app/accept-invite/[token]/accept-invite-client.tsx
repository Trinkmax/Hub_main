'use client'

import { ArrowRight, Eye, EyeOff, Lock, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { acceptInvitation, acceptInvitationWithPassword } from './actions'

type Preview = {
  email: string
  role: string
  tenant_name: string
}

export function AcceptInviteClient({
  token,
  preview,
  currentEmail,
}: {
  token: string
  preview: Preview
  currentEmail: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const emailMatches = currentEmail?.toLowerCase() === preview.email.toLowerCase()

  const handleAccept = () => {
    startTransition(async () => {
      const r = await acceptInvitation(token)
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      router.replace(r.redirectTo)
    })
  }

  if (!currentEmail) {
    return (
      <PasswordSetupForm
        token={token}
        email={preview.email}
        onSuccess={(href) => router.replace(href)}
      />
    )
  }

  if (!emailMatches) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive text-pretty">
          Estás logueado como <strong className="font-mono">{currentEmail}</strong>, pero la
          invitación es para <strong className="font-mono">{preview.email}</strong>.
        </div>
        <Button variant="outline" asChild className="w-full">
          <a href="/login">Cambiar de cuenta</a>
        </Button>
      </div>
    )
  }

  return (
    <Button onClick={handleAccept} disabled={isPending} className="w-full gap-2" size="lg">
      {isPending ? 'Aceptando…' : `Entrar a ${preview.tenant_name}`}
      {!isPending ? <ArrowRight className="size-4" /> : null}
    </Button>
  )
}

function PasswordSetupForm({
  token,
  email,
  onSuccess,
}: {
  token: string
  email: string
  onSuccess: (href: string) => void
}) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const passId = useId()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await acceptInvitationWithPassword({ token, password })
      if (!r.ok) {
        setError(r.message)
        toast.error(r.message)
        return
      }
      toast.success('¡Bienvenido!')
      onSuccess(r.redirectTo)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground text-balance">
        <strong className="text-foreground">Tip:</strong> si ya tenés cuenta en HUB, ingresá tu
        contraseña actual. Si es la primera vez, esta será tu contraseña permanente.
      </div>

      <div className="space-y-1.5 text-left">
        <Label htmlFor={passId} className="text-xs font-medium text-muted-foreground">
          Contraseña para <span className="font-mono text-foreground">{email}</span>
        </Label>
        <div className="relative">
          <Lock
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            id={passId}
            type={show ? 'text' : 'password'}
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres + número"
            aria-invalid={Boolean(error) || undefined}
            className={cn(
              'h-10 pl-9 pr-10 transition-colors',
              error && 'border-destructive focus-visible:ring-destructive/40',
            )}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={show}
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            tabIndex={-1}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {error ? (
          <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={isPending} className="w-full gap-2" size="lg">
        <LogIn className={cn('size-4', isPending && 'animate-pulse')} />
        {isPending ? 'Entrando…' : 'Aceptar y entrar'}
        {!isPending ? <ArrowRight className="size-3.5" /> : null}
      </Button>
    </form>
  )
}
