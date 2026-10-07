import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import {
  canonicalInput,
  centsField,
  centsFromForm,
  centsToPesosInput,
  centsToSubmitValue,
  decimalEsAr,
  formatCents,
  formatCentsCsv,
  formatCentsShort,
  formatPesos,
  MONEY_MAX_CENTS,
  type MoneyParse,
  moneyParseMessage,
  parseLocaleNumber,
  parseMoneyToCents,
  pesosFromForm,
} from '@/lib/money'
import * as legacy from '@/lib/salon/event-marketing'

// El espacio duro va solo después del `$` y antes de la «D»/«A» del saldo.
const nb = (s: string) => s.replace(/\$ /g, '$ ').replace(/ ([DA])$/, ' $1')
const MINUS = '−'

/** PRNG con semilla (mulberry32): mismos casos en cada corrida, sin dependencias. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ok(result: MoneyParse): number {
  if (!result.ok) throw new Error(`esperaba ok y dio ${result.reason}`)
  return result.cents
}

// ─── parseMoneyToCents ───────────────────────────────────────────────────────

describe('parseMoneyToCents', () => {
  const accepted: Array<[string, number]> = [
    // Los del kit (MoneyField) y del Sprint 1 (I.4).
    ['1.234,50', 123450],
    ['1234.5', 123450],
    ['1,234.50', 123450],
    ['$ 1.234', 123400],
    ['US$175,26', 17526],
    ['1234,5', 123450],
    ['1234.50', 123450],
    ['1.234.567', 123456700],
    // Pegado con espacios o espacios duros.
    ['  $ 1.234,50 ', 123450],
    ['US$ 175,26', 17526],
    ['1 234,50', 123450],
    ['1 234,50', 123450],
    ['2.480.000,50', 248000050],
    ['0,5', 50],
    [',5', 50],
    ['0', 0],
    ['0,00', 0],
    ['00012', 1200],
    // La trampa de la coma flotante: 0,29 × 100 = 28,999999999999996.
    ['0,29', 29],
    ['1,005.07', 100507],
    ['8.420', 842000],
    ['8,420', 842000],
    // Un guion DESPUÉS del número con texto atrás es texto, como en parseLocaleNumber.
    ['175,26 - USD', 17526],
    ['$1.234,50 ARS', 123450],
    // Paréntesis que no envuelven al número no lo hacen negativo.
    ['(USD) 175,26', 17526],
    ['175,26 (USD)', 17526],
  ]

  it.each(accepted)('%j → %i centavos', (raw, cents) => {
    expect(parseMoneyToCents(raw)).toEqual({ ok: true, cents })
  })

  it('vacío no es cero', () => {
    for (const raw of ['', '   ', ' ', null, undefined]) {
      expect(parseMoneyToCents(raw)).toEqual({ ok: false, reason: 'vacio' })
    }
  })

  it('rechaza más de dos decimales, incluido 0,125 (que no son miles)', () => {
    for (const raw of ['1.234,567', '1,234.567', '0,125', '0.125', ',125', '00,125', '0,1234']) {
      expect(parseMoneyToCents(raw)).toEqual({ ok: false, reason: 'demasiados-decimales' })
    }
  })

  it('rechaza negativos por defecto, se escriban como se escriban', () => {
    for (const raw of [
      '-1.234,50',
      `${MINUS}1.234,50`,
      '– 5',
      '$ -5',
      '- $ 1.234',
      '(1.234,50)',
      '$ (1.234,50)',
      '1.234,50-',
      '1.234,50 -',
      '-0',
    ]) {
      expect(parseMoneyToCents(raw)).toEqual({ ok: false, reason: 'negativo' })
    }
  })

  it('con allowNegative lee el signo (y −0 vuelve como 0)', () => {
    const neg = { allowNegative: true }
    expect(parseMoneyToCents('-1.234,50', neg)).toEqual({ ok: true, cents: -123450 })
    expect(parseMoneyToCents(`${MINUS}$ 1.234,50`, neg)).toEqual({ ok: true, cents: -123450 })
    expect(parseMoneyToCents('(500)', neg)).toEqual({ ok: true, cents: -50000 })
    expect(parseMoneyToCents('$ (1.234,50)', neg)).toEqual({ ok: true, cents: -123450 })
    expect(parseMoneyToCents('1.234,50-', neg)).toEqual({ ok: true, cents: -123450 })
    const zero = ok(parseMoneyToCents('-0,00', neg))
    expect(Object.is(zero, 0)).toBe(true)
  })

  it('lo que no es un número es ilegible (también un CUIT pegado por error)', () => {
    for (const raw of [
      'abc',
      '$',
      '-',
      '12,3,4',
      '1.234.5',
      '1.234,',
      '1234.567',
      '20-12345678-6',
      '1-2',
      '12a34',
      '1.234,50 - 3',
    ]) {
      expect(parseMoneyToCents(raw)).toEqual({ ok: false, reason: 'ilegible' })
    }
  })

  it('tope de 1e15 centavos, inclusive, para los dos signos', () => {
    expect(MONEY_MAX_CENTS).toBe(1e15)
    expect(parseMoneyToCents('10.000.000.000.000')).toEqual({ ok: true, cents: 1e15 })
    expect(parseMoneyToCents('10.000.000.000.000,01')).toEqual({
      ok: false,
      reason: 'fuera-de-rango',
      bound: 'max',
      limitCents: 1e15,
    })
    // 20 dígitos: no entran exactos en un number; el tope se compara con BigInt.
    expect(parseMoneyToCents('99999999999999999999')).toMatchObject({
      ok: false,
      reason: 'fuera-de-rango',
      bound: 'max',
    })
    expect(parseMoneyToCents('-10.000.000.000.000,01', { allowNegative: true })).toEqual({
      ok: false,
      reason: 'fuera-de-rango',
      bound: 'min',
      limitCents: -1e15,
    })
    // Un maxCents más alto que el tope no lo levanta.
    expect(parseMoneyToCents('10.000.000.000.000,01', { maxCents: 1e16 })).toMatchObject({
      reason: 'fuera-de-rango',
      limitCents: 1e15,
    })
  })

  it('minCents y maxCents propios', () => {
    expect(parseMoneyToCents('5', { minCents: 1000 })).toEqual({
      ok: false,
      reason: 'fuera-de-rango',
      bound: 'min',
      limitCents: 1000,
    })
    expect(parseMoneyToCents('10,01', { maxCents: 1000 })).toEqual({
      ok: false,
      reason: 'fuera-de-rango',
      bound: 'max',
      limitCents: 1000,
    })
    expect(parseMoneyToCents('10', { minCents: 1000, maxCents: 1000 })).toEqual({
      ok: true,
      cents: 1000,
    })
  })

  it('wholePesos: centavos distintos de cero dan con-decimales', () => {
    expect(parseMoneyToCents('1.234,50', { wholePesos: true })).toEqual({
      ok: false,
      reason: 'con-decimales',
    })
    expect(parseMoneyToCents('1.234,00', { wholePesos: true })).toEqual({ ok: true, cents: 123400 })
  })

  it('lee lo mismo que parseLocaleNumber donde los dos aceptan (sin flotantes)', () => {
    for (const raw of ['175,26', '1.234,5', '1,234.50', '$ 1.500.000', '2.480.000,50', '0,5']) {
      const legacyValue = parseLocaleNumber(raw, 'money')
      if (!legacyValue.ok) throw new Error(raw)
      expect(ok(parseMoneyToCents(raw))).toBe(Math.round(legacyValue.value * 100))
    }
  })

  it('ida y vuelta: lo que escribe el formato se vuelve a leer igual (10.000 importes)', () => {
    const rand = prng(20261006)
    for (let i = 0; i < 10_000; i++) {
      const magnitude = 10 ** Math.floor(rand() * 16)
      // `|| 0`: 0 × −1 es −0, y el parser (bien) nunca devuelve −0.
      const cents = Math.floor(rand() * magnitude) * (rand() < 0.3 ? -1 : 1) || 0
      const neg = { allowNegative: true }
      expect(ok(parseMoneyToCents(centsToPesosInput(cents), neg))).toBe(cents)
      expect(ok(parseMoneyToCents(centsToPesosInput(cents, { decimals: 'auto' }), neg))).toBe(cents)
      expect(ok(parseMoneyToCents(centsToSubmitValue(cents, 'pesos'), neg))).toBe(cents)
      // El de pantalla también: «−$ 1.234,50» con espacio duro y menos tipográfico.
      expect(ok(parseMoneyToCents(formatCents(cents), neg))).toBe(cents)
    }
  })
})

describe('moneyParseMessage', () => {
  it('los mensajes del campo (kit, MoneyField)', () => {
    expect(moneyParseMessage({ ok: false, reason: 'vacio' })).toBe('Falta el importe.')
    expect(moneyParseMessage({ ok: false, reason: 'ilegible' }, ' 12,3,4 ')).toBe(
      'No entendemos «12,3,4». Escribilo como 1.234,50.',
    )
    expect(moneyParseMessage({ ok: false, reason: 'negativo' })).toBe(
      'Tiene que ser un importe positivo.',
    )
    expect(moneyParseMessage({ ok: false, reason: 'demasiados-decimales' })).toBe(
      'Usá hasta dos decimales.',
    )
    expect(moneyParseMessage({ ok: false, reason: 'con-decimales' })).toBe(
      'Tiene que ser un importe sin centavos.',
    )
  })

  it('fuera de rango nombra el borde, entero si es redondo', () => {
    const min = parseMoneyToCents('5', { minCents: 100000 })
    const max = parseMoneyToCents('5', { maxCents: 150 })
    if (min.ok || max.ok) throw new Error('esperaba error')
    expect(moneyParseMessage(min)).toBe(nb('Tiene que ser de $ 1.000 o más.'))
    expect(moneyParseMessage(max)).toBe(nb('Tiene que ser de hasta $ 1,50.'))
    expect(moneyParseMessage(max, '5', { currency: 'USD' })).toBe(
      nb('Tiene que ser de hasta US$ 1,50.'),
    )
  })
})

// ─── Formato ─────────────────────────────────────────────────────────────────

describe('formatCents', () => {
  it('dos decimales, puntos de miles, espacio duro después del $', () => {
    expect(formatCents(123450)).toBe(nb('$ 1.234,50'))
    expect(formatCents(0)).toBe(nb('$ 0,00'))
    expect(formatCents(5)).toBe(nb('$ 0,05'))
    expect(formatCents(100)).toBe(nb('$ 1,00'))
    expect(formatCents(86000000)).toBe(nb('$ 860.000,00'))
    expect(formatCents(123456789012345n)).toBe(nb('$ 1.234.567.890.123,45'))
    expect(formatCents(1e15)).toBe(nb('$ 10.000.000.000.000,00'))
  })

  it('negativo con el menos tipográfico U+2212 adelante del $', () => {
    expect(formatCents(-123450)).toBe(`${MINUS}${nb('$ 1.234,50')}`)
    expect(formatCents(-5n)).toBe(`${MINUS}${nb('$ 0,05')}`)
  })

  it('faltante no es cero', () => {
    expect(formatCents(null)).toBe('—')
    expect(formatCents(undefined)).toBe('—')
    expect(formatCents(Number.NaN)).toBe('—')
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatCents(null, { empty: '' })).toBe('')
  })

  it('sin centavos: la mitad redondea lejos del cero, y lo que da cero no lleva signo', () => {
    expect(formatCents(123450, { decimals: 0 })).toBe(nb('$ 1.235'))
    expect(formatCents(123449, { decimals: 0 })).toBe(nb('$ 1.234'))
    expect(formatCents(-123450, { decimals: 0 })).toBe(`${MINUS}${nb('$ 1.235')}`)
    expect(formatCents(50, { decimals: 0 })).toBe(nb('$ 1'))
    expect(formatCents(-49, { decimals: 0 })).toBe(nb('$ 0'))
  })

  it('signo: always y never', () => {
    expect(formatCents(100, { sign: 'always' })).toBe(nb('+$ 1,00'))
    expect(formatCents(-100, { sign: 'always' })).toBe(`${MINUS}${nb('$ 1,00')}`)
    expect(formatCents(0, { sign: 'always' })).toBe(nb('$ 0,00'))
    expect(formatCents(-100, { sign: 'never' })).toBe(nb('$ 1,00'))
  })

  it('saldo con lado: absoluto + D o A', () => {
    expect(formatCents(-124000000, { side: 'auto', currency: false, decimals: 0 })).toBe(
      nb('1.240.000 A'),
    )
    expect(formatCents(5000, { side: 'auto' })).toBe(nb('$ 50,00 D'))
    expect(formatCents(0, { side: 'auto' })).toBe(nb('$ 0,00 D'))
    expect(formatCents(5000, { side: 'A' })).toBe(nb('$ 50,00 A'))
    expect(formatCents(-5000, { side: 'D', currency: false })).toBe(nb('50,00 D'))
  })

  it('moneda: dólar o sin prefijo', () => {
    expect(formatCents(17526, { currency: 'USD' })).toBe(nb('US$ 175,26'))
    expect(formatCents(-17526, { currency: 'USD' })).toBe(`${MINUS}${nb('US$ 175,26')}`)
    expect(formatCents(123450, { currency: false })).toBe('1.234,50')
    expect(formatCents(123450, { currency: null })).toBe('1.234,50')
  })

  it('un number con decimales se redondea al centavo lejos del cero, igual para los dos signos', () => {
    expect(formatCents(12.5)).toBe(nb('$ 0,13'))
    expect(formatCents(-12.5)).toBe(`${MINUS}${nb('$ 0,13')}`)
  })
})

describe('formatCentsShort', () => {
  it('0 decimales para KPIs', () => {
    expect(formatCentsShort(123450)).toBe(nb('$ 1.235'))
    expect(formatCentsShort(123450, { currency: false })).toBe('1.235')
    expect(formatCentsShort(null)).toBe('—')
  })
})

describe('formatCentsCsv', () => {
  it('coma decimal, sin miles, guion ASCII, siempre dos decimales', () => {
    expect(formatCentsCsv(-123450)).toBe('-1234,50')
    expect(formatCentsCsv(123450)).toBe('1234,50')
    expect(formatCentsCsv(0)).toBe('0,00')
    expect(formatCentsCsv(5)).toBe('0,05')
    expect(formatCentsCsv(-5)).toBe('-0,05')
    expect(formatCentsCsv(123456789012345n)).toBe('1234567890123,45')
  })

  it('vacío si no hay dato', () => {
    expect(formatCentsCsv(null)).toBe('')
    expect(formatCentsCsv(undefined)).toBe('')
    expect(formatCentsCsv(Number.NaN)).toBe('')
  })
})

describe('formatPesos', () => {
  it('mismo formato que formatCents, desde pesos', () => {
    expect(formatPesos(1234.5)).toBe(nb('$ 1.234,50'))
    expect(formatPesos(2_480_000, { decimals: 0 })).toBe(nb('$ 2.480.000'))
    expect(formatPesos(-2_480_000, { decimals: 0 })).toBe(`${MINUS}${nb('$ 2.480.000')}`)
    expect(formatPesos(2_480_000n)).toBe(nb('$ 2.480.000,00'))
    expect(formatPesos(null)).toBe('—')
    expect(formatPesos(Number.NaN)).toBe('—')
  })

  it('redondea una sola vez y sobre el decimal (1,005 → 1,01; 1234,495 → 1.234)', () => {
    expect(formatPesos(1.005)).toBe(nb('$ 1,01'))
    expect(formatPesos(1234.495, { decimals: 0 })).toBe(nb('$ 1.234'))
    expect(formatPesos(-0.004)).toBe(nb('$ 0,00'))
  })

  it('en positivos coincide con formatArs (que queda como estaba, con «$ -5» en negativos)', () => {
    for (const pesos of [0, 7, 999, 1234, 254127, 2_480_000, 85517.24, 1_000_000_000]) {
      expect(formatPesos(pesos, { decimals: 0 })).toBe(legacy.formatArs(pesos))
    }
    expect(legacy.formatArs(-5)).toBe(nb('$ -5'))
    expect(formatPesos(-5, { decimals: 0 })).toBe(`${MINUS}${nb('$ 5')}`)
  })
})

describe('centsToPesosInput y centsToSubmitValue', () => {
  it('el texto prolijo del campo al salir', () => {
    expect(centsToPesosInput(123450)).toBe('1.234,50')
    expect(centsToPesosInput(50_000_000)).toBe('500.000,00')
    expect(centsToPesosInput(50_000_000, { decimals: 'auto' })).toBe('500.000')
    expect(centsToPesosInput(123450, { decimals: 'auto' })).toBe('1.234,50')
    expect(centsToPesosInput(-123450)).toBe('-1.234,50')
    expect(centsToPesosInput(123450, { grouping: false })).toBe('1234,50')
    expect(centsToPesosInput(123450n)).toBe('1.234,50')
    expect(centsToPesosInput(null)).toBe('')
  })

  it('el hidden canónico: centavos o pesos con punto, vacío si no hay importe', () => {
    expect(centsToSubmitValue(123450)).toBe('123450')
    expect(centsToSubmitValue(-123450, 'cents')).toBe('-123450')
    expect(centsToSubmitValue(123450, 'pesos')).toBe('1234.50')
    expect(centsToSubmitValue(-5, 'pesos')).toBe('-0.05')
    expect(centsToSubmitValue(0, 'pesos')).toBe('0.00')
    expect(centsToSubmitValue(null)).toBe('')
  })
})

// ─── Compatibilidad con «Cómo nos fue» ───────────────────────────────────────

describe('lo que se mudó desde event-marketing.ts', () => {
  it('event-marketing reexporta las mismas funciones', () => {
    expect(legacy.parseLocaleNumber).toBe(parseLocaleNumber)
    expect(legacy.canonicalInput).toBe(canonicalInput)
    expect(legacy.decimalEsAr).toBe(decimalEsAr)
  })

  it('canonicalInput sigue dando lo mismo (conteos = formatCount)', () => {
    expect(canonicalInput(1234.5, 'money')).toBe('1.234,50')
    expect(canonicalInput(2_480_000, 'money')).toBe('2.480.000')
    expect(canonicalInput(1450.5, 'rate')).toBe('1.450,50')
    for (const n of [0, 7, 8420, 1_000_000, 51.4, 51.5]) {
      expect(canonicalInput(n, 'count')).toBe(legacy.formatCount(n))
    }
  })
})

// ─── zod ─────────────────────────────────────────────────────────────────────

function issue(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('centsFromForm', () => {
  it('el hidden canónico → centavos enteros', () => {
    expect(centsFromForm().parse('123450')).toBe(123450)
    expect(centsFromForm().parse(' 123450 ')).toBe(123450)
    expect(centsFromForm().parse(123450)).toBe(123450)
    expect(centsFromForm().parse('0')).toBe(0)
  })

  it('vacío: null con optional, o «Falta el importe.»', () => {
    expect(centsFromForm({ optional: true }).parse('')).toBeNull()
    expect(centsFromForm({ optional: true }).parse(null)).toBeNull()
    expect(issue(centsFromForm(), '')).toBe('Falta el importe.')
    expect(issue(centsFromForm(), null)).toBe('Falta el importe.')
    expect(issue(centsFromForm(), undefined)).toBe('Falta el importe.')
  })

  it('lo que no son dígitos no se adivina', () => {
    const unreadable = 'No pudimos leer el importe. Volvé a escribirlo.'
    for (const raw of ['1.234,50', '12.5', 'abc', '1e5', '12345678901234567']) {
      expect(issue(centsFromForm(), raw)).toBe(unreadable)
    }
    expect(issue(centsFromForm(), new Blob(['1']))).toBe(unreadable)
  })

  it('signo y rango', () => {
    expect(issue(centsFromForm(), '-5')).toBe('Tiene que ser un importe positivo.')
    expect(centsFromForm({ allowNegative: true }).parse('-5')).toBe(-5)
    expect(issue(centsFromForm({ min: 100 }), '50')).toBe(nb('Tiene que ser de $ 1 o más.'))
    expect(issue(centsFromForm({ max: 100_000 }), '100001')).toBe(
      nb('Tiene que ser de hasta $ 1.000.'),
    )
    expect(issue(centsFromForm(), '1000000000000001')).toBe(
      nb('Tiene que ser de hasta $ 10.000.000.000.000.'),
    )
  })

  it('anda adentro de un z.object con lo que trae un FormData', () => {
    const schema = z.object({ amount: centsFromForm(), tip: centsFromForm({ optional: true }) })
    const form = new FormData()
    form.set('amount', '123450')
    form.set('tip', '')
    expect(schema.parse({ amount: form.get('amount'), tip: form.get('tip') })).toEqual({
      amount: 123450,
      tip: null,
    })
  })

  it('tipos: optional → number | null; si no, number', () => {
    expectTypeOf(centsFromForm().parse('1')).toEqualTypeOf<number>()
    expectTypeOf(centsFromForm({ optional: true }).parse('1')).toEqualTypeOf<number | null>()
  })
})

describe('pesosFromForm', () => {
  it('modo viejo: "1234.50" → pesos', () => {
    expect(pesosFromForm().parse('1234.50')).toBe(1234.5)
    expect(pesosFromForm().parse('1234')).toBe(1234)
    expect(pesosFromForm({ optional: true }).parse('')).toBeNull()
    expect(issue(pesosFromForm(), '')).toBe('Falta el importe.')
    expect(issue(pesosFromForm(), '1.234,50')).toBe(
      'No pudimos leer el importe. Volvé a escribirlo.',
    )
    expect(issue(pesosFromForm({ min: 10 }), '9.99')).toBe(nb('Tiene que ser de $ 10 o más.'))
    expect(issue(pesosFromForm({ max: 99.5 }), '100')).toBe(nb('Tiene que ser de hasta $ 99,50.'))
  })
})

describe('centsField', () => {
  it('lo tipeado en pesos → centavos, con los mensajes del campo', () => {
    expect(centsField().parse('1.234,50')).toBe(123450)
    expect(centsField().parse('US$175,26')).toBe(17526)
    expect(centsField({ optional: true }).parse('')).toBeNull()
    expect(centsField({ optional: true }).parse(undefined)).toBeNull()
    expect(issue(centsField(), '')).toBe('Falta el importe.')
    expect(issue(centsField(), '12,3,4')).toBe('No entendemos «12,3,4». Escribilo como 1.234,50.')
    expect(issue(centsField(), '-5')).toBe('Tiene que ser un importe positivo.')
    expect(centsField({ allowNegative: true }).parse('-5')).toBe(-500)
    expect(issue(centsField({ maxCents: 100 }), '2')).toBe(nb('Tiene que ser de hasta $ 1.'))
    expect(issue(centsField(), 1234)).toBe('No pudimos leer el importe. Volvé a escribirlo.')
  })
})

describe('clave ausente en un z.object (un input disabled no viaja en el FormData)', () => {
  // Con `optional` y la clave ausente, zod 4 contestaba «Invalid input: expected
  // nonoptional» en inglés aunque la transformación devolviera null.
  it.each([
    ['centsFromForm', centsFromForm({ optional: true }), centsFromForm()],
    ['pesosFromForm', pesosFromForm({ optional: true }), pesosFromForm()],
    ['centsField', centsField({ optional: true }), centsField()],
  ] as const)('%s: optional → null; obligatorio → «Falta el importe.»', (_name, optional, required) => {
    expect(z.object({ amount: optional }).parse({})).toEqual({ amount: null })
    const result = z.object({ amount: required }).safeParse({})
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toEqual(['Falta el importe.'])
  })
})

// ─── Hidratación: nada de Intl ni toLocale* ──────────────────────────────────

describe('sin Intl ni toLocale* (mismo string en el server y en el navegador)', () => {
  beforeEach(() => {
    vi.stubGlobal('Intl', undefined)
    const boom = () => {
      throw new Error('no se usa toLocale*')
    }
    vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(boom)
    vi.spyOn(BigInt.prototype, 'toLocaleString').mockImplementation(boom)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('formato y parseo andan igual', () => {
    expect(formatCents(-123450)).toBe(`${MINUS}${nb('$ 1.234,50')}`)
    expect(formatCentsShort(123450)).toBe(nb('$ 1.235'))
    expect(formatCentsCsv(-123450)).toBe('-1234,50')
    expect(formatPesos(1234.5)).toBe(nb('$ 1.234,50'))
    expect(centsToPesosInput(123450)).toBe('1.234,50')
    expect(parseMoneyToCents('1.234,50')).toEqual({ ok: true, cents: 123450 })
    expect(parseLocaleNumber('1,234.50', 'money')).toEqual({ ok: true, value: 1234.5 })
    expect(canonicalInput(1234.5, 'money')).toBe('1.234,50')
    expect(
      moneyParseMessage({ ok: false, reason: 'fuera-de-rango', bound: 'min', limitCents: 100 }),
    ).toBe(nb('Tiene que ser de $ 1 o más.'))
  })
})
