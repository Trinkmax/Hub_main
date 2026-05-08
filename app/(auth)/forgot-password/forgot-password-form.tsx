'use client'

import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type AuthState, requestPasswordResetAction } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'

const initialState: AuthState = { status: 'idle' }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="h-10 w-full gap-2" size="lg">
      <Mail className={cn('size-4', pending && 'animate-pulse')} />
      {pending ? 'Enviando…' : 'Mandame el link'}
      {!pending ? <ArrowRight className="size-3.5" /> : null}
    </Button>
  )
}

export function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [state, formAction] = useActionState(requestPasswordResetAction, initialState)
  const emailId = useId()

  const sent = state.status === 'success'
  const error = state.status === 'error' ? state.message : undefined

  return (
    <div className="space-y-7 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-6 shadow-lg backdrop-blur-xl sm:p-8">
        {sent ? (
          <div className="flex flex-col items-center gap-4 text-center animate-in fade-in-0 zoom-in-95 duration-300">
            <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/15 text-success">
              <CheckCircle2 className="size-7" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="font-serif text-2xl font-semibold tracking-tight">Revisá tu email</h1>
              <p className="text-sm text-muted-foreground text-balance">
                {state.message ??
                  'Si el email está registrado, te llega un link para crear una nueva contraseña. Mirá el spam por las dudas.'}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-2 gap-1.5">
              <Link href="/login">
                <ArrowLeft className="size-3.5" aria-hidden />
                Volver al login
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2 text-center">
              <h1 className="font-serif text-2xl font-semibold tracking-tight">
                Recuperar contraseña
              </h1>
              <p className="text-sm text-muted-foreground text-balance">
                Ingresá tu email y te mandamos un link para fijar una nueva.
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
                    aria-invalid={Boolean(error) || undefined}
                    className={cn(
                      'h-10 pl-9 transition-colors',
                      error && 'border-destructive focus-visible:ring-destructive/40',
                    )}
                  />
                </div>
                {error ? (
                  <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
                    {error}
                  </p>
                ) : null}
              </div>
              <SubmitButton />
            </form>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3" aria-hidden />
                Volver al login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
