import { describe, expect, it } from 'vitest'
import { PROBE_MS, type ProbeableRealtime, probeConnection } from '@/lib/realtime/probe'

/** Un cliente de Realtime de mentira: lleva la cuenta de lo que le piden. */
function fakeRealtime(over: { channels?: number; connected?: boolean; pending?: string | null }) {
  const calls = { connect: 0, heartbeats: 0 }
  const state = {
    connected: over.connected ?? true,
    pending: over.pending ?? null,
  }
  const realtime: ProbeableRealtime & { answer(): void } = {
    getChannels: () => Array.from({ length: over.channels ?? 1 }),
    isConnected: () => state.connected,
    connect: () => {
      calls.connect += 1
    },
    get pendingHeartbeatRef() {
      return state.pending
    },
    sendHeartbeat: async () => {
      calls.heartbeats += 1
      // Como la librería: con uno pendiente, el segundo lo da por vencido y reconecta.
      if (state.pending) {
        state.pending = null
        state.connected = false
        return
      }
      state.pending = `ref-${calls.heartbeats}`
    },
    /** El servidor contesta el latido. */
    answer: () => {
      state.pending = null
    },
  }
  return { realtime, calls, state }
}

/** Un reloj de mentira: guarda lo que se programó para correrlo a mano. */
function fakeLater() {
  const queued: Array<{ run: () => void; ms: number }> = []
  return {
    later: (run: () => void, ms: number) => {
      queued.push({ run, ms })
    },
    flush: () => {
      for (const each of queued.splice(0)) each.run()
    },
    queued,
  }
}

describe('revisar la conexión en vivo al volver la pantalla', () => {
  it('sin canales no hace nada', () => {
    const { realtime, calls } = fakeRealtime({ channels: 0 })
    const clock = fakeLater()
    expect(probeConnection(realtime, clock.later)).toBe('idle')
    expect(calls).toEqual({ connect: 0, heartbeats: 0 })
    expect(clock.queued).toHaveLength(0)
  })

  it('si ya estaba cerrada, pide abrirla', () => {
    const { realtime, calls } = fakeRealtime({ connected: false })
    const clock = fakeLater()
    expect(probeConnection(realtime, clock.later)).toBe('connecting')
    expect(calls.connect).toBe(1)
    expect(calls.heartbeats).toBe(0)
  })

  it('sana: manda un latido, contesta y no reconecta', () => {
    const { realtime, calls, state } = fakeRealtime({})
    const clock = fakeLater()
    expect(probeConnection(realtime, clock.later)).toBe('probing')
    expect(calls.heartbeats).toBe(1)
    expect(clock.queued[0]?.ms).toBe(PROBE_MS)
    realtime.answer()
    clock.flush()
    expect(calls.heartbeats).toBe(1)
    expect(state.connected).toBe(true)
  })

  it('muerta: el latido no contesta y se da por vencido (la librería reconecta)', () => {
    const { realtime, calls, state } = fakeRealtime({})
    const clock = fakeLater()
    probeConnection(realtime, clock.later)
    clock.flush()
    expect(calls.heartbeats).toBe(2)
    expect(state.connected).toBe(false)
  })

  it('con un latido de antes de bloquear todavía pendiente, lo espera en vez de vencerlo al toque', () => {
    const { realtime, calls, state } = fakeRealtime({ pending: 'viejo' })
    const clock = fakeLater()
    probeConnection(realtime, clock.later)
    expect(calls.heartbeats).toBe(0)
    // Sigue sin contestar: ahora sí se vence.
    clock.flush()
    expect(calls.heartbeats).toBe(1)
    expect(state.connected).toBe(false)
  })

  it('si el latido de antes contesta a tiempo, no reconecta', () => {
    const { realtime, calls, state } = fakeRealtime({ pending: 'viejo' })
    const clock = fakeLater()
    probeConnection(realtime, clock.later)
    realtime.answer()
    clock.flush()
    expect(calls.heartbeats).toBe(0)
    expect(state.connected).toBe(true)
  })
})
