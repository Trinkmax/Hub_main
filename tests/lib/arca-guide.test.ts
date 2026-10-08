import { describe, expect, it } from 'vitest'
import { ARCA_ERRORS } from '@/lib/arca/errors'
import {
  ARCA_CHECK_KEYS,
  ARCA_CHECKS,
  ARCA_GUIDE_STEP_IDS,
  ARCA_GUIDE_STEPS,
  ARCA_REQUIRED_CHECKS,
  ARCA_REQUIRED_STEPS,
  type ArcaGuideStepId,
  type ArcaStepState,
  type ArcaTestCheck,
  type ArcaTestResult,
  arcaGuideState,
  arcaTestStatus,
  type GuideConnection,
  type GuideProgressRow,
  guideProgressSummary,
  guideStep,
  isArcaCheckKey,
  isArcaGuideStepId,
  stepForFailedCheck,
} from '@/lib/arca/guide'

const NOW = new Date('2026-10-08T15:00:00.000Z')

const EMPTY: GuideConnection = {
  status: null,
  hasSasCuit: true,
  hasCsr: false,
  hasCertificate: false,
  certNotAfter: null,
  pointOfSale: null,
  allowedClasses: ['B'],
}

const WITH_CERT: GuideConnection = {
  status: 'cert_ready',
  hasSasCuit: true,
  hasCsr: true,
  hasCertificate: true,
  certNotAfter: '2028-09-10T00:00:00.000Z',
  pointOfSale: 5,
  allowedClasses: ['B'],
}

const ALL_OK: ArcaTestCheck[] = ARCA_CHECK_KEYS.map((key) => ({ key, ok: true }))

function testResult(checks: ArcaTestCheck[], at = '2026-10-08T13:00:00.000Z'): ArcaTestResult {
  return { at, environment: 'produccion', status: arcaTestStatus(checks), checks }
}

function failing(key: string, error: string): ArcaTestCheck[] {
  return ARCA_CHECK_KEYS.map((k) =>
    k === key ? { key: k, ok: false, error } : { key: k, ok: true },
  )
}

function byId(states: readonly ArcaStepState[]): Record<ArcaGuideStepId, ArcaStepState> {
  return Object.fromEntries(states.map((s) => [s.id, s])) as Record<ArcaGuideStepId, ArcaStepState>
}

function statuses(states: readonly ArcaStepState[]): string {
  return states.map((s) => `${s.n}:${s.status}`).join(' ')
}

const mark = (step: ArcaGuideStepId, doneAt = '2026-10-08T12:00:00.000Z'): GuideProgressRow => ({
  step,
  doneAt,
  doneByName: 'Nacho',
})

describe('los pasos', () => {
  it('van del 0 al 10, en orden, con ids que acepta la base', () => {
    expect(ARCA_GUIDE_STEPS.map((s) => s.id)).toEqual([...ARCA_GUIDE_STEP_IDS])
    ARCA_GUIDE_STEPS.forEach((s, i) => {
      expect(s.n).toBe(i)
      expect(s.id).toMatch(/^[a-z0-9_]{2,40}$/) // CHECK de acc_guide_progress.step
      expect(s.title.length).toBeGreaterThan(5)
      expect(s.minutes).toBeGreaterThan(0)
      expect(guideStep(s.id)).toBe(s)
    })
    expect(ARCA_REQUIRED_STEPS).toHaveLength(9) // «5 de 9»
    expect(ARCA_GUIDE_STEPS.filter((s) => s.optional).map((s) => s.id)).toEqual([
      's3_factura_a',
      's10_mis_comprobantes',
    ])
    expect(isArcaGuideStepId('s7_wsfe')).toBe(true)
    expect(isArcaGuideStepId('s99')).toBe(false)
  })

  it('cada error del catálogo apunta a un paso que existe', () => {
    for (const info of Object.values(ARCA_ERRORS)) {
      if (info.step !== null) expect(isArcaGuideStepId(info.step)).toBe(true)
    }
  })
})

describe('«Probar conexión»', () => {
  it('los chequeos obligatorios son los mismos que exige acc_arca_record_test', () => {
    expect(ARCA_REQUIRED_CHECKS).toEqual([
      'service',
      'wsfe_ticket',
      'relations',
      'point_of_sale',
      'padron',
    ])
    expect(ARCA_CHECK_KEYS.map((k) => ARCA_CHECKS[k].n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const key of ARCA_CHECK_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]{1,39}$/)
    expect(isArcaCheckKey('padron')).toBe(true)
    expect(isArcaCheckKey('otro')).toBe(false)
  })

  it('arcaTestStatus', () => {
    expect(arcaTestStatus(ALL_OK)).toBe('connected')
    expect(arcaTestStatus(failing('padron', 'arca_not_authorized'))).toBe('error')
    expect(arcaTestStatus(failing('numbering', 'arca_unavailable'))).toBe('connected')
    expect(arcaTestStatus(failing('certificate', 'arca_cert_expired'))).toBe('connected')
    expect(arcaTestStatus(ALL_OK.filter((c) => c.key !== 'relations'))).toBe('error')
  })

  it('stepForFailedCheck: el padrón usa el paso 8', () => {
    expect(stepForFailedCheck('wsfe_ticket', 'arca_not_authorized')).toBe('s7_wsfe')
    expect(stepForFailedCheck('padron', 'arca_not_authorized')).toBe('s8_padron')
    expect(stepForFailedCheck('padron', 'arca_cuit_not_in_token')).toBe('s8_padron')
    expect(stepForFailedCheck('point_of_sale', 'arca_pos_blocked')).toBe('s2_punto_venta')
    expect(stepForFailedCheck('service', 'arca_unavailable')).toBeNull()
    expect(stepForFailedCheck('service', 'no_es_una_clave')).toBeNull()
  })
})

describe('arcaGuideState', () => {
  it('sin nada: «Te toca» el paso 0 y el resto pendiente', () => {
    const states = arcaGuideState(EMPTY, [], null, NOW)
    expect(statuses(states)).toBe(
      '0:todo 1:pending 2:pending 3:pending 4:pending 5:pending 6:pending 7:pending 8:pending 9:pending 10:pending',
    )
    expect(guideProgressSummary(states)).toEqual({ done: 0, total: 9, next: 's0_prereq' })
  })

  it('pasos manuales hechos, pedido generado: «Te toca» el punto de venta', () => {
    const conn: GuideConnection = { ...EMPTY, status: 'key_ready', hasCsr: true }
    const states = byId(arcaGuideState(conn, [mark('s0_prereq'), mark('s1_elegir_sas')], null, NOW))
    expect(states.s0_prereq).toMatchObject({ status: 'done', source: 'manual', doneBy: 'Nacho' })
    expect(states.s1_elegir_sas.status).toBe('done')
    expect(states.s2_punto_venta.status).toBe('todo')
    expect(states.s4_certificados.status).toBe('pending')
    expect(states.s5_pedido).toMatchObject({
      status: 'done',
      source: 'auto',
      doneAt: null,
      doneBy: null,
    })
  })

  it('el paso 0 marcado sin la CUIT de la SAS queda para revisar', () => {
    const states = byId(
      arcaGuideState({ ...EMPTY, hasSasCuit: false }, [mark('s0_prereq')], null, NOW),
    )
    expect(states.s0_prereq).toMatchObject({ status: 'check', reason: 'sas_cuit_missing' })
    expect(states.s1_elegir_sas.status).toBe('todo')
  })

  it('con el certificado subido se dan por hechos los pasos de ARCA anteriores', () => {
    const states = byId(arcaGuideState(WITH_CERT, [mark('s0_prereq')], null, NOW))
    for (const id of [
      's1_elegir_sas',
      's2_punto_venta',
      's4_certificados',
      's5_pedido',
      's6_certificado',
    ] as const) {
      expect(states[id].status, id).toBe('done')
    }
    expect(states.s7_wsfe.status).toBe('todo')
    expect(states.s8_padron.status).toBe('pending')
    expect(states.s9_probar.status).toBe('pending')
    expect(states.s3_factura_a.status).toBe('pending') // opcional: nunca «Te toca»
  })

  it('conectado: todo lo obligatorio hecho, confirmado por la prueba', () => {
    const states = arcaGuideState(
      { ...WITH_CERT, status: 'connected' },
      [],
      testResult(ALL_OK),
      NOW,
    )
    const s = byId(states)
    expect(s.s7_wsfe).toMatchObject({ status: 'done', source: 'test' })
    expect(s.s8_padron).toMatchObject({ status: 'done', source: 'test' })
    expect(s.s9_probar).toMatchObject({ status: 'done', source: 'test' })
    expect(s.s0_prereq.status).toBe('done')
    expect(guideProgressSummary(states)).toEqual({ done: 9, total: 9, next: null })
  })

  it('falta autorizar Facturación Electrónica: el 7 a revisar y la prueba no anduvo', () => {
    const states = arcaGuideState(
      { ...WITH_CERT, status: 'error' },
      [mark('s7_wsfe', '2026-10-08T12:00:00.000Z')],
      testResult(failing('wsfe_ticket', 'arca_not_authorized')),
      NOW,
    )
    const s = byId(states)
    expect(s.s7_wsfe).toMatchObject({ status: 'check', reason: 'arca_not_authorized' })
    expect(s.s9_probar).toMatchObject({ status: 'failed', reason: 'arca_not_authorized' })
    expect(guideProgressSummary(states).next).toBe('s7_wsfe')
  })

  it('marcado «Ya lo hice» DESPUÉS de la prueba: gana la marca hasta la próxima prueba', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error' },
        [mark('s7_wsfe', '2026-10-08T14:00:00.000Z')],
        testResult(failing('wsfe_ticket', 'arca_not_authorized'), '2026-10-08T13:00:00.000Z'),
        NOW,
      ),
    )
    expect(s.s7_wsfe).toMatchObject({ status: 'done', source: 'manual' })
    expect(s.s9_probar.status).toBe('failed')
  })

  it('falta autorizar el padrón: a revisar el 8, no el 7', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error' },
        [],
        testResult(failing('padron', 'arca_not_authorized')),
        NOW,
      ),
    )
    expect(s.s7_wsfe).toMatchObject({ status: 'done', source: 'test' })
    expect(s.s8_padron).toMatchObject({ status: 'check', reason: 'arca_not_authorized' })
  })

  it('un paso de la plataforma que falla queda «No anduvo»', () => {
    const pos = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error' },
        [],
        testResult(failing('point_of_sale', 'arca_pos_not_enabled')),
        NOW,
      ),
    )
    expect(pos.s2_punto_venta).toMatchObject({ status: 'failed', reason: 'arca_pos_not_enabled' })

    const env = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error' },
        [],
        testResult(failing('wsfe_ticket', 'arca_wrong_environment')),
        NOW,
      ),
    )
    expect(env.s6_certificado).toMatchObject({ status: 'failed', reason: 'arca_wrong_environment' })
  })

  it('ARCA caído no señala ningún paso, solo la prueba', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error' },
        [],
        testResult(failing('service', 'arca_unavailable')),
        NOW,
      ),
    )
    expect(s.s9_probar).toMatchObject({ status: 'failed', reason: 'arca_unavailable' })
    expect(s.s6_certificado.status).toBe('done')
    expect(s.s2_punto_venta.status).toBe('done')
  })

  it('después de subir otro certificado, la prueba vieja ya no cuenta', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'cert_ready' },
        [],
        testResult(failing('wsfe_ticket', 'arca_not_authorized')),
        NOW,
      ),
    )
    expect(s.s7_wsfe.status).toBe('todo')
    expect(s.s9_probar.status).toBe('pending')
  })

  it('certificado vencido: el 6 no anduvo', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'connected', certNotAfter: '2026-10-01T00:00:00.000Z' },
        [],
        testResult(ALL_OK),
        NOW,
      ),
    )
    expect(s.s6_certificado).toMatchObject({ status: 'failed', reason: 'cert_expired' })
  })

  it('opcionales: Factura A por la configuración y Mis Comprobantes a mano', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, allowedClasses: ['B', 'A'] },
        [mark('s10_mis_comprobantes')],
        null,
        NOW,
      ),
    )
    expect(s.s3_factura_a).toMatchObject({ status: 'done', source: 'auto' })
    expect(s.s10_mis_comprobantes).toMatchObject({
      status: 'done',
      source: 'manual',
      doneBy: 'Nacho',
    })
  })

  it('desconectada: no cuenta el certificado de antes', () => {
    const s = byId(
      arcaGuideState({ ...WITH_CERT, status: 'disconnected', hasCsr: false }, [], null, NOW),
    )
    expect(s.s6_certificado.status).not.toBe('done')
    expect(s.s5_pedido.status).not.toBe('done')
  })

  it('la prueba fallida sin el detalle usa last_error_key', () => {
    const s = byId(
      arcaGuideState(
        { ...WITH_CERT, status: 'error', lastErrorKey: 'arca_key_mismatch' },
        [],
        null,
        NOW,
      ),
    )
    expect(s.s9_probar).toMatchObject({ status: 'failed', reason: 'arca_key_mismatch' })
  })

  it('las filas de pasos que no existen se ignoran', () => {
    const states = arcaGuideState(
      EMPTY,
      [{ step: 'otro_paso', doneAt: NOW.toISOString() }],
      null,
      NOW,
    )
    expect(statuses(states).startsWith('0:todo')).toBe(true)
  })
})
