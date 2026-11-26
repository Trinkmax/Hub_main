'use client'

import { Delete } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PIN_LENGTH } from '@/lib/auth/pin'
import { cn } from '@/lib/utils'

/**
 * El teclado del PIN.
 *
 * Tiene que andar igual de bien en un Android modesto: por eso no usa el teclado del teléfono (abrirlo
 * es lo más lento de toda la pantalla), no lleva animaciones ni desenfoques, y cada tecla responde en
 * el momento en que el dedo la toca (`pointerdown`), sin esperar a que se levante. Con un teclado de
 * verdad se pueden tipear los números y borrar con Retroceso.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

export function PinPad({
  onComplete,
  busy = false,
  failed = false,
  resetKey = 0,
  label,
}: {
  /** Se llama una vez, cuando están los cuatro números. */
  onComplete: (pin: string) => void
  /** Se está comprobando: las teclas no hacen nada. */
  busy?: boolean
  /** El último intento falló: los puntos se marcan hasta que se vuelve a tocar algo. */
  failed?: boolean
  /** Cambiarlo vacía lo tipeado (después de un error, o al pasar de «elegí» a «repetí»). */
  resetKey?: number
  /** Qué se está pidiendo, para quien usa lector de pantalla. */
  label: string
}) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  // Lo tipeado también en una referencia: avisar «ya están los cuatro» sale del toque mismo y no de un
  // efecto. Con un efecto, al vaciar el teclado y cambiar a la vez lo que hay que hacer con el PIN (de
  // «elegilo» a «repetilo») el mismo PIN se avisaba dos veces y el segundo paso se salteaba.
  const typed = useRef('')
  const done = useRef(false)
  const notify = useRef(onComplete)
  notify.current = onComplete

  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetKey` es la señal para vaciar
  useEffect(() => {
    typed.current = ''
    done.current = false
    setValue('')
    setTouched(false)
  }, [resetKey])

  const press = useCallback(
    (key: string) => {
      if (busy || done.current) return
      const before = typed.current
      const next =
        key === 'del' ? before.slice(0, -1) : before.length >= PIN_LENGTH ? before : before + key
      if (next === before) return
      typed.current = next
      setValue(next)
      setTouched(true)
      try {
        navigator.vibrate?.(8)
      } catch {
        // sin vibración: no pasa nada
      }
      if (next.length === PIN_LENGTH) {
        // Una sola vez por cada vez que se completa; hasta que lo vacíen no acepta más teclas.
        done.current = true
        notify.current(next)
      }
    },
    [busy],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        press(event.key)
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        press('del')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const wrong = failed && !touched

  return (
    <div className="select-none">
      <div
        role="img"
        aria-label={`${label}: ${value.length} de ${PIN_LENGTH} números`}
        className="flex justify-center gap-4 py-2"
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: son cuatro puntos fijos
            key={index}
            className={cn(
              'size-4 rounded-full border-2',
              index < value.length ? 'border-primary bg-primary' : 'border-foreground/35',
              wrong && 'border-destructive bg-destructive/25',
            )}
          />
        ))}
      </div>

      <div className="mx-auto mt-4 grid max-w-[19rem] grid-cols-3 gap-2.5">
        {KEYS.map((key) =>
          key === '' ? (
            <span key="hueco" aria-hidden />
          ) : (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-label={key === 'del' ? 'Borrar el último número' : key}
              // El toque vale apenas apoya el dedo. El `click` queda para quien lo activa con teclado
              // (ahí `detail` es 0); el de un toque o del mouse ya se contó.
              onPointerDown={(event) => {
                event.preventDefault()
                press(key)
              }}
              onClick={(event) => {
                if (event.detail === 0) press(key)
              }}
              className={cn(
                'flex h-[clamp(3.25rem,9.5dvh,4.25rem)] touch-manipulation items-center justify-center rounded-2xl border border-border bg-background font-semibold text-2xl tabular-nums outline-none',
                'active:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                key === 'del' && 'border-transparent bg-transparent text-muted-foreground',
              )}
            >
              {key === 'del' ? <Delete aria-hidden className="size-6" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
