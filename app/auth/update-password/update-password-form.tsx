'use client'

import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} className="h-10 w-full gap-2" size="lg">
      <ShieldCheck className={cn('size-4', pending && 'animate-pulse')} />
      {pending ? 'Guardando…' : 'Guardar contraseña'}
      {!pending ? <ArrowRight className="size-3.5" /> : null}
    </Button>
  )
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
  const [show, setShow] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [pwd, setPwd] = useState('')
  const passId = useId()
  const confirmId = useId()
  const currentId = useId()

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
      <div className="space-y-7 animate-in fade-in-0 zoom-in-95 duration-300">
        <div className="flex justify-center">
          <BrandWordmarkLarge />
        </div>
        <div className="card-hairline rounded-2xl border border-border/70 bg-card/90 p-8 text-center shadow-lg backdrop-blur-xl">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/15 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight">¡Listo!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Te llevamos a tu panel…</p>
        </div>
      </div>
    )
  }

  const strength = pwd.length > 0 ? passwordStrength(pwd) : null

  return (
    <div className="space-y-7 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline rounded-2xl border border-border/70 bg-card/90 p-6 shadow-lg backdrop-blur-xl sm:p-8">
        <div className="space-y-2 text-center">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">
            {requiresReauth ? 'Cambiar tu contraseña' : 'Crear nueva contraseña'}
          </h1>
          {email ? (
            <p className="text-sm text-muted-foreground">
              Para <span className="font-mono text-foreground">{email}</span>
            </p>
          ) : null}
          {requiresReauth ? (
            <p className="text-xs text-muted-foreground/80 text-balance">
              Por seguridad, confirmá tu contraseña actual antes de cambiarla.
            </p>
          ) : null}
        </div>

        <form action={formAction} className="mt-6 space-y-4" noValidate>
          {requiresReauth ? (
            <div className="space-y-1.5">
              <Label htmlFor={currentId} className="text-xs font-medium text-muted-foreground">
                Contraseña actual
              </Label>
              <div className="relative">
                <Lock
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
                />
                <Input
                  id={currentId}
                  name="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="La que usás para entrar"
                  aria-invalid={Boolean(currentError) || undefined}
                  className={cn(
                    'h-10 pl-9 pr-10 transition-colors',
                    currentError && 'border-destructive focus-visible:ring-destructive/40',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showCurrent}
                  className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {currentError ? (
                <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
                  {currentError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={passId} className="text-xs font-medium text-muted-foreground">
              Contraseña nueva
            </Label>
            <div className="relative">
              <Lock
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                id={passId}
                name="password"
                type={show ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                aria-invalid={Boolean(passError) || undefined}
                className={cn(
                  'h-10 pl-9 pr-10 transition-colors',
                  passError && 'border-destructive focus-visible:ring-destructive/40',
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
            {strength ? (
              <div className="space-y-1 pt-1">
                <div className="flex h-1 gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 rounded-full transition-colors duration-300',
                        i < strength.score
                          ? strength.score <= 1
                            ? 'bg-destructive'
                            : strength.score === 2
                              ? 'bg-warning'
                              : 'bg-success'
                          : 'bg-border/60',
                      )}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Fuerza: <span className="font-medium text-foreground">{strength.label}</span>
                </p>
              </div>
            ) : null}
            {passError ? (
              <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
                {passError}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={confirmId} className="text-xs font-medium text-muted-foreground">
              Repetir contraseña
            </Label>
            <div className="relative">
              <Lock
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                id={confirmId}
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Tiene que coincidir"
                aria-invalid={Boolean(confirmError) || undefined}
                className={cn(
                  'h-10 pl-9 pr-10 transition-colors',
                  confirmError && 'border-destructive focus-visible:ring-destructive/40',
                )}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                aria-pressed={showConfirm}
                className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {confirmError ? (
              <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
                {confirmError}
              </p>
            ) : null}
          </div>

          <SubmitButton />
        </form>
      </div>
    </div>
  )
}
