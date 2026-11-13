'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MUTE_KEY = 'hub:pos:kitchen:mute'
const NOTE_MS = 4000

/**
 * locked = el navegador todavía no deja sonar (falta un toque) · on = suena ·
 * muted = silenciada a propósito · none = este dispositivo no tiene con qué.
 */
export type SoundState = 'locked' | 'on' | 'muted' | 'none'

export type KitchenSound = {
  state: SoundState
  /** Recién se activó: se avisa unos segundos. */
  justActivated: boolean
  /** Llamar en cada toque o tecla: el navegador solo deja sonar después de uno. */
  unlock: () => void
  /** Silenciar o volver a prender (queda guardado en el dispositivo). */
  toggle: () => void
  /** El aviso de comanda nueva. No hace nada si no puede sonar. */
  beep: () => void
}

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const legacy = (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  return window.AudioContext ?? legacy ?? null
}

function tone(ctx: AudioContext, at: number, frequency: number, seconds: number) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, at)
  // Entrada rápida y salida suave: suena a timbre, no a alarma.
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.55, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.03)
}

/**
 * El sonido de la cocina: dos notas cortas (sol y do) hechas con WebAudio, sin archivos.
 * El navegador no deja sonar hasta el primer toque o tecla, así que la pantalla lo pide.
 */
export function useKitchenSound(): KitchenSound {
  const [muted, setMuted] = useState(false)
  const [running, setRunning] = useState(false)
  const [supported, setSupported] = useState(true)
  const [justActivated, setJustActivated] = useState(false)
  const context = useRef<AudioContext | null>(null)
  const mutedRef = useRef(false)
  const runningRef = useRef(false)
  const noteTimer = useRef<number | null>(null)

  useEffect(() => {
    setSupported(audioCtor() !== null)
    try {
      const saved = window.localStorage.getItem(MUTE_KEY) === '1'
      mutedRef.current = saved
      setMuted(saved)
    } catch {
      // sin almacenamiento (modo privado): arranca con sonido
    }
    return () => {
      if (noteTimer.current !== null) window.clearTimeout(noteTimer.current)
      void context.current?.close().catch(() => {})
      context.current = null
      runningRef.current = false
    }
  }, [])

  /** Deja anotado si el audio corre; la primera vez que arranca, lo avisa unos segundos. */
  const settle = useCallback((ctx: AudioContext): boolean => {
    const on = ctx.state === 'running'
    if (on && !runningRef.current) {
      setJustActivated(true)
      if (noteTimer.current !== null) window.clearTimeout(noteTimer.current)
      noteTimer.current = window.setTimeout(() => setJustActivated(false), NOTE_MS)
    }
    runningRef.current = on
    setRunning(on)
    return on
  }, [])

  const play = useCallback(() => {
    const ctx = context.current
    if (!ctx || ctx.state !== 'running') return
    const at = ctx.currentTime + 0.02
    tone(ctx, at, 783.99, 0.17)
    tone(ctx, at + 0.16, 1046.5, 0.3)
  }, [])

  const wake = useCallback(
    (then?: () => void) => {
      const Ctor = audioCtor()
      if (!Ctor) return
      try {
        if (!context.current) {
          const created = new Ctor()
          context.current = created
          // El navegador lo puede volver a dormir (otra app toma el audio): la pantalla lo vuelve a pedir.
          created.addEventListener('statechange', () => {
            if (context.current === created) settle(created)
          })
        }
        const ctx = context.current
        if (settle(ctx)) {
          then?.()
          return
        }
        void ctx
          .resume()
          .then(() => {
            if (settle(ctx)) then?.()
          })
          .catch(() => {})
      } catch {
        setSupported(false)
      }
    },
    [settle],
  )

  const unlock = useCallback(() => {
    if (mutedRef.current || runningRef.current) return
    wake()
  }, [wake])

  const toggle = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    try {
      window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      // idem
    }
    // Al prenderlo suena una vez: sirve para probar el volumen de la tele.
    if (!next) wake(play)
  }, [wake, play])

  const beep = useCallback(() => {
    if (mutedRef.current) return
    play()
  }, [play])

  const state: SoundState = !supported ? 'none' : muted ? 'muted' : running ? 'on' : 'locked'
  return { state, justActivated, unlock, toggle, beep }
}
