'use client'

import { Mail } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Callout } from '@/components/ui/callout'
import { Field } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { type AuthState, signInWithPasswordAction } from '@/lib/auth/actions'
import { AuthCard } from '../_components/auth-card'
import { PasswordInput } from '../_components/password-input'

const initialState: AuthState = { status: 'idle' }

export function LoginForm({
  initialEmail,
  redirectTo,
  notice,
}: {
  initialEmail: string
  redirectTo: string
  /** Por qué se volvió al login (link vencido, mail que no validó). */
  notice?: string | null
}) {
  const [state, formAction] = useActionState(signInWithPasswordAction, initialState)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.status === 'error' && state.message) {
      toast.error(state.message)
      // Si la pass es incorrecta, foco rápido en pass
      if (state.fieldErrors?.password || /incorrect/i.test(state.message)) {
        passwordRef.current?.focus()
        passwordRef.current?.select()
      }
    }
  }, [state])

  const emailError = state.status === 'error' ? state.fieldErrors?.email : undefined
  const passwordError = state.status === 'error' ? state.fieldErrors?.password : undefined

  return (
    <AuthCard
      title="Ingresá a tu bar"
      description="Usá el email y la contraseña que te dio el dueño del bar."
    >
      {notice ? <Callout tone="warning">{notice}</Callout> : null}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <Field label="Email" name="email" error={emailError} required>
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

        <div className="flex flex-col gap-2">
          <Field label="Contraseña" name="password" error={passwordError} required>
            <PasswordInput ref={passwordRef} autoComplete="current-password" />
          </Field>
          <Link
            href="/forgot-password"
            className="self-end type-small text-muted-foreground underline decoration-1 underline-offset-[3px] hover:text-foreground hover:decoration-2"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <input type="hidden" name="redirectTo" value={redirectTo} />
        <SubmitButton size="lg" className="mt-2 w-full" pendingText="Ingresando…">
          Ingresar
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
