'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** La clave vieja (solo «silencio sí o no») se sigue leyendo: quien había silenciado sigue en silencio. */
const MUTE_KEY = 'hub:pos:kitchen:mute'
const LEVEL_KEY = 'hub:pos:kitchen:alert'
const NOTE_MS = 4000

/**
 * locked = el navegador todavía no deja sonar (falta un toque) · on = suena ·
 * muted = silenciada a propósito · none = este dispositivo no tiene con qué.
 */
export type SoundState = 'locked' | 'on' | 'muted' | 'none'

/**
 * Cuánto avisa una comanda nueva. Los socios pidieron que la alerta fuera «más agresiva» (22/11/2026):
 * `loud` es la de fábrica (campana fuerte, la pantalla entera avisa y se repite hasta que alguien la
 * empieza); `soft` es el timbre de antes, para una cocina chica o una barra tranquila.
 */
export type AlertLevel = 'loud' | 'soft'

export type KitchenSound = {
  state: SoundState
  level: AlertLevel
  /** Recién se activó: se avisa unos segundos. */
  justActivated: boolean
  /** Llamar en cada toque o tecla: el navegador solo deja sonar después de uno. */
  unlock: () => void
  /** Fuerte → suave → silencio → fuerte (queda guardado en el dispositivo). Al cambiar suena una vez. */
  cycle: () => void
  /** Entró una comanda (o se le sumó algo a una). No hace nada si no puede sonar. */
  alarm: () => void
  /** Sigue habiendo comandas sin empezar: el recordatorio, más corto. Solo en `loud`. */
  nudge: () => void
}

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const legacy = (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  return window.AudioContext ?? legacy ?? null
}

/** Una nota suave: entrada rápida y salida larga. Suena a timbre, no a alarma. */
function chime(ctx: AudioContext, out: AudioNode, at: number, frequency: number, seconds: number) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.55, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  oscillator.connect(gain)
  gain.connect(out)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.03)
}

/**
 * Un golpe de campana de despacho: onda cuadrada (áspera, corta el ruido de la campana y la plancha)
 * con su octava encima para que también se oiga en un parlante chico de tablet.
 */
function strike(ctx: AudioContext, out: AudioNode, at: number, frequency: number, seconds: number) {
  for (const [type, multiple, level] of [
    ['square', 1, 0.5],
    ['sine', 2, 0.32],
  ] as const) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency * multiple, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
    oscillator.connect(gain)
    gain.connect(out)
    oscillator.start(at)
    oscillator.stop(at + seconds + 0.03)
  }
}

/** Lo fuerte pasa por un compresor: suena al tope sin saturar el parlante. */
function loudBus(ctx: AudioContext): AudioNode {
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.setValueAtTime(-18, ctx.currentTime)
  compressor.knee.setValueAtTime(12, ctx.currentTime)
  compressor.ratio.setValueAtTime(8, ctx.currentTime)
  compressor.attack.setValueAtTime(0.002, ctx.currentTime)
  compressor.release.setValueAtTime(0.12, ctx.currentTime)
  const master = ctx.createGain()
  master.gain.setValueAtTime(1.6, ctx.currentTime)
  master.connect(compressor)
  compressor.connect(ctx.destination)
  return master
}

/** El celular también avisa en el bolsillo (donde el navegador lo permite). */
function buzz(pattern: number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
    }
  } catch {
    // sin vibración: no pasa nada
  }
}

function readLevel(): { muted: boolean; level: AlertLevel } {
  try {
    const saved = window.localStorage.getItem(LEVEL_KEY)
    if (saved === 'loud' || saved === 'soft') return { muted: false, level: saved }
    if (saved === 'mute') return { muted: true, level: 'loud' }
    return { muted: window.localStorage.getItem(MUTE_KEY) === '1', level: 'loud' }
  } catch {
    // sin almacenamiento (modo privado): arranca fuerte
    return { muted: false, level: 'loud' }
  }
}

/**
 * El sonido de la cocina, hecho con WebAudio (sin archivos). El navegador no deja sonar hasta el
 * primer toque o tecla, así que la pantalla lo pide.
 */
export function useKitchenSound(): KitchenSound {
  const [muted, setMuted] = useState(false)
  const [level, setLevel] = useState<AlertLevel>('loud')
  const [running, setRunning] = useState(false)
  const [supported, setSupported] = useState(true)
  const [justActivated, setJustActivated] = useState(false)
  const context = useRef<AudioContext | null>(null)
  const mutedRef = useRef(false)
  const levelRef = useRef<AlertLevel>('loud')
  const runningRef = useRef(false)
  const noteTimer = useRef<number | null>(null)

  useEffect(() => {
    setSupported(audioCtor() !== null)
    const saved = readLevel()
    mutedRef.current = saved.muted
    levelRef.current = saved.level
    setMuted(saved.muted)
    setLevel(saved.level)
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

  const play = useCallback((what: 'alarm' | 'nudge') => {
    const ctx = context.current
    if (!ctx || ctx.state !== 'running') return
    const at = ctx.currentTime + 0.02
    if (levelRef.current === 'soft') {
      // El timbre de siempre: dos notas cortas (sol y do).
      if (what === 'nudge') return
      chime(ctx, ctx.destination, at, 783.99, 0.17)
      chime(ctx, ctx.destination, at + 0.16, 1046.5, 0.3)
      return
    }
    const bus = loudBus(ctx)
    // Tres llamados de dos golpes (mi–la): no se confunde con nada de lo que suena en una cocina.
    const calls = what === 'alarm' ? 3 : 1
    for (let call = 0; call < calls; call++) {
      const start = at + call * 0.46
      strike(ctx, bus, start, 1318.51, 0.16)
      strike(ctx, bus, start + 0.17, 1760, 0.26)
    }
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

  const cycle = useCallback(() => {
    // Fuerte → suave → silencio → fuerte.
    const next: { muted: boolean; level: AlertLevel } = mutedRef.current
      ? { muted: false, level: 'loud' }
      : levelRef.current === 'loud'
        ? { muted: false, level: 'soft' }
        : { muted: true, level: 'loud' }
    mutedRef.current = next.muted
    levelRef.current = next.level
    setMuted(next.muted)
    setLevel(next.level)
    try {
      window.localStorage.setItem(LEVEL_KEY, next.muted ? 'mute' : next.level)
      window.localStorage.setItem(MUTE_KEY, next.muted ? '1' : '0')
    } catch {
      // sin almacenamiento: vale para esta vez
    }
    // Al prenderlo o cambiarlo suena una vez: sirve para probar el volumen de la tele.
    if (!next.muted) wake(() => play('alarm'))
  }, [wake, play])

  const alarm = useCallback(() => {
    if (mutedRef.current) return
    play('alarm')
    if (levelRef.current === 'loud') buzz([220, 90, 220, 90, 420])
    else buzz([160])
  }, [play])

  const nudge = useCallback(() => {
    if (mutedRef.current || levelRef.current !== 'loud') return
    play('nudge')
  }, [play])

  const state: SoundState = !supported ? 'none' : muted ? 'muted' : running ? 'on' : 'locked'
  return { state, level, justActivated, unlock, cycle, alarm, nudge }
}
