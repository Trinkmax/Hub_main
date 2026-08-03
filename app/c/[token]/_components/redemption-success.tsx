'use client'

import { PartyPopper, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DeliveredRedemption } from '@/lib/wallet/ticket-state'
import { formatPoints } from './wallet-format'

// El cierre del canje. Ocupa el mismo lugar que el QR y con la misma silueta:
// el ticket no "desaparece", se convierte en el tilde. Así el socio entiende que
// lo que estaba mostrando ya se usó, en vez de quedarse mirando un código muerto
// preguntándose si funcionó.
//
// POR QUÉ EL VERDE ES FIJO Y NO DE LA MARCA: el disco vive adentro de una card
// pintada con `--brand-accent`, que en otro bar puede ser rojo o naranja. Un
// tilde "de la marca" en un bar rojo se lee como error justo en el momento en
// que hay que decir "salió bien". El éxito no se tematiza.

const AUTO_DISMISS_MS = 9_000

export function RedemptionSuccess({
  delivered,
  pointsBalance,
  onDone,
}: {
  delivered: DeliveredRedemption
  /** Saldo YA descontado (los puntos se debitan al validar, no al generar el QR). */
  pointsBalance: number
  onDone: () => void
}): React.JSX.Element {
  const [leaving, setLeaving] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const cardRef = useRef<HTMLElement>(null)

  // Se muestra una sola vez y dura unos segundos: si el socio estaba scrolleado
  // en otra parte de la billetera, se la perdía entera. La traemos a la vista.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    cardRef.current?.scrollIntoView({
      block: 'center',
      behavior: reduce ? 'auto' : 'smooth',
    })
  }, [])

  // Se va solo: nadie quiere apretar "cerrar" con el mozo esperando. El botón
  // queda igual para el que prefiere sacarlo del medio ya.
  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), AUTO_DISMISS_MS)
    const gone = window.setTimeout(() => doneRef.current(), AUTO_DISMISS_MS + 260)
    return () => {
      window.clearTimeout(out)
      window.clearTimeout(gone)
    }
  }, [])

  // Un golpecito corto: confirma con el celular en la mano y sin mirar. No todos
  // los navegadores lo tienen y iOS lo ignora — es un extra, no la señal.
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate?.([14, 46, 26])
  }, [])

  const spent = delivered.pointsSpent

  return (
    <section
      ref={cardRef}
      aria-labelledby="canjeado-heading"
      data-leaving={leaving ? '' : undefined}
      className="redeem-done overflow-hidden rounded-2xl bg-(--brand-accent) p-6 text-center text-(--brand-accent-foreground) shadow-glow"
    >
      {/* El anuncio para lectores de pantalla: el tilde es visual, esto no. */}
      <p aria-live="assertive" className="sr-only">
        Canje confirmado: {delivered.rewardName}. Ya te lo entregaron.
      </p>

      <div className="relative mx-auto grid size-24 place-items-center">
        <span className="redeem-ring absolute inset-0 rounded-full" aria-hidden="true" />
        <span
          className="redeem-ring redeem-ring-2 absolute inset-0 rounded-full"
          aria-hidden="true"
        />

        {/* Chispas que salen del disco. Puro adorno → aria-hidden. */}
        <span className="redeem-sparks absolute inset-0" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: partículas fijas, sin identidad propia
              key={i}
              className="redeem-spark"
              style={{ '--a': `${i * 45}deg`, '--i': i } as React.CSSProperties}
            />
          ))}
        </span>

        <span className="redeem-disc relative grid size-24 place-items-center rounded-full">
          <svg viewBox="0 0 52 52" className="size-14" aria-hidden="true" role="presentation">
            <title>Canjeado</title>
            <path
              className="redeem-check"
              d="M14 27.5 L22.5 36 L38 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <h2
        id="canjeado-heading"
        className="redeem-rise mt-4 font-display text-2xl font-semibold tracking-tight"
        style={{ '--d': '220ms' } as React.CSSProperties}
      >
        ¡Canjeado!
      </h2>
      <p
        className="redeem-rise mt-1 text-sm font-medium opacity-90"
        style={{ '--d': '300ms' } as React.CSSProperties}
      >
        {delivered.rewardName}
      </p>

      <div
        className="redeem-rise mt-4 inline-flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold"
        style={{ '--d': '380ms' } as React.CSSProperties}
      >
        {spent > 0 ? (
          <span className="rounded-full bg-(--brand-accent-foreground)/15 px-3 py-1.5 tabular-nums">
            −{formatPoints(spent)} pts · te quedan {formatPoints(pointsBalance)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-(--brand-accent-foreground)/15 px-3 py-1.5">
            <PartyPopper className="size-3.5" aria-hidden="true" />
            Sin gastar puntos
          </span>
        )}
      </div>

      {/* La frase que arregla la frustración original: el socio ya puede pedir otro. */}
      <p
        className="redeem-rise mt-4 inline-flex items-center gap-1.5 text-xs opacity-85"
        style={{ '--d': '460ms' } as React.CSSProperties}
      >
        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
        Ya podés canjear otro beneficio
      </p>

      <button
        type="button"
        onClick={() => {
          setLeaving(true)
          window.setTimeout(() => doneRef.current(), 240)
        }}
        className="redeem-rise mt-5 inline-flex min-h-11 items-center rounded-full bg-(--brand-accent-foreground)/15 px-5 text-xs font-semibold outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--brand-accent-foreground)"
        style={{ '--d': '540ms' } as React.CSSProperties}
      >
        Listo
      </button>

      {/* Hairline que se vacía: dice "esto se va solo" sin escribirlo. */}
      <span className="redeem-timer mt-5 block h-px w-full" aria-hidden="true" />
    </section>
  )
}
