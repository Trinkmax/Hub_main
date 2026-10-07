// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CODE_FIELD_MESSAGES,
  canonicalCode,
  displayCode,
  sanitizeCodeInput,
  validateCode,
} from '@/components/ui/code-field'

/**
 * CodeField (kit §3.2): CUIT, punto de venta y número de comprobante. Las
 * reglas fiscales (dígito verificador, ceros) viven en lib/fiscal y tienen sus
 * tests; acá se prueba lo que hace el campo con lo que se tipea o se pega:
 * qué deja escribir, qué manda en el hidden, cómo lo muestra al salir y qué
 * error dice.
 */

describe('CUIT', () => {
  it('pegar con o sin guiones da lo mismo', () => {
    expect(canonicalCode('cuit', '20-12345678-6')).toBe('20123456786')
    expect(canonicalCode('cuit', '20123456786')).toBe('20123456786')
    expect(canonicalCode('cuit', '20 12345678 6')).toBe('20123456786')
  })

  it('al salir se muestra con guiones', () => {
    expect(displayCode('cuit', '20123456786')).toBe('20-12345678-6')
    expect(displayCode('cuit', '20 12345678 6')).toBe('20-12345678-6')
  })

  it('incompleto se muestra tal cual, junto al error', () => {
    expect(displayCode('cuit', '2012345')).toBe('2012345')
    expect(validateCode('cuit', '2012345')).toBe('El CUIT tiene 11 números.')
  })

  it('dígito verificador que no cierra: el mensaje del kit', () => {
    expect(validateCode('cuit', '20-12345678-5')).toBe(
      'El CUIT no es válido: revisá el último número',
    )
    expect(validateCode('cuit', '20-12345678-6')).toBeNull()
    // Verificados contra la base (lib/fiscal).
    expect(validateCode('cuit', '30-71876543-5')).toBeNull()
  })

  it('deja tipear guiones y espacios, no letras, y corta los dígitos de más', () => {
    expect(sanitizeCodeInput('cuit', '20-1234a5678-6')).toBe('20-12345678-6')
    expect(sanitizeCodeInput('cuit', '201234567861234')).toBe('20123456786')
  })

  it('vacío no es error: lo obligatorio lo dice required', () => {
    expect(validateCode('cuit', '')).toBeNull()
    expect(canonicalCode('cuit', '')).toBe('')
  })
})

describe('punto de venta', () => {
  it('se completa con ceros a 5 (formato ARCA vigente)', () => {
    expect(canonicalCode('pv', '3')).toBe('00003')
    expect(displayCode('pv', '3')).toBe('00003')
  })

  it('los de 4 dígitos se leen igual', () => {
    expect(canonicalCode('pv', '0003')).toBe('00003')
  })

  it('respeta un pad distinto', () => {
    expect(canonicalCode('pv', '3', 4)).toBe('0003')
  })

  it('solo dígitos, hasta 5', () => {
    expect(sanitizeCodeInput('pv', '00a03-')).toBe('0003')
    expect(sanitizeCodeInput('pv', '1234567')).toBe('12345')
  })

  it('vacío queda vacío (no «00000»)', () => {
    expect(canonicalCode('pv', '')).toBe('')
    expect(displayCode('pv', '')).toBe('')
  })
})

describe('número de comprobante', () => {
  it('se completa con ceros a 8', () => {
    expect(canonicalCode('doc-number', '1290')).toBe('00001290')
    expect(displayCode('doc-number', '1290')).toBe('00001290')
  })

  it('el número empieza en 1', () => {
    expect(validateCode('doc-number', '0')).toBe(CODE_FIELD_MESSAGES.docNumberZero)
    expect(validateCode('doc-number', '00000001')).toBeNull()
  })

  it('solo dígitos, hasta 8', () => {
    expect(sanitizeCodeInput('doc-number', '123456789')).toBe('12345678')
  })
})
