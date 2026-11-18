import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  pendingSetupTitles,
  SETUP_STEPS,
  type SetupStatus,
  setupDone,
} from '@/lib/onboarding/steps'

const MANAGER = resolve(__dirname, '../../app/(manager)/[tenantSlug]')

const all = (value: boolean): SetupStatus => ({
  menuReady: value,
  clubReady: value,
  teamReady: value,
  capacitiesReady: value,
  templatesReady: value,
  eventScheduledReady: value,
  firstReservationReady: value,
  firstArrivalReady: value,
})

describe('los primeros pasos de un bar nuevo', () => {
  it('cada paso lleva a una pantalla que existe', () => {
    for (const step of SETUP_STEPS) {
      const path =
        step
          .href('hub')
          .replace(/^\/hub/, '')
          .split('?')[0] ?? ''
      expect(existsSync(join(MANAGER, path, 'page.tsx')), `${step.key} → ${path}`).toBe(true)
    }
  })

  it('ninguno habla del servicio de mesa anterior', () => {
    // El asistente viejo prometía «recibir pedidos por QR», «panel de cocina» y «cobrar mesas».
    const text = SETUP_STEPS.map((step) => `${step.title} ${step.description} ${step.cta}`).join(
      ' ',
    )
    expect(text).not.toMatch(/\bQR de mesa\b|pedidos? por QR|KDS|cocinero|cerrar (la )?mesa/i)
  })

  it('hay un paso por cada dato, sin repetir', () => {
    const keys = SETUP_STEPS.map((step) => step.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(Object.keys(all(true)).sort())
  })

  it('lo que falta sale por título, en el orden de la lista', () => {
    expect(pendingSetupTitles(all(true))).toEqual([])
    expect(pendingSetupTitles({ ...all(true), teamReady: false, menuReady: false })).toEqual([
      'Cargá tu carta',
      'Sumá a tu equipo',
    ])
    expect(pendingSetupTitles(all(false))).toHaveLength(SETUP_STEPS.length)
  })

  it('está listo solo con todos los pasos hechos', () => {
    expect(setupDone(all(true))).toBe(true)
    expect(setupDone({ ...all(true), firstArrivalReady: false })).toBe(false)
    expect(setupDone(all(false))).toBe(false)
  })
})
