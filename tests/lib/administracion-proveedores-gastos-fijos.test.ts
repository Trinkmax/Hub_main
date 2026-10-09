import { describe, expect, it } from 'vitest'
import {
  nameKey,
  parseNameList,
  suggestAccount,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/bulk'
import {
  duesUntil,
  nthDue,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import {
  breakdownTotals,
  deliveryDaysText,
  orderLeadText,
  parseBreakdown,
  parseDeliveryDays,
  parsePartyContacts,
} from '@/lib/accounting/party-profile'
import { remainingDues } from '@/lib/accounting/queries/documents'
import {
  partiesBulkSchema,
  partySchema,
  recurringBulkSchema,
  recurringSchema,
} from '@/lib/accounting/schemas'

const ACCOUNT = '00000000-0000-4000-8000-0000000000b1'

// Lo que pidieron los socios de HUB el 09/10/2026: la ficha del proveedor,
// cargar listas, gastos fijos en cuotas y el detalle de los sueldos.

describe('cargar una lista: parseNameList', () => {
  it('un nombre por renglón, sin viñetas, sin vacíos y sin repetir', () => {
    const parsed = parseNameList(
      'Alpes\n\n- Branca\n• Coca Cola\n1. Quilmes\nalpes \nCarnes   JR\r\nEl oficio ',
    )
    expect(parsed.names).toEqual([
      'Alpes',
      'Branca',
      'Coca Cola',
      'Quilmes',
      'Carnes JR',
      'El oficio',
    ])
    expect(parsed.repeated).toEqual(['alpes'])
  })

  it('los que ya existen no se vuelven a cargar (sin mayúsculas ni tildes)', () => {
    const parsed = parseNameList('Don Ramón\nLa Virginia\nLenoir', {
      existing: ['don ramon', 'LA VIRGINIA'],
    })
    expect(parsed.names).toEqual(['Lenoir'])
    expect(parsed.existing).toEqual(['Don Ramón', 'La Virginia'])
  })

  it('los nombres que no entran quedan aparte', () => {
    const parsed = parseNameList(`X\n${'a'.repeat(81)}\nMS`, { maxLength: 80 })
    expect(parsed.names).toEqual(['MS'])
    expect(parsed.invalid).toHaveLength(2)
  })

  it('nameKey compara sin tildes, mayúsculas ni espacios de más', () => {
    expect(nameKey('  Inversión   utensillos ')).toBe(nameKey('inversion utensillos'))
  })
})

describe('cargar una lista: la cuenta propuesta de cada gasto fijo', () => {
  // Las cuentas del plan estándar que se pueden elegir para un gasto.
  const accounts = [
    { id: 'iibb', code: '4.2.01.02.010', name: 'Ingresos Brutos' },
    { id: 'cei', code: '4.2.01.02.005', name: 'Comercio e Industria' },
    { id: 'otros-imp', code: '4.2.01.02.015', name: 'Otros impuestos y tasas' },
    { id: 'seguros', code: '4.2.02.05.001', name: 'Seguros' },
    { id: 'hon-cont', code: '4.2.02.01.003', name: 'Honorarios contables' },
    { id: 'hon', code: '4.2.02.01.006', name: 'Honorarios profesionales' },
    { id: 'seg', code: '4.2.01.03.031', name: 'Seguridad y monitoreo' },
    { id: 'limp', code: '4.2.01.03.029', name: 'Limpieza e higiene' },
    { id: 'soft', code: '4.2.01.03.011', name: 'Software y suscripciones' },
    { id: 'mov', code: '4.2.01.03.016', name: 'Movilidad, fletes y envíos' },
  ]
  const suggest = (name: string) => suggestAccount(name, accounts)

  it('reconoce los gastos fijos de la lista de HUB', () => {
    expect(suggest('Ingresos brutos Piojo - RRII')).toBe('iibb')
    expect(suggest('RENTAS')).toBe('iibb')
    expect(suggest('Comercio e industria Porte - RRII')).toBe('cei')
    expect(suggest('Seguro Integral de Comercio')).toBe('seguros')
    expect(suggest('Seguro de caucion Mayo')).toBe('seguros')
    expect(suggest('Silvia Contadora')).toBe('hon-cont')
    expect(suggest('Direccion Tecnica')).toBe('hon')
    expect(suggest('Alarma')).toBe('seg')
    expect(suggest('ECCO (Área protegida)')).toBe('seg')
    expect(suggest('Desinfeccion')).toBe('limp')
    expect(suggest('Recolección de residuos')).toBe('limp')
    expect(suggest('Suscripcion pedix')).toBe('soft')
    expect(suggest('OPEN IA')).toBe('soft')
    expect(suggest('Dominio DON WEB')).toBe('soft')
    expect(suggest('Youtube Premium')).toBe('soft')
    expect(suggest('Nafta Tomi')).toBe('mov')
  })

  it('lo que no reconoce (o no tiene cuenta) queda sin proponer', () => {
    expect(suggest('Gimnasio')).toBeNull()
    // «Sueldos y jornales» no se elige para un gasto: queda para que la persona decida.
    expect(suggest('Sueldos personal')).toBeNull()
  })
})

describe('gastos fijos en cuotas', () => {
  it('nthDue: el vencimiento número N contando el próximo', () => {
    expect(nthDue('2026-10-20', 20, 'monthly', 1)).toBe('2026-10-20')
    expect(nthDue('2026-10-20', 20, 'monthly', 3)).toBe('2026-12-20')
    expect(nthDue('2026-11-30', 31, 'monthly', 4)).toBe('2027-02-28')
    expect(nthDue('2026-10-10', 10, 'quarterly', 2)).toBe('2027-01-10')
  })

  it('duesUntil y remainingDues cuentan igual, por mes, como la base', () => {
    for (const [next, ends, freq, want] of [
      ['2026-10-20', '2026-12-20', 'monthly', 3],
      ['2026-10-20', '2026-10-01', 'monthly', 1],
      ['2026-11-20', '2026-10-20', 'monthly', 0],
      ['2026-10-10', '2027-04-10', 'quarterly', 3],
    ] as const) {
      expect(duesUntil(next, ends, freq)).toBe(want)
      expect(remainingDues(next, ends, freq)).toBe(want)
    }
    expect(remainingDues('2026-10-20', null, 'monthly')).toBeNull()
  })

  it('el formulario manda el último vencimiento, o null si no termina', () => {
    const base = {
      name: 'Licuadora 6/6 USA cord',
      accountId: ACCOUNT,
      frequency: 'monthly',
      dueDay: 20,
      nextDueDate: '2026-10-20',
    }
    expect(recurringSchema.parse({ ...base, endsOn: '2026-12-20' }).endsOn).toBe('2026-12-20')
    expect(recurringSchema.parse({ ...base, endsOn: '' }).endsOn).toBeNull()
    expect(recurringSchema.parse(base).endsOn).toBeNull()
  })
})

describe('el detalle de un gasto fijo (sueldos por empleado y concepto)', () => {
  const base = {
    name: 'Sueldos personal',
    accountId: ACCOUNT,
    frequency: 'monthly',
    dueDay: 5,
    nextDueDate: '2026-11-05',
  }

  it('acepta renglones con concepto o sin detallar', () => {
    const parsed = recurringSchema.parse({
      ...base,
      breakdown: [
        { label: ' Ana ', kind: 'blanco', amountCents: 50000000 },
        { label: 'Ana', kind: 'aporte', amountCents: '8500000' },
        { label: 'Beto', kind: '', amountCents: 30000000 },
      ],
    })
    expect(parsed.breakdown).toEqual([
      { label: 'Ana', kind: 'blanco', amountCents: 50000000 },
      { label: 'Ana', kind: 'aporte', amountCents: 8500000 },
      { label: 'Beto', kind: null, amountCents: 30000000 },
    ])
  })

  it('rechaza un concepto que no existe o un renglón sin monto', () => {
    expect(
      recurringSchema.safeParse({
        ...base,
        breakdown: [{ label: 'Ana', kind: 'otro', amountCents: 1 }],
      }).success,
    ).toBe(false)
    expect(
      recurringSchema.safeParse({
        ...base,
        breakdown: [{ label: 'Ana', kind: null, amountCents: '' }],
      }).success,
    ).toBe(false)
  })

  it('breakdownTotals suma por concepto (en orden) y el total', () => {
    const totals = breakdownTotals([
      { label: 'Ana', kind: 'blanco', amountCents: 500 },
      { label: 'Beto', kind: null, amountCents: 300 },
      { label: 'Ana', kind: 'aporte', amountCents: 85 },
      { label: 'Beto', kind: 'negro', amountCents: 200 },
      { label: 'Ana', kind: 'blanco', amountCents: 100 },
    ])
    expect(totals.total).toBe(1185)
    expect(totals.byKind).toEqual([
      { kind: 'aporte', cents: 85 },
      { kind: 'blanco', cents: 600 },
      { kind: 'negro', cents: 200 },
      { kind: null, cents: 300 },
    ])
  })

  it('parseBreakdown lee lo que guarda la base y descarta lo que no sirve', () => {
    expect(
      parseBreakdown([
        { label: 'Ana', kind: 'contribucion', amount_cents: 1200 },
        { label: 'X', kind: 'raro', amount_cents: 5 },
        { label: 'Y', kind: null, amount_cents: 0 },
        'basura',
      ]),
    ).toEqual([
      { label: 'Ana', kind: 'contribucion', amountCents: 1200 },
      { label: 'X', kind: null, amountCents: 5 },
    ])
    expect(parseBreakdown(null)).toEqual([])
  })
})

describe('la ficha del proveedor', () => {
  const base = { kind: 'supplier', name: 'Coca Cola' }

  it('contactos, días de entrega (ordenados, sin repetir) y anticipación', () => {
    const parsed = partySchema.parse({
      ...base,
      contacts: [{ name: 'Juan', role: 'Ventas', phone: '351 555 0000', email: '' }],
      deliveryDays: [5, 1, 3, 1],
      orderLeadDays: '2',
    })
    expect(parsed.contacts).toEqual([
      { name: 'Juan', role: 'Ventas', phone: '351 555 0000', email: null },
    ])
    expect(parsed.deliveryDays).toEqual([1, 3, 5])
    expect(parsed.orderLeadDays).toBe(2)
  })

  it('sin datos nuevos: listas vacías y anticipación sin cargar', () => {
    const parsed = partySchema.parse(base)
    expect(parsed.contacts).toEqual([])
    expect(parsed.deliveryDays).toEqual([])
    expect(parsed.orderLeadDays).toBeNull()
  })

  it('rechaza un día que no existe, una anticipación de más o un email mal escrito', () => {
    expect(partySchema.safeParse({ ...base, deliveryDays: [8] }).success).toBe(false)
    expect(partySchema.safeParse({ ...base, orderLeadDays: 31 }).success).toBe(false)
    expect(partySchema.safeParse({ ...base, contacts: [{ email: 'no-mail' }] }).success).toBe(false)
  })

  it('los textos de la ficha', () => {
    expect(deliveryDaysText([1, 3, 5])).toBe('Lunes, miércoles y viernes')
    expect(deliveryDaysText([1, 2, 3, 4, 5])).toBe('De lunes a viernes')
    expect(deliveryDaysText([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días')
    expect(deliveryDaysText([2])).toBe('Martes')
    expect(deliveryDaysText([])).toBeNull()
    expect(orderLeadText(0)).toBe('El mismo día')
    expect(orderLeadText(1)).toBe('1 día antes')
    expect(orderLeadText(3)).toBe('3 días antes')
    expect(orderLeadText(null)).toBeNull()
  })

  it('lee lo que guarda la base', () => {
    expect(parseDeliveryDays([5, '1', 9, 1])).toEqual([1, 5])
    expect(parsePartyContacts([{ name: ' Juan ', phone: '' }, 3])).toEqual([
      { name: 'Juan', role: null, phone: null, email: null },
    ])
  })
})

describe('los esquemas de cargar una lista', () => {
  it('proveedores: de 1 a 300 nombres de al menos 2 letras', () => {
    expect(partiesBulkSchema.safeParse({ kind: 'supplier', names: ['Alpes', 'MS'] }).success).toBe(
      true,
    )
    expect(partiesBulkSchema.safeParse({ kind: 'supplier', names: [] }).success).toBe(false)
    expect(partiesBulkSchema.safeParse({ kind: 'supplier', names: ['X'] }).success).toBe(false)
  })

  it('gastos fijos: cada uno con su cuenta y su vencimiento', () => {
    const ok = recurringBulkSchema.safeParse({
      items: [{ name: 'Alarma', accountId: ACCOUNT, dueDay: 10, nextDueDate: '2026-10-10' }],
    })
    expect(ok.success).toBe(true)
    expect(
      recurringBulkSchema.safeParse({
        items: [{ name: 'Alarma', accountId: null, dueDay: 10, nextDueDate: '2026-10-10' }],
      }).success,
    ).toBe(false)
  })
})
