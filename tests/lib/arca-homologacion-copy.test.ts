// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  homologacionStepAnchor,
  homologacionStepFor,
} from '@/components/administracion/guias/arca-guide-model'
import {
  ARCA_ERRORS,
  type ArcaErrorKey,
  classifyArcaError,
  describeArcaError,
  describeArcaErrorKey,
} from '@/lib/arca/errors'
import { ARCA_GUIDE_STEP_IDS } from '@/lib/arca/guide'
import { readSoapResponse } from '@/lib/arca/soap'
import { arcaTestView } from '@/lib/arca/views'
import { ARCA_XML, arcaXml } from '@/tests/fixtures/arca/xml/fixtures'

/**
 * Los textos de ARCA en homologación (las pruebas de quien programa). La corrida real del
 * 08/10 («Probar conexión» con un certificado que no dio WSASS) volvió con
 * `cms.cert.untrusted`, que se clasifica bien (`arca_wrong_environment`), pero el texto era el
 * de producción («es de pruebas y lo estás usando en producción, o al revés») y «Cómo se
 * arregla» llevaba al paso 6 de la guía de producción. En las pruebas el certificado sale de
 * WSASS y se autoriza ahí: el texto lo dice y el link va al paso de «Pruebas (homologación)».
 */

/** La falla del WSAA de homologación ante un certificado de otra autoridad (respuesta real). */
function untrustedFault(): unknown {
  try {
    readSoapResponse(
      { status: 500, body: arcaXml(ARCA_XML.wsaaFaultCertUntrusted) },
      { service: 'wsaa', wsn: 'wsfe', method: 'loginCms' },
    )
  } catch (e) {
    return e
  }
  return null
}

describe('homologación · el certificado que no dio WSASS', () => {
  it('cms.cert.untrusted dice que falta el certificado de WSASS, no que es de pruebas', () => {
    const fault = untrustedFault()
    expect(classifyArcaError(fault)).toBe('arca_wrong_environment')

    const homo = describeArcaError(fault, { environment: 'homologacion', alias: 'bartest' })
    expect(homo.title).toBe('ARCA de pruebas no reconoce el certificado')
    expect(homo.body).toBe(
      'El ARCA de pruebas solo acepta certificados de WSASS (el de producción no sirve acá). Creá el certificado en WSASS con este pedido y subilo.',
    )
    expect(homo).toMatchObject({ step: 's6_certificado', code: 'cms.cert.untrusted' })

    // Producción, igual que antes.
    const prod = describeArcaError(fault, { environment: 'produccion' })
    expect(prod.title).toBe('Certificado del ambiente equivocado')
    expect(prod.body).toBe(ARCA_ERRORS.arca_wrong_environment.body)
  })

  it('la prueba que guardó la corrida real se lee con el texto de las pruebas y va al paso 2', () => {
    const saved = {
      at: '2026-10-08T16:13:28.038217+00:00',
      environment: 'homologacion',
      status: 'error' as const,
      checks: [
        { key: 'service', ok: true, detail: { db: 'OK', app: 'OK', auth: 'OK' } },
        {
          key: 'wsfe_ticket',
          ok: false,
          error: 'arca_wrong_environment',
          detail: { code: 'cms.cert.untrusted' },
        },
      ],
    }
    const view = arcaTestView(saved, {
      alias: 'bartest',
      pointOfSale: 1,
      sasName: 'Bar de Prueba SAS',
      environment: 'homologacion',
    })
    expect(view.checks[0]).toMatchObject({ key: 'service', ok: true })
    expect(view.firstProblem).toMatchObject({
      key: 'wsfe_ticket',
      title: 'ARCA de pruebas no reconoce el certificado',
      step: 's6_certificado',
      code: 'cms.cert.untrusted',
    })
    expect(view.firstProblem?.message).toContain('WSASS')
    expect(homologacionStepFor(view.firstProblem?.step)).toBe(2)
    expect(view.notRun.map((c) => c.key)).toEqual([
      'relations',
      'point_of_sale',
      'numbering',
      'padron',
      'certificate',
    ])

    // La misma prueba en producción conserva su texto.
    const prod = arcaTestView(
      { ...saved, environment: 'produccion' },
      { environment: 'produccion' },
    )
    expect(prod.firstProblem?.title).toBe('Certificado del ambiente equivocado')
  })
})

describe('homologación · las autorizaciones se hacen en WSASS', () => {
  it('wsfe y padrón: «Crear autorización a servicio» con el alias y la SAS representada', () => {
    const wsfe = describeArcaErrorKey('arca_not_authorized', {
      environment: 'homologacion',
      alias: 'bartest',
    })
    expect(wsfe).toMatchObject({
      title: 'Falta autorizar el certificado en WSASS',
      step: 's7_wsfe',
    })
    expect(wsfe.body).toContain('para wsfe, con el alias «bartest»')

    const padron = describeArcaErrorKey('arca_not_authorized', {
      environment: 'homologacion',
      service: 'padron',
      alias: 'bartest',
    })
    expect(padron).toMatchObject({
      title: 'Falta autorizar la consulta del padrón en WSASS',
      step: 's8_padron',
    })
    expect(padron.body).toContain('ws_sr_constancia_inscripcion')
    expect(padron.body).toContain('«bartest»')

    // Sin alias, el respaldo (sin huecos).
    for (const service of [null, 'padron'] as const) {
      expect(
        describeArcaErrorKey('arca_not_authorized', { environment: 'homologacion', service }).body,
      ).not.toMatch(/\{\w+\}/)
    }
    // Producción no cambia: el paso 7 de la guía.
    expect(
      describeArcaErrorKey('arca_not_authorized', { environment: 'produccion', alias: 'x' }).body,
    ).toContain('Hacé el paso 7')
  })

  it('ningún texto de las pruebas manda a un paso de la guía de producción', () => {
    const keys: ArcaErrorKey[] = [
      'arca_wrong_environment',
      'arca_not_authorized',
      'arca_cuit_not_in_token',
      'arca_cert_expired',
      'arca_key_mismatch',
      'arca_already_authenticated',
    ]
    for (const key of keys) {
      const view = describeArcaErrorKey(key, {
        environment: 'homologacion',
        alias: 'bartest',
        sasName: 'BAR DE PRUEBA SAS',
        pointOfSale: 1,
      })
      expect(view.body, key).toMatch(/WSASS|pruebas/)
      expect(view.body, key).not.toMatch(/paso \d|sistema de caja|\{\w+\}/)
      // El paso de la guía sigue siendo el mismo (la pantalla lo traduce a las pruebas).
      expect(view.step, key).toBe(ARCA_ERRORS[key].step)
    }
    expect(
      describeArcaErrorKey('arca_already_authenticated', { environment: 'homologacion' }).body,
    ).toContain('esperá 10 minutos')
  })
})

describe('homologacionStepFor (el paso de las pruebas que arregla cada cosa)', () => {
  it('pedido 1 · certificado y autorizaciones 2 · punto de venta 3 · probar 4', () => {
    const expected: Record<string, number | null> = {
      s0_prereq: null,
      s1_elegir_sas: null,
      s2_punto_venta: 3,
      s3_factura_a: null,
      s4_certificados: null,
      s5_pedido: 1,
      s6_certificado: 2,
      s7_wsfe: 2,
      s8_padron: 2,
      s9_probar: 4,
      s10_mis_comprobantes: null,
    }
    for (const id of ARCA_GUIDE_STEP_IDS) expect(homologacionStepFor(id), id).toBe(expected[id])
    expect(homologacionStepFor(null)).toBeNull()
    expect(homologacionStepFor('otra-cosa')).toBeNull()
    expect(homologacionStepAnchor(2)).toBe('homologacion-paso-2')
  })
})
