'use client'

import { ArrowRight, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PasswordInput } from '@/app/(auth)/_components/password-input'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Field } from '@/components/ui/field'
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
      <div className="flex flex-col gap-4">
        <Callout tone="danger" title="Es para otra cuenta">
          Estás con la sesión de <strong className="font-medium">{currentEmail}</strong>, pero la
          invitación es para <strong className="font-medium">{preview.email}</strong>.
        </Callout>
        <Button variant="secondary" size="lg" asChild className="w-full">
          <a href="/login">Cambiar de cuenta</a>
        </Button>
      </div>
    )
  }

  return (
    <Button
      onClick={handleAccept}
      loading={isPending}
      loadingText="Aceptando…"
      className="w-full"
      size="lg"
    >
      {`Entrar a ${preview.tenant_name}`}
      <ArrowRight aria-hidden="true" />
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
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Callout tone="neutral" title="Tu contraseña">
        Si ya tenés cuenta en HUB, ingresá tu contraseña actual. Si es la primera vez, esta va a ser
        tu contraseña de acá en adelante.
      </Callout>

      <Field
        label={
          <>
            Contraseña para <span className="font-semibold">{email}</span>
          </>
        }
        hint="Mínimo 8 caracteres, con al menos una letra y un número."
        error={error}
        required
      >
        <PasswordInput
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button
        type="submit"
        loading={isPending}
        loadingText="Entrando…"
        className="w-full"
        size="lg"
      >
        <LogIn aria-hidden="true" />
        Aceptar y entrar
      </Button>
    </form>
  )
}
