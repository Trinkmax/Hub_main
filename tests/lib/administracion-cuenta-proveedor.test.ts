import { describe, expect, it } from 'vitest'
import {
  accountAsk,
  accountToRemember,
  supplierDefaultAccount,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-account'

const BEBIDAS = '00000000-0000-4000-8000-0000000000b1'
const LIMPIEZA = '00000000-0000-4000-8000-0000000000b2'
const VIEJA = '00000000-0000-4000-8000-0000000000b9'
const IMPUTABLE = new Set([BEBIDAS, LIMPIEZA])

/** Un proveedor ya cargado, con su cuenta habitual puesta, sin tocar nada. */
const base = {
  existingParty: true,
  defaultAccountId: BEBIDAS,
  accountId: BEBIDAS,
  recurringLinked: false,
  changing: false,
} as const

describe('la clasificación vive en la ficha del proveedor (12/10/2026)', () => {
  it('la cuenta habitual sirve solo si se le puede imputar una compra', () => {
    expect(supplierDefaultAccount(BEBIDAS, IMPUTABLE)).toBe(BEBIDAS)
    expect(supplierDefaultAccount(VIEJA, IMPUTABLE)).toBeNull()
    expect(supplierDefaultAccount(null, IMPUTABLE)).toBeNull()
    expect(supplierDefaultAccount(undefined, IMPUTABLE)).toBeNull()
  })

  it('proveedor con cuenta habitual: no se pregunta («Va a «…»» con [Cambiar])', () => {
    expect(accountAsk(base)).toBe('fixed')
  })

  it('[Cambiar]: se pregunta para esta carga, sin ofrecer «Usar siempre»', () => {
    expect(accountAsk({ ...base, changing: true })).toBe('ask')
    expect(accountAsk({ ...base, changing: true, accountId: LIMPIEZA })).toBe('ask')
    expect(accountAsk({ ...base, changing: true, accountId: null })).toBe('ask')
  })

  it('nunca se esconde una cuenta distinta de la habitual (aunque no se haya tocado «Cambiar»)', () => {
    expect(accountAsk({ ...base, accountId: LIMPIEZA })).toBe('ask')
    expect(accountAsk({ ...base, accountId: null })).toBe('ask')
  })

  it('proveedor sin cuenta habitual: se pregunta y se ofrece «Usar siempre para …»', () => {
    expect(accountAsk({ ...base, defaultAccountId: null, accountId: null })).toBe('ask-remember')
    // Aunque ya venga precargada la última que se le usó.
    expect(accountAsk({ ...base, defaultAccountId: null, accountId: LIMPIEZA })).toBe(
      'ask-remember',
    )
  })

  it('un gasto fijo trae su cuenta: se pregunta como siempre (con o sin habitual)', () => {
    expect(accountAsk({ ...base, recurringLinked: true })).toBe('ask')
    expect(accountAsk({ ...base, recurringLinked: true, defaultAccountId: null })).toBe('ask')
  })

  it('proveedor nuevo o sin proveedor: como siempre', () => {
    expect(accountAsk({ ...base, existingParty: false })).toBe('ask')
    expect(
      accountAsk({ ...base, existingParty: false, defaultAccountId: null, accountId: null }),
    ).toBe('ask')
  })

  it('después de cargar se guarda la cuenta solo si se ofreció, quedó tildado y hay cuenta', () => {
    expect(accountToRemember({ ask: 'ask-remember', remember: true, accountId: BEBIDAS })).toBe(
      BEBIDAS,
    )
    expect(
      accountToRemember({ ask: 'ask-remember', remember: false, accountId: BEBIDAS }),
    ).toBeNull()
    expect(accountToRemember({ ask: 'ask-remember', remember: true, accountId: null })).toBeNull()
    // Con la cuenta de la ficha, o cambiada solo para esta carga, la ficha no se toca.
    expect(accountToRemember({ ask: 'fixed', remember: true, accountId: BEBIDAS })).toBeNull()
    expect(accountToRemember({ ask: 'ask', remember: true, accountId: LIMPIEZA })).toBeNull()
  })
})
