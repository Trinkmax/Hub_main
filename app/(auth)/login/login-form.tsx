'use client'

import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type AuthState, signInWithPasswordAction } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'

const initialState: AuthState = { status: 'idle' }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="h-10 w-full gap-2" size="lg">
      <KeyRound className={cn('size-4 transition-transform', pending && 'animate-pulse')} />
      {pending ? 'Ingresando…' : 'Ingresar'}
      {!pending ? <ArrowRight className="size-3.5" /> : null}
    </Button>
  )
}

export function LoginForm({
  initialEmail,
  redirectTo,
}: {
  initialEmail: string
  redirectTo: string
}) {
  const [state, formAction] = useActionState(signInWithPasswordAction, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const emailId = useId()
  const passwordId = useId()

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
    <div className="space-y-7 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-6 shadow-lg backdrop-blur-xl sm:p-8">
        <div className="space-y-2 text-center">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Ingresá a tu bar</h1>
          <p className="text-sm text-muted-foreground text-balance">
            Usá el email y la contraseña que te dio el dueño del bar.
          </p>
        </div>

        <form action={formAction} className="mt-6 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={emailId} className="text-xs font-medium text-muted-foreground">
              Email
            </Label>
            <div className="relative">
              <Mail
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                id={emailId}
                name="email"
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                defaultValue={initialEmail}
                placeholder="vos@bar.com"
                aria-invalid={Boolean(emailError) || undefined}
                aria-describedby={emailError ? `${emailId}-err` : undefined}
                className={cn(
                  'h-10 pl-9 transition-colors',
                  emailError && 'border-destructive focus-visible:ring-destructive/40',
                )}
              />
            </div>
            {emailError ? (
              <p
                id={`${emailId}-err`}
                className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1"
              >
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={passwordId} className="text-xs font-medium text-muted-foreground">
                Contraseña
              </Label>
              <Link
                href="/forgot-password"
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <div className="relative">
              <Lock
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                ref={passwordRef}
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={Boolean(passwordError) || undefined}
                aria-describedby={passwordError ? `${passwordId}-err` : undefined}
                className={cn(
                  'h-10 pl-9 pr-10 transition-colors',
                  passwordError && 'border-destructive focus-visible:ring-destructive/40',
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {passwordError ? (
              <p
                id={`${passwordId}-err`}
                className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1"
              >
                {passwordError}
              </p>
            ) : null}
          </div>

          <input type="hidden" name="redirectTo" value={redirectTo} />
          <SubmitButton />
        </form>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Si tu bar todavía no está en HUB, escribinos para sumarlo.
      </p>
    </div>
  )
}
