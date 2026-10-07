import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_SEARCH_ENDPOINT,
  customerLabel,
  customerToOption,
  type PickedCustomer,
  parseCustomerSearchResponse,
} from '@/components/customers/customer-picker'

/**
 * El `CustomerPicker` (Combobox de clientes del kit): cómo lee la respuesta del
 * Route Handler y cómo arma la opción del cliente ya elegido.
 */

const MELINA: PickedCustomer = {
  id: 'c-1',
  first_name: 'Melina',
  last_name: 'Gómez',
  phone: '+5493515551234',
  points_balance: 1200,
  service_alerts: ['celiac'],
}

describe('CustomerPicker', () => {
  it('busca en el Route Handler GET de clientes', () => {
    expect(CUSTOMER_SEARCH_ENDPOINT).toBe('/api/customers/search')
  })

  it('lee las opciones con el cliente entero y los puntos a la derecha', () => {
    const [option] = parseCustomerSearchResponse({
      options: [
        {
          value: 'c-1',
          label: 'Melina Gómez',
          description: '+54 9 351 555-1234',
          data: { ...MELINA, service_alerts: ['celiac', 'no-existe'] },
        },
      ],
    })
    expect(option).toEqual({
      value: 'c-1',
      label: 'Melina Gómez',
      description: '+54 9 351 555-1234',
      meta: '1.200 pts',
      data: MELINA,
    })
  })

  it('una respuesta que no valida tira (el Combobox muestra «No pudimos buscar»)', () => {
    expect(() => parseCustomerSearchResponse({ error: 'forbidden' })).toThrow()
    expect(() =>
      parseCustomerSearchResponse({ options: [{ value: 'c-1', label: 'X', data: {} }] }),
    ).toThrow()
  })

  it('el elegido completo lleva sus datos; uno parcial solo la etiqueta', () => {
    expect(customerToOption(MELINA).data).toEqual(MELINA)
    const partial = customerToOption({ id: 'c-2', first_name: 'Juan', last_name: 'Pérez' })
    expect(partial).toEqual({
      value: 'c-2',
      label: 'Juan Pérez',
      description: undefined,
      meta: undefined,
      data: undefined,
    })
  })

  it('sin nombre cargado dice «Sin nombre»', () => {
    expect(customerLabel({ first_name: '', last_name: '' })).toBe('Sin nombre')
    expect(customerLabel({ first_name: 'Ana', last_name: '' })).toBe('Ana')
  })
})
