'use client'

import { CircleCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AuthCard } from '@/app/(auth)/_components/auth-card'
import { PasswordInput } from '@/app/(auth)/_components/password-input'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { SubmitButton } from '@/components/ui/submit-button'
import { type AuthState, updatePasswordAction } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'

const initialState: AuthState = { status: 'idle' }

function passwordStrength(value: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'] as const
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] ?? 'Muy débil' }
}

/** El tono de las barras llenas: el texto («Fuerza: Buena») siempre acompaña, el color no va solo. */
function strengthBarClass(score: number): string {
  if (score <= 1) return 'bg-destructive'
  if (score === 2) return 'bg-warning'
  return 'bg-success'
}

export function UpdatePasswordForm({
  email,
  requiresReauth = false,
}: {
  email: string
  /**
   * `true` cuando el usuario llega con sesión normal (no de un magic link
   * de recovery). Mostramos el campo "Contraseña actual" y exigimos reauth.
   */
  requiresReauth?: boolean
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(updatePasswordAction, initialState)
  const [pwd, setPwd] = useState('')

  useEffect(() => {
    if (state.status === 'error' && state.message) toast.error(state.message)
    if (state.status === 'success') {
      toast.success('Contraseña actualizada.')
      // Pequeño delay para que el usuario vea el feedback antes de navegar.
      const t = setTimeout(() => router.replace('/'), 900)
      return () => clearTimeout(t)
    }
  }, [state, router])

  const passError = state.status === 'error' ? state.fieldErrors?.password : undefined
  const confirmError = state.status === 'error' ? state.fieldErrors?.confirm : undefined
  const currentError = state.status === 'error' ? state.fieldErrors?.currentPassword : undefined

  if (state.status === 'success') {
    return (
      <AuthCard
        icon={CircleCheck}
        tone="success"
        title="¡Listo!"
        description={<span role="status">Te llevamos a tu panel…</span>}
      />
    )
  }

  const strength = pwd.length > 0 ? passwordStrength(pwd) : null

  return (
    <AuthCard
      title={requiresReauth ? 'Cambiar tu contraseña' : 'Crear nueva contraseña'}
      description={
        <>
          {email ? (
            <p>
              Para <span className="font-medium text-foreground">{email}</span>
            </p>
          ) : null}
          {requiresReauth ? (
            <p>Por seguridad, confirmá tu contraseña actual antes de cambiarla.</p>
          ) : null}
        </>
      }
      footer={
        requiresReauth ? (
          // Llegó desde el menú de su cuenta: una salida sin cambiar nada. `<a>` y
          // no Link: «/» manda a cada rol a su lugar (el staff, al salón).
          <Button variant="ghost" asChild>
            <a href="/">Cancelar</a>
          </Button>
        ) : null
      }
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {requiresReauth ? (
          <Field label="Contraseña actual" name="currentPassword" error={currentError} required>
            <PasswordInput autoComplete="current-password" />
          </Field>
        ) : null}

        <div className="flex flex-col gap-2">
          <Field
            label="Contraseña nueva"
            name="password"
            hint="Mínimo 8 caracteres, con al menos una letra y un número."
            error={passError}
            required
          >
            <PasswordInput
              minLength={8}
              autoComplete="new-password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
          </Field>
          {strength ? (
            <div className="flex flex-col gap-1">
              <div className="flex h-1 gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 rounded-full transition-colors duration-(--duration-quick) motion-reduce:transition-none',
                      i < strength.score ? strengthBarClass(strength.score) : 'bg-secondary',
                    )}
                  />
                ))}
              </div>
              <p className="type-caption text-muted-foreground" aria-live="polite">
                Fuerza: <span className="font-medium text-foreground">{strength.label}</span>
              </p>
            </div>
          ) : null}
        </div>

        <Field label="Repetir contraseña" name="confirm" error={confirmError} required>
          <PasswordInput
            minLength={8}
            autoComplete="new-password"
            revealLabel="Mostrar confirmación"
          />
        </Field>

        <SubmitButton size="lg" className="mt-2 w-full" pendingText="Guardando…">
          Guardar contraseña
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
