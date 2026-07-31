import { describe, expect, it } from 'vitest'
import { parseScannedCode } from '@/lib/redemptions/scan'

// El escáner del salón es uno solo para los dos QR que circulan por el bar. Si
// este parser se equivoca, el mozo abre la pantalla que no es — de ahí que el
// ruteo sea lo primero que se testea.

const CUSTOMER = 'aBcD1234efGH5678ijKL'
const REDEEM = 'zZ99_yy88-xx77ww66vv'

describe('parseScannedCode', () => {
  it('URL completa de canje → validar', () => {
    expect(parseScannedCode(`https://hub.app/v/${REDEEM}`, 'customer')).toEqual({
      kind: 'redemption',
      token: REDEEM,
    })
  })

  it('URL completa del socio → acreditar', () => {
    expect(parseScannedCode(`https://hub.app/c/${CUSTOMER}`, 'redemption')).toEqual({
      kind: 'customer',
      token: CUSTOMER,
    })
  })

  it('path suelto, sin dominio', () => {
    expect(parseScannedCode(`/v/${REDEEM}`, 'customer')?.kind).toBe('redemption')
    expect(parseScannedCode(`/c/${CUSTOMER}`, 'redemption')?.kind).toBe('customer')
  })

  it('tolera espacios alrededor (pegado a mano)', () => {
    expect(parseScannedCode(`  https://hub.app/v/${REDEEM}  `, 'customer')?.token).toBe(REDEEM)
  })

  it('token pelado cae al fallback de la pantalla que escanea', () => {
    expect(parseScannedCode(REDEEM, 'redemption')).toEqual({ kind: 'redemption', token: REDEEM })
    expect(parseScannedCode(REDEEM, 'customer')).toEqual({ kind: 'customer', token: REDEEM })
  })

  it('un QR de canje gana aunque la URL también tenga /c/ (query, path largo)', () => {
    expect(parseScannedCode(`https://hub.app/c/${CUSTOMER}/v/${REDEEM}`, 'customer')).toEqual({
      kind: 'redemption',
      token: REDEEM,
    })
  })

  it('basura, vacío o token corto → null (la UI ofrece carga manual)', () => {
    expect(parseScannedCode('', 'customer')).toBeNull()
    expect(parseScannedCode('   ', 'customer')).toBeNull()
    expect(parseScannedCode('hola qué tal', 'customer')).toBeNull()
    expect(parseScannedCode('abc123', 'customer')).toBeNull()
  })

  it('URL de otra cosa del mismo dominio no se confunde con un token', () => {
    expect(parseScannedCode('https://hub.app/carta/hub', 'redemption')).toBeNull()
  })
})
