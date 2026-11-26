'use client'

import { KeyRound, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState, useTransition } from 'react'
import { PinPad } from '@/components/auth/pin-pad'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import type { PinAccount } from '@/lib/auth/pin'
import { signInWithPinAction } from '@/lib/auth/pin-actions'

/**
 * Entrar con PIN: en un equipo donde alguien ya eligió su PIN, la pantalla de ingreso es esta. Con una
 * sola persona va derecho al teclado; con varias (la compu de la caja) primero se elige quién.
 */
export function PinLogin({ accounts, redirectTo }: { accounts: PinAccount[]; redirectTo: string }) {
  const only = accounts.length === 1 ? (accounts[0] ?? null) : null
  const [who, setWho] = useState<PinAccount | null>(only)
  const [message, setMessage] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pending, start] = useTransition()

  const passwordHref = `/login?clave=1${redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : ''}`

  const submit = useCallback(
    (pin: string) => {
      if (!who) return
      setMessage(null)
      start(async () => {
        // Si sale bien no vuelve: el servidor redirige con la sesión abierta.
        const result = await signInWithPinAction(who.id, pin, redirectTo)
        if (result && !result.ok) {
          setMessage(result.message)
          setLocked(result.locked === true)
          setAttempt((current) => current + 1)
        }
      })
    },
    [who, redirectTo],
  )

  const blocked = locked || who?.locked === true
  const firstName = who?.name.split(/\s+/)[0] ?? ''

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline rounded-2xl border border-border/70 bg-card p-5 shadow-lg sm:p-8">
        {who === null ? (
          <>
            <h1 className="text-center font-serif text-2xl font-semibold tracking-tight">
              ¿Quién sos?
            </h1>
            <ul className="mt-5 grid gap-2">
              {accounts.map((account) => (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setWho(account)
                      setMessage(null)
                      setLocked(false)
                    }}
                    className="flex min-h-14 w-full touch-manipulation items-center gap-3 rounded-xl border border-border bg-background px-4 text-left font-medium text-base outline-none active:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <UserRound aria-hidden className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{account.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="space-y-1 text-center">
              <h1 className="font-serif text-2xl font-semibold tracking-tight">
                Hola, {firstName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {blocked ? 'Tu PIN está bloqueado en este equipo.' : 'Poné tu PIN para entrar.'}
              </p>
            </div>

            {blocked ? null : (
              <div className="mt-4">
                <PinPad
                  label="Tu PIN"
                  onComplete={submit}
                  busy={pending}
                  failed={message !== null}
                  resetKey={attempt}
                />
              </div>
            )}

            <p
              role="status"
              aria-live="polite"
              className="mt-4 min-h-5 text-center font-medium text-destructive text-sm"
            >
              {pending ? <span className="text-muted-foreground">Entrando…</span> : message}
            </p>

            {blocked ? (
              <Link
                href={passwordHref}
                className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <KeyRound aria-hidden className="size-4" />
                Entrar con mi contraseña
              </Link>
            ) : null}
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          {who !== null && accounts.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setWho(null)
                setMessage(null)
                setLocked(false)
              }}
              className="min-h-11 rounded-md px-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              No soy {firstName}
            </button>
          ) : null}
          {blocked ? null : (
            <Link
              href={passwordHref}
              className="flex min-h-11 items-center rounded-md px-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Entrar con mi contraseña
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
