import { describe, expect, it } from 'vitest'
import { visibleWalletPartners } from '@/lib/wallet/partner-benefits'

type P = { id: string; active: boolean; discountLabel: string | null }

const partner = (id: string, active: boolean, discountLabel: string | null = null): P => ({
  id,
  active,
  discountLabel,
})

const ids = (list: readonly P[]) => list.map((p) => p.id)

describe('visibleWalletPartners', () => {
  // El pedido del dueño: 18 marcas en borrador llenaban la billetera de
  // "Próximamente". Oculta = no aparece, punto.
  it('la marca oculta no llega a la billetera aunque tenga descuento cargado', () => {
    expect(visibleWalletPartners([partner('oculta', false, '30% off')])).toHaveLength(0)
  })

  it('la publicada se ve', () => {
    expect(ids(visibleWalletPartners([partner('guapa', true, '10% off')]))).toEqual(['guapa'])
  })

  // El switch tiene que significar lo que dice: si el dueño la prende, aparece —
  // aunque todavía no le haya cargado los beneficios.
  it('la publicada sin beneficios cargados también se ve', () => {
    expect(ids(visibleWalletPartners([partner('recien-creada', true)]))).toEqual(['recien-creada'])
  })

  it('con todas ocultas devuelve vacío: la sección entera desaparece', () => {
    const list = visibleWalletPartners([
      partner('a', false),
      partner('b', false),
      partner('c', false, '20%'),
    ])
    expect(list).toEqual([])
  })

  it('mezcla real: pasan sólo las publicadas', () => {
    const list = visibleWalletPartners([
      partner('borrador', false, '30%'),
      partner('viva', true, '15%'),
      partner('otro-borrador', false),
      partner('viva2', true),
    ])
    expect(ids(list)).toEqual(['viva', 'viva2'])
  })

  it('respeta el orden que venía de la query', () => {
    expect(ids(visibleWalletPartners([partner('z', true), partner('a', true)]))).toEqual(['z', 'a'])
  })

  it('sin marcas no explota', () => {
    expect(visibleWalletPartners([])).toEqual([])
  })
})
