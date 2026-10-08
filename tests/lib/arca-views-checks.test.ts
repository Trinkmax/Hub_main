// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { arcaTestView } from '@/lib/arca/views'

/**
 * Los textos de los chequeos de «Probar conexión» cuando la prueba se cortó por el plazo
 * (`not_started`) o cuando ARCA rechazó el permiso guardado y se descartó (`ticket_dropped`).
 */
describe('arcaTestView · chequeos cortados y permisos descartados', () => {
  const ctx = {
    alias: 'barplataforma',
    pointOfSale: 7,
    sasName: 'BAR DE PRUEBA SAS',
    environment: 'produccion' as const,
  }

  it('un chequeo que no se llegó a empezar no dice que ARCA falló', () => {
    const view = arcaTestView(
      {
        at: '2026-10-08T13:32:10Z',
        environment: 'produccion',
        status: 'error',
        checks: [
          { key: 'service', ok: true },
          {
            key: 'wsfe_ticket',
            ok: false,
            error: 'arca_unavailable',
            detail: { timeout: true, not_started: true },
          },
        ],
      },
      ctx,
    )
    const check = view.checks.find((c) => c.key === 'wsfe_ticket')
    expect(check?.title).toBe('No se llegó a probar')
    expect(check?.message).toContain('Volvé a tocar «Probar conexión»')
    expect(check?.step).toBeNull()
  })

  it('una llamada que ARCA no contestó a tiempo sigue diciendo que tardó demasiado', () => {
    const view = arcaTestView(
      {
        at: '2026-10-08T13:32:10Z',
        environment: 'produccion',
        status: 'error',
        checks: [
          { key: 'service', ok: false, error: 'arca_unavailable', detail: { timeout: true } },
        ],
      },
      ctx,
    )
    expect(view.checks[0]?.title).toBe('ARCA tardó demasiado')
  })

  it('si el permiso guardado se descartó, el chequeo pide esperar y volver a probar', () => {
    const view = arcaTestView(
      {
        at: '2026-10-08T13:32:10Z',
        environment: 'produccion',
        status: 'error',
        checks: [
          { key: 'service', ok: true },
          { key: 'wsfe_ticket', ok: true },
          {
            key: 'relations',
            ok: false,
            error: 'arca_cuit_not_in_token',
            detail: { listed: false, ticket_dropped: true },
          },
        ],
      },
      ctx,
    )
    const check = view.checks.find((c) => c.key === 'relations')
    expect(check?.message).toContain(
      'ARCA rechazó el permiso guardado y ya lo descartamos: esperá unos minutos y volvé a probar.',
    )
    expect(view.firstProblem?.key).toBe('relations')
  })
})
