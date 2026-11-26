/**
 * Cómo suena un aviso de cocina con la app abierta. Solo cliente (usa `AudioContext`).
 *
 *   listo        tres notas que suben: hay que ir a buscar algo;
 *   en marcha    un toque corto: la cocina lo vio y lo empezó;
 *   todavía no   dos notas que bajan.
 *
 * El navegador deja sonar recién después de un toque: `unlock` se llama en el primero. Los iPhone no
 * vibran desde la web; ahí queda el sonido.
 */
import type { NoticeKind } from './types'

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const legacy = (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  return window.AudioContext ?? legacy ?? null
}

function note(ctx: AudioContext, at: number, frequency: number, seconds: number, level: number) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(level, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.03)
}

const TUNES: Record<
  NoticeKind,
  readonly [offset: number, frequency: number, seconds: number, level: number][]
> = {
  ready: [
    [0, 880, 0.16, 0.6],
    [0.15, 1174.66, 0.16, 0.6],
    [0.3, 1567.98, 0.42, 0.65],
  ],
  preparing: [[0, 659.25, 0.14, 0.35]],
  not_ready: [
    [0, 587.33, 0.16, 0.4],
    [0.17, 440, 0.24, 0.4],
  ],
}

export type NoticeSound = {
  /** Llamar en el primer toque: sin eso el navegador no deja sonar. */
  unlock: () => void
  play: (kind: NoticeKind) => void
  close: () => void
}

export function createNoticeSound(): NoticeSound {
  let ctx: AudioContext | null = null
  const ensure = () => {
    if (ctx) return ctx
    const Ctor = audioCtor()
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      ctx = null
    }
    return ctx
  }
  return {
    unlock: () => {
      const audio = ensure()
      if (audio && audio.state === 'suspended') void audio.resume().catch(() => {})
    },
    play: (kind) => {
      const audio = ensure()
      if (!audio || audio.state !== 'running') return
      const at = audio.currentTime + 0.02
      for (const [offset, frequency, seconds, level] of TUNES[kind]) {
        note(audio, at + offset, frequency, seconds, level)
      }
    },
    close: () => {
      void ctx?.close().catch(() => {})
      ctx = null
    },
  }
}
