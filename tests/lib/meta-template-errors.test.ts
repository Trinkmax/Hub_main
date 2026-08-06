import { describe, expect, it } from 'vitest'
import { humanizeTemplateError, MetaApiError } from '@/lib/meta/errors'

function metaError(payload: {
  code?: number
  message?: string
  details?: string
  userMsg?: string
}): MetaApiError {
  return new MetaApiError(400, {
    code: payload.code,
    message: payload.message ?? '(#100) Invalid parameter',
    error_data: payload.details ? { details: payload.details } : undefined,
    error_user_msg: payload.userMsg,
  })
}

describe('humanizeTemplateError', () => {
  it('traduce los códigos de plantillas de la Business Management API', () => {
    expect(humanizeTemplateError(metaError({ code: 2388299 }))).toContain(
      'no puede empezar ni terminar con una variable',
    )
    expect(humanizeTemplateError(metaError({ code: 2388040 }))).toContain('largo permitido')
    expect(humanizeTemplateError(metaError({ code: 2388019 }))).toContain('máximo de plantillas')
    expect(humanizeTemplateError(metaError({ code: 2388039 }))).toContain('en revisión')
  })

  it('manda a reconectar el canal cuando el token murió', () => {
    for (const code of [190, 102, 463]) {
      expect(humanizeTemplateError(metaError({ code }))).toContain('Reconectá el canal')
    }
  })

  it('avisa del rate limit en vez de mostrar el código', () => {
    expect(humanizeTemplateError(metaError({ code: 80007 }))).toContain('Esperá unos minutos')
  })

  it('detecta el nombre duplicado por el detalle de Meta', () => {
    const e = metaError({ code: 100, details: 'Template name already exists in the same language' })
    expect(humanizeTemplateError(e)).toContain('Ya existe una plantilla con ese nombre')
  })

  it('cae en el detalle de Meta cuando el código no está mapeado', () => {
    const e = metaError({ code: 999999, details: 'Something very specific went wrong' })
    expect(humanizeTemplateError(e)).toBe(
      'WhatsApp rechazó la plantilla: Something very specific went wrong',
    )
  })

  it('prefiere error_user_msg sobre details', () => {
    const e = metaError({ code: 999999, details: 'raw detail', userMsg: 'mensaje para el usuario' })
    expect(humanizeTemplateError(e)).toBe('WhatsApp rechazó la plantilla: mensaje para el usuario')
  })

  it('sin detalle ni mapa, dice el código y qué hacer', () => {
    const e = metaError({ code: 999999 })
    expect(humanizeTemplateError(e)).toContain('error 999999')
    expect(humanizeTemplateError(e)).toContain('Revisá los textos')
  })

  it('un error que no viene de Meta pasa su mensaje tal cual', () => {
    expect(humanizeTemplateError(new Error('Canal sin token; reconectá el canal.'))).toBe(
      'Canal sin token; reconectá el canal.',
    )
  })

  it('un error sin mensaje no deja al usuario sin nada', () => {
    expect(humanizeTemplateError(null)).toContain('No pudimos crear la plantilla')
  })
})
