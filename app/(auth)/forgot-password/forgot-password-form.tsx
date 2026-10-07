'use client'

import { ArrowLeft, Mail, MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { type AuthState, requestPasswordResetAction } from '@/lib/auth/actions'
import { AuthCard } from '../_components/auth-card'

const initialState: AuthState = { status: 'idle' }

function BackToLogin() {
  return (
    <Button variant="ghost" asChild>
      <Link href="/login">
        <ArrowLeft aria-hidden="true" />
        Volver al login
      </Link>
    </Button>
  )
}

export function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [state, formAction] = useActionState(requestPasswordResetAction, initialState)

  const sent = state.status === 'success'
  const error = state.status === 'error' ? state.message : undefined

  if (sent) {
    return (
      <AuthCard
        icon={MailCheck}
        tone="success"
        title="Revisá tu email"
        description={
          state.message ??
          'Si el email está registrado, te llega un link para crear una nueva contraseña. Mirá el spam por las dudas.'
        }
        footer={<BackToLogin />}
      />
    )
  }

  return (
    <AuthCard
      title="Recuperar contraseña"
      description="Ingresá tu email y te mandamos un link para fijar una nueva."
      footer={<BackToLogin />}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <Field label="Email" name="email" error={error} required>
          <InputGroup size="lg">
            <InputAddon>
              <Mail aria-hidden="true" />
            </InputAddon>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              defaultValue={initialEmail}
              placeholder="vos@bar.com"
            />
          </InputGroup>
        </Field>
        <SubmitButton size="lg" className="mt-2 w-full" pendingText="Enviando…">
          Mandame el link
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
