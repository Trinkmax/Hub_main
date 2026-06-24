import { describe, expect, it } from 'vitest'
import { gatedTasksDue } from '@/lib/cron/schedule'

// El dispatcher corre cada minuto. `gatedTasksDue` decide qué tareas periódicas
// (no de alta frecuencia) corren en ese tick, según el minuto/hora UTC.
describe('gatedTasksDue', () => {
  it('minuto 0 corre evaluate_time_triggers (15m) y sync_templates (30m), no token refresh', () => {
    const due = gatedTasksDue(new Date('2026-06-24T10:00:00Z'))
    expect(due).toContain('evaluate_time_triggers')
    expect(due).toContain('sync_templates')
    expect(due).not.toContain('refresh_meta_tokens')
  })

  it('minuto 15 corre solo evaluate_time_triggers', () => {
    expect(gatedTasksDue(new Date('2026-06-24T10:15:00Z'))).toEqual(['evaluate_time_triggers'])
  })

  it('minuto 30 corre evaluate_time_triggers y sync_templates', () => {
    const due = gatedTasksDue(new Date('2026-06-24T10:30:00Z'))
    expect(due).toContain('evaluate_time_triggers')
    expect(due).toContain('sync_templates')
  })

  it('minuto 7 no corre ninguna tarea gated', () => {
    expect(gatedTasksDue(new Date('2026-06-24T10:07:00Z'))).toEqual([])
  })

  it('refresh_meta_tokens corre una vez al día (04:20 UTC)', () => {
    expect(gatedTasksDue(new Date('2026-06-24T04:20:00Z'))).toEqual(['refresh_meta_tokens'])
  })

  it('refresh_meta_tokens NO corre a la misma hora pero otro minuto', () => {
    expect(gatedTasksDue(new Date('2026-06-24T04:21:00Z'))).toEqual([])
  })

  it('refresh_meta_tokens NO corre al minuto 20 de otra hora', () => {
    expect(gatedTasksDue(new Date('2026-06-24T05:20:00Z'))).toEqual([])
  })
})
