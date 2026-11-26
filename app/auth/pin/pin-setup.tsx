'use client'

import { CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { PinPad } from '@/components/auth/pin-pad'
import { BrandWordmarkLarge } from '@/components/shell/brand-mark'
import { pinProblem } from '@/lib/auth/pin'
import { removePinAction, setPinAction } from '@/lib/auth/pin-actions'

/**
 * Elegir el PIN de este equipo: se tipea y se repite. Quien ya tenía uno lo cambia igual (o lo quita).
 */
export function PinSetup({
  first,
  hasPin,
  locked,
  next,
}: {
  /** Viene de elegir su primera contraseña: se le ofrece el PIN una vez, y lo puede dejar para después. */
  first: boolean
  hasPin: boolean
  locked: boolean
  next: string
}) {
  const router = useRouter()
  const [chosen, setChosen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [done, setDone] = useState<'set' | 'removed' | null>(null)
  const [pending, start] = useTransition()

  const restart = useCallback((why: string) => {
    setChosen(null)
    setMessage(why)
    setRound((current) => current + 1)
  }, [])

  const onComplete = useCallback(
    (pin: string) => {
      if (chosen === null) {
        const problem = pinProblem(pin)
        if (problem) {
          restart(problem)
          return
        }
        setChosen(pin)
        setMessage(null)
        setRound((current) => current + 1)
        return
      }
      if (pin !== chosen) {
        restart('No coinciden. Elegilo de nuevo.')
        return
      }
      start(async () => {
        const result = await setPinAction(pin)
        if (result.ok) setDone('set')
        else restart(result.message)
      })
    },
    [chosen, restart],
  )

  const remove = () =>
    start(async () => {
      const result = await removePinAction()
      if (result.ok) setDone('removed')
      else setMessage(result.message)
    })

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => router.replace(next), 700)
    return () => clearTimeout(timer)
  }, [done, router, next])

  if (done) {
    return (
      <div className="space-y-6">
        <div className="flex justify-center">
          <BrandWordmarkLarge />
        </div>
        <div className="card-hairline rounded-2xl border border-border/70 bg-card p-8 text-center shadow-lg">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/15 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight">
            {done === 'set' ? 'PIN guardado' : 'PIN quitado'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {done === 'set'
              ? 'La próxima vez entrás con el PIN en este equipo.'
              : 'En este equipo se vuelve a entrar con la contraseña.'}
          </p>
        </div>
      </div>
    )
  }

  const repeating = chosen !== null

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <BrandWordmarkLarge />
      </div>

      <div className="card-hairline rounded-2xl border border-border/70 bg-card p-5 shadow-lg sm:p-8">
        <div className="space-y-1.5 text-center">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">
            {repeating ? 'Repetilo' : hasPin ? 'Cambiá tu PIN' : 'Elegí un PIN'}
          </h1>
          <p className="text-sm text-muted-foreground text-balance">
            {repeating
              ? 'Para estar seguros de que es ese.'
              : locked
                ? 'El anterior quedó bloqueado. Elegí uno nuevo de 4 números.'
                : first
                  ? 'Cuatro números para entrar más rápido en este equipo, sin tipear la contraseña.'
                  : 'Cuatro números para entrar más rápido en este equipo.'}
          </p>
        </div>

        <div className="mt-4">
          <PinPad
            label={repeating ? 'Repetí el PIN' : 'Elegí el PIN'}
            onComplete={onComplete}
            busy={pending}
            failed={message !== null && !repeating}
            resetKey={round}
          />
        </div>

        <p
          role="status"
          aria-live="polite"
          className="mt-4 min-h-5 text-center font-medium text-destructive text-sm"
        >
          {pending ? <span className="text-muted-foreground">Guardando…</span> : message}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          <button
            type="button"
            onClick={() => router.replace(next)}
            className="min-h-11 rounded-md px-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {first ? 'Ahora no' : 'Volver'}
          </button>
          {hasPin ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="min-h-11 rounded-md px-2 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
            >
              Quitar el PIN de este equipo
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
