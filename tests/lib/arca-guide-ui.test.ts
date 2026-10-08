import { describe, expect, it } from 'vitest'
import {
  ARCA_CLASS_CHOICES,
  type ArcaClassChoice,
  allowedClassesFor,
  arcaCardState,
  arcaMockData,
  CERT_PRECHECK_MESSAGES,
  certificateNote,
  classChoiceFor,
  DEFAULT_MOCK_DATA,
  doneNote,
  GUIDE_STATUS_TEXT,
  guideStatusText,
  guideStepById,
  nextGuideStep,
  nextStepLine,
  precheckCertFile,
  progressPercent,
  progressText,
  sasLabel,
  stepAnchor,
  stepIdForHash,
  suggestArcaAlias,
  textToBase64,
} from '@/components/administracion/guias/arca-guide-model'
import {
  ARCA_GUIDE_STEP_IDS,
  ARCA_GUIDE_STEPS,
  type ArcaConnectionStatus,
  type ArcaStepStatus,
  arcaGuideState,
  guideProgressSummary,
} from '@/lib/arca/guide'
import {
  aliasField,
  arcaSettingsSchema,
  CERT_FILE_MAX_BYTES,
  decodeUploadedFile,
  UNREADABLE_CERT_MESSAGE,
} from '@/lib/arca/schemas'
import type { ArcaCertificateView } from '@/lib/arca/views'

/**
 * Lo puro de la guía «Conectar ARCA» y de la pestaña ARCA: cómo se dice cada estado, la tarjeta
 * A·B·C·D, el aviso del certificado, la Factura A elegida, el alias que proponemos, los anclajes
 * `#paso-N`, el chequeo del archivo antes de subirlo y los datos de las maquetas.
 */

describe('estado de un paso en texto', () => {
  it('cada estado tiene su texto, nunca solo color', () => {
    const statuses: ArcaStepStatus[] = ['done', 'todo', 'pending', 'check', 'failed']
    expect(statuses.map((s) => guideStatusText(s))).toEqual([
      'Hecho',
      'Te toca',
      'Pendiente',
      'Revisar',
      'No anduvo',
    ])
    expect(Object.keys(GUIDE_STATUS_TEXT).sort()).toEqual([...statuses].sort())
  })

  it('un paso opcional sin hacer dice «Opcional»; hecho, «Hecho»', () => {
    expect(guideStatusText('pending', true)).toBe('Opcional')
    expect(guideStatusText('done', true)).toBe('Hecho')
    expect(guideStatusText('check', true)).toBe('Revisar')
  })
})

describe('doneNote', () => {
  const base = { status: 'done' as const, doneAt: null, doneBy: null }

  it('marcado a mano: «Hecho el 08/10 por Nacho», con el día de Córdoba', () => {
    expect(
      doneNote({ ...base, source: 'manual', doneAt: '2026-10-08T15:00:00Z', doneBy: 'Nacho' }),
    ).toBe('Hecho el 08/10 por Nacho')
    // 02:00 UTC es todavía el 7 en Córdoba (UTC−3).
    expect(
      doneNote({ ...base, source: 'manual', doneAt: '2026-10-08T02:00:00Z', doneBy: null }),
    ).toBe('Hecho el 07/10')
    expect(doneNote({ ...base, source: 'manual', doneAt: null, doneBy: '  ' })).toBe(
      'Lo marcaron como hecho',
    )
  })

  it('lo vio la plataforma o lo confirmó la prueba', () => {
    expect(doneNote({ ...base, source: 'auto' })).toBe('Hecho: lo vimos solo')
    expect(doneNote({ ...base, source: 'test' })).toBe('Hecho: lo confirmó la prueba')
  })

  it('sin hacer: nada', () => {
    for (const status of ['todo', 'pending', 'check', 'failed'] as const) {
      expect(doneNote({ status, source: null, doneAt: null, doneBy: null })).toBeNull()
    }
  })
})

describe('anclajes #paso-N', () => {
  it('cada paso ida y vuelta: id → #paso-N → id', () => {
    for (const step of ARCA_GUIDE_STEPS) {
      expect(stepIdForHash(`#${stepAnchor(step.n)}`)).toBe(step.id)
      expect(stepIdForHash(stepAnchor(step.n))).toBe(step.id)
    }
  })

  it('lo que no es un paso da null', () => {
    for (const hash of [
      '',
      '#',
      '#paso-11',
      '#paso-',
      '#paso-5x',
      '#homologacion',
      'paso5',
      null,
    ]) {
      expect(stepIdForHash(hash)).toBeNull()
    }
    expect(guideStepById('s99_nada')).toBeNull()
    expect(guideStepById('s6_certificado')?.n).toBe(6)
  })

  it('el siguiente paso sigue el orden de la guía (opcionales incluidos)', () => {
    expect(nextGuideStep('s0_prereq')?.id).toBe('s1_elegir_sas')
    expect(nextGuideStep('s2_punto_venta')?.id).toBe('s3_factura_a')
    expect(nextGuideStep('s9_probar')?.id).toBe('s10_mis_comprobantes')
    expect(nextGuideStep('s10_mis_comprobantes')).toBeNull()
  })
})

describe('avance', () => {
  it('«5 de 9 pasos listos» y el porcentaje de la barra', () => {
    expect(progressText({ done: 5, total: 9 })).toBe('5 de 9 pasos listos')
    expect(progressText({ done: 1, total: 1 })).toBe('1 de 1 paso listo')
    expect(progressPercent({ done: 5, total: 9 })).toBe(56)
    expect(progressPercent({ done: 9, total: 9 })).toBe(100)
    expect(progressPercent({ done: 0, total: 0 })).toBe(0)
    expect(progressPercent({ done: 12, total: 9 })).toBe(100)
  })

  it('la línea de lo próximo según el estado del paso', () => {
    const statuses = [
      { id: 's6_certificado' as const, status: 'todo' as const },
      { id: 's7_wsfe' as const, status: 'check' as const },
      { id: 's9_probar' as const, status: 'failed' as const },
    ]
    expect(nextStepLine({ next: 's6_certificado' }, statuses)).toMatchObject({
      prefix: 'Te toca',
      step: { n: 6 },
    })
    expect(nextStepLine({ next: 's7_wsfe' }, statuses)?.prefix).toBe('Revisá')
    expect(nextStepLine({ next: 's9_probar' }, statuses)?.prefix).toBe('No anduvo')
    expect(nextStepLine({ next: null }, statuses)).toBeNull()
  })

  it('con el estado real de la guía: un bar sin nada arranca en el paso 0', () => {
    const states = arcaGuideState(
      {
        status: null,
        hasSasCuit: true,
        hasCsr: false,
        hasCertificate: false,
        certNotAfter: null,
        pointOfSale: null,
        allowedClasses: ['B'],
      },
      [],
      null,
    )
    const summary = guideProgressSummary(states)
    expect(progressText(summary)).toBe('0 de 9 pasos listos')
    expect(nextStepLine(summary, states)).toMatchObject({ prefix: 'Te toca', step: { n: 0 } })
  })
})

describe('tarjeta de Ajustes › ARCA (A · B · C · D)', () => {
  const conn = (status: ArcaConnectionStatus) => ({ status })

  it('sin fila ni pasos: sin empezar; con algún paso marcado: en curso', () => {
    expect(arcaCardState(null, { done: 0 })).toBe('not_started')
    expect(arcaCardState(null, { done: 2 })).toBe('in_progress')
    expect(arcaCardState(conn('draft'), { done: 0 })).toBe('not_started')
    expect(arcaCardState(conn('draft'), { done: 1 })).toBe('in_progress')
  })

  it('con pedido o certificado: en curso', () => {
    expect(arcaCardState(conn('key_ready'), { done: 0 })).toBe('in_progress')
    expect(arcaCardState(conn('cert_ready'), { done: 6 })).toBe('in_progress')
  })

  it('la prueba manda: conectado o con un problema', () => {
    expect(arcaCardState(conn('connected'), { done: 9 })).toBe('connected')
    expect(arcaCardState(conn('error'), { done: 8 })).toBe('error')
  })

  it('desconectada: vuelve a sin empezar, o en curso si quedaron pasos hechos', () => {
    expect(arcaCardState(conn('disconnected'), { done: 0 })).toBe('not_started')
    expect(arcaCardState(conn('disconnected'), { done: 3 })).toBe('in_progress')
  })
})

describe('certificateNote', () => {
  const cert = (over: Partial<ArcaCertificateView>): ArcaCertificateView => ({
    serial: 'AB12',
    issuer: 'CN=Computadores',
    notBefore: '2026-09-10T12:00:00.000Z',
    notAfter: '2028-09-10T12:00:00.000Z',
    daysLeft: 701,
    expired: false,
    renewSoon: false,
    ...over,
  })

  it('vigente: hasta cuándo', () => {
    expect(certificateNote(cert({}))).toEqual({
      tone: 'ok',
      text: 'Certificado hasta el 10/09/2028.',
    })
  })

  it('menos de 30 días: aviso con los días que faltan', () => {
    expect(certificateNote(cert({ daysLeft: 12, renewSoon: true }))).toEqual({
      tone: 'warning',
      text: 'El certificado vence en 12 días (el 10/09/2028): renovalo antes.',
    })
    expect(certificateNote(cert({ daysLeft: 1, renewSoon: true }))?.text).toContain('en 1 día ')
    expect(certificateNote(cert({ daysLeft: 0, renewSoon: true }))?.text).toContain('vence hoy')
  })

  it('vencido: error', () => {
    expect(certificateNote(cert({ daysLeft: -3, expired: true }))).toEqual({
      tone: 'error',
      text: 'El certificado venció el 10/09/2028.',
    })
  })

  it('sin certificado: nada', () => {
    expect(certificateNote(null)).toBeNull()
  })
})

describe('¿Qué Factura A te autorizó ARCA?', () => {
  it('lee lo guardado (la B no cuenta)', () => {
    expect(classChoiceFor(['B'])).toBe('none')
    expect(classChoiceFor(null)).toBe('none')
    expect(classChoiceFor(['A', 'B'])).toBe('A')
    expect(classChoiceFor(['A51', 'B'])).toBe('A51')
    expect(classChoiceFor(['ACBU', 'B'])).toBe('ACBU')
  })

  it('ida y vuelta para cada opción, siempre con la B y aceptado por el esquema', () => {
    const choices: ArcaClassChoice[] = ['none', 'A', 'A51', 'ACBU']
    expect(ARCA_CLASS_CHOICES.map((c) => c.value)).toEqual(choices)
    for (const choice of choices) {
      const allowed = allowedClassesFor(choice)
      expect(allowed).toContain('B')
      expect(classChoiceFor(allowed)).toBe(choice)
      const parsed = arcaSettingsSchema.safeParse({
        environment: 'produccion',
        allowedClasses: allowed,
      })
      expect(parsed.success).toBe(true)
    }
  })

  it('cada opción explica qué quiere decir', () => {
    for (const choice of ARCA_CLASS_CHOICES) expect(choice.hint.length).toBeGreaterThan(20)
  })
})

describe('suggestArcaAlias', () => {
  it('el nombre corto del bar + «plataforma» (o «test» en pruebas)', () => {
    expect(suggestArcaAlias('hub', 'produccion')).toBe('hubplataforma')
    expect(suggestArcaAlias('hub', 'homologacion')).toBe('hubtest')
    expect(suggestArcaAlias('demo-administracion', 'produccion')).toBe(
      'demoadministracionplataforma',
    )
  })

  it('sin tildes ni símbolos, hasta 30 y nunca vacío', () => {
    expect(suggestArcaAlias('Café Ñandú', 'produccion')).toBe('cafenanduplataforma')
    expect(suggestArcaAlias('', 'produccion')).toBe('plataforma')
    expect(suggestArcaAlias(null, 'homologacion')).toBe('test')
    expect(suggestArcaAlias('un-nombre-de-bar-larguisimo-de-verdad', 'produccion')).toHaveLength(30)
  })

  it('siempre pasa la validación del servidor', () => {
    for (const seed of ['hub', 'x', 'Bar & Co. 2026', 'ñ', 'a'.repeat(60), '---']) {
      for (const env of ['produccion', 'homologacion'] as const) {
        const alias = suggestArcaAlias(seed, env)
        expect(aliasField.safeParse(alias).success).toBe(true)
      }
    }
  })
})

describe('precheckCertFile: lo que no se manda', () => {
  const pem = (label: string) => `-----BEGIN ${label}-----\nMIIB\n-----END ${label}-----\n`

  it('un certificado PEM pasa', () => {
    expect(
      precheckCertFile({ name: 'cert.crt', size: 1200, headText: pem('CERTIFICATE') }),
    ).toEqual({ ok: true })
  })

  it('el pedido (.csr) en vez del certificado', () => {
    for (const label of ['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']) {
      expect(precheckCertFile({ name: 'a.crt', size: 900, headText: pem(label) })).toMatchObject({
        ok: false,
        kind: 'csr',
      })
    }
    expect(precheckCertFile({ name: 'arca.csr', size: 900, headText: null })).toMatchObject({
      kind: 'csr',
    })
  })

  it('una clave privada no sale de la compu, aunque se llame .crt', () => {
    for (const label of [
      'PRIVATE KEY',
      'RSA PRIVATE KEY',
      'ENCRYPTED PRIVATE KEY',
      'EC PRIVATE KEY',
    ]) {
      const check = precheckCertFile({ name: 'cert.crt', size: 1700, headText: pem(label) })
      expect(check).toMatchObject({ ok: false, kind: 'private_key' })
    }
    expect(
      precheckCertFile({ name: 'clave.key', size: 1700, headText: '\u0000\u0001' }),
    ).toMatchObject({ kind: 'private_key' })
  })

  it('un .p12 / .pfx (trae la clave adentro)', () => {
    expect(precheckCertFile({ name: 'cert.P12', size: 2500, headText: null })).toMatchObject({
      kind: 'pkcs12',
    })
    expect(precheckCertFile({ name: 'cert.pfx', size: 2500, headText: null })).toMatchObject({
      kind: 'pkcs12',
    })
  })

  it('vacío o de más de 16 KB: ilegible', () => {
    expect(precheckCertFile({ name: 'a.crt', size: 0, headText: '' })).toMatchObject({
      kind: 'unreadable',
    })
    expect(
      precheckCertFile({ name: 'a.crt', size: CERT_FILE_MAX_BYTES + 1, headText: null }),
    ).toMatchObject({ kind: 'unreadable', message: UNREADABLE_CERT_MESSAGE })
  })

  it('un DER binario (.cer) lo decide el servidor', () => {
    expect(precheckCertFile({ name: 'cert.cer', size: 1100, headText: '0\u0082\u0004' })).toEqual({
      ok: true,
    })
  })

  it('los textos son los del servidor (§2.4.2)', () => {
    expect(CERT_PRECHECK_MESSAGES.unreadable).toBe(UNREADABLE_CERT_MESSAGE)
    expect(CERT_PRECHECK_MESSAGES.csr).toContain('(.csr)')
    expect(CERT_PRECHECK_MESSAGES.private_key).toContain('no la subas')
  })
})

describe('textToBase64 (pegar el certificado)', () => {
  it('es el base64 de los bytes UTF-8 y lo lee el decodificador del servidor', () => {
    const text =
      '-----BEGIN CERTIFICATE-----\nMIIBtjCCAVugAwIBAgITBmyf\n-----END CERTIFICATE-----\n'
    expect(textToBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    const decoded = decodeUploadedFile(textToBase64(text))
    expect(decoded && new TextDecoder().decode(decoded)).toBe(text)
    expect(textToBase64('ñandú')).toBe(Buffer.from('ñandú', 'utf8').toString('base64'))
  })
})

describe('datos de las maquetas', () => {
  it('lo que la persona tiene que ver o escribir, con los datos del bar', () => {
    expect(
      arcaMockData({
        legalName: 'Bar de Prueba SAS',
        cuit: '30712345671',
        alias: 'barplataforma',
        pointOfSale: 5,
      }),
    ).toEqual({
      sasName: 'BAR DE PRUEBA SAS',
      sasCuit: '30-71234567-1',
      sasCuitDigits: '30712345671',
      alias: 'barplataforma',
      pointOfSale: '5',
      csrFileName: 'arca-barplataforma.csr',
      personName: 'TU NOMBRE',
      personCuit: 'TU CUIT',
    })
  })

  it('sin datos: textos genéricos (nunca una CUIT inventada)', () => {
    const data = arcaMockData({ legalName: null, cuit: '3071234', alias: ' ', pointOfSale: null })
    expect(data).toEqual({ ...DEFAULT_MOCK_DATA })
    expect(data.sasCuit).not.toMatch(/\d/)
  })

  it('la SAS en los textos', () => {
    expect(sasLabel(' Mi Bar SAS ')).toBe('MI BAR SAS')
    expect(sasLabel(null)).toBe('la SAS')
  })

  it('cubre todos los pasos de la guía', () => {
    expect(ARCA_GUIDE_STEP_IDS).toHaveLength(11)
  })
})
