import { describe, expect, it } from 'vitest'
import { captureSubmitSchema } from '@/lib/capture/schemas'
import {
  createCustomerSchema,
  listFiltersSchema,
  updateCustomerSchema,
} from '@/lib/customers/schemas'

describe('createCustomerSchema', () => {
  it('normaliza phone a E.164', () => {
    const r = createCustomerSchema.safeParse({
      phone: '0351 15 555 1234',
      first_name: ' Juan ',
      last_name: 'Pérez',
      opt_in_marketing: true,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.phone).toBe('+5493515551234')
      expect(r.data.first_name).toBe('Juan')
    }
  })

  it('rechaza teléfono inválido', () => {
    const r = createCustomerSchema.safeParse({
      phone: 'xxx',
      first_name: 'Juan',
      last_name: 'Pérez',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza nombre vacío', () => {
    const r = createCustomerSchema.safeParse({
      phone: '3515551234',
      first_name: '   ',
      last_name: 'Pérez',
    })
    expect(r.success).toBe(false)
  })
})

describe('updateCustomerSchema', () => {
  it('birthdate vacío se vuelve null', () => {
    const r = updateCustomerSchema.safeParse({
      id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
      phone: '3515551234',
      first_name: 'Juan',
      last_name: 'Pérez',
      notes: 'Le gusta IPA',
      birthdate: '',
      opt_in_marketing: false,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.birthdate).toBeNull()
  })

  it('birthdate con formato malo se rechaza', () => {
    const r = updateCustomerSchema.safeParse({
      id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
      phone: '3515551234',
      first_name: 'A',
      last_name: 'B',
      birthdate: '01/01/1990',
    })
    expect(r.success).toBe(false)
  })
})

describe('captureSubmitSchema', () => {
  it('honeypot vacío permite pasar', () => {
    const r = captureSubmitSchema.safeParse({
      link_slug: 'mesa-1',
      phone: '3515551234',
      first_name: 'Ana',
      last_name: 'García',
      opt_in_marketing: true,
      website: '',
    })
    expect(r.success).toBe(true)
  })

  it('honeypot relleno se rechaza', () => {
    const r = captureSubmitSchema.safeParse({
      link_slug: 'mesa-1',
      phone: '3515551234',
      first_name: 'Ana',
      last_name: 'García',
      opt_in_marketing: true,
      website: 'http://spammer.com',
    })
    expect(r.success).toBe(false)
  })

  it('opt_in default es false', () => {
    const r = captureSubmitSchema.safeParse({
      link_slug: 'mesa-1',
      phone: '3515551234',
      first_name: 'Ana',
      last_name: 'García',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.opt_in_marketing).toBe(false)
  })

  it('rechaza slug con caracteres raros', () => {
    const r = captureSubmitSchema.safeParse({
      link_slug: 'mesa/../1',
      phone: '3515551234',
      first_name: 'Ana',
      last_name: 'García',
    })
    expect(r.success).toBe(false)
  })
})

describe('listFiltersSchema', () => {
  it('default page es 1', () => {
    const r = listFiltersSchema.parse({})
    expect(r.page).toBe(1)
  })

  it('coerce page string a number', () => {
    const r = listFiltersSchema.parse({ page: '3' })
    expect(r.page).toBe(3)
  })

  it('rechaza since fuera del enum', () => {
    expect(() => listFiltersSchema.parse({ since: 'forever' })).toThrow()
  })
})
