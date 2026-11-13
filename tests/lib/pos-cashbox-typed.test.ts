import { describe, expect, it } from 'vitest'
import {
  checkTypedAmount,
  formatPesosTyping,
  pesosDigits,
  pesosText,
  readPesos,
  typedQuestion,
} from '@/lib/pos/cash/typed-amount'

const pesos = (n: number): number => n * 100
/** `formatCentsShort` pega el signo al número con un espacio duro: así se escribe lo esperado. */
const nb = (text: string): string => text.replaceAll('$ ', '$\u00a0')

describe('el campo de plata de la caja', () => {
  it('separa los miles mientras se tipea y tira lo que no es un dígito', () => {
    expect(formatPesosTyping('12500')).toBe('12.500')
    expect(formatPesosTyping('$ 1.234.567')).toBe('1.234.567')
    expect(formatPesosTyping('12a5')).toBe('125')
    expect(formatPesosTyping('')).toBe('')
  })

  it('saca los ceros de adelante pero deja un cero solo', () => {
    expect(pesosDigits('007')).toBe('7')
    expect(pesosDigits('0')).toBe('0')
    expect(pesosDigits('000')).toBe('0')
  })

  it('no deja escribir más de nueve cifras', () => {
    expect(pesosDigits('12345678901')).toBe('123456789')
  })

  it('lee centavos, y vacío no es cero', () => {
    expect(readPesos('15.000')).toBe(pesos(15_000))
    expect(readPesos('0')).toBe(0)
    expect(readPesos('')).toBeNull()
    expect(readPesos('   ')).toBeNull()
  })

  it('escribe centavos como se leen en el campo', () => {
    expect(pesosText(pesos(15_000))).toBe('15.000')
    expect(pesosText(0)).toBe('0')
    expect(pesosText(null)).toBe('')
    expect(pesosText(149)).toBe('1')
    expect(pesosText(150)).toBe('2')
  })
})

describe('el cuidado de los ceros', () => {
  it('sin referencia, pregunta por todo lo que no llega a $ 1.000', () => {
    const check = checkTypedAmount(pesos(129))
    expect(check).toEqual({
      kind: 'ask',
      why: 'small',
      typedCents: pesos(129),
      suggestedCents: pesos(129_000),
    })
    if (check.kind === 'ask') expect(typedQuestion(check)).toBe(nb('¿$ 129 o $ 129.000?'))
  })

  it('sin referencia, $ 1.000 o más pasa sin preguntar', () => {
    expect(checkTypedAmount(pesos(1_000))).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(pesos(8_000))).toEqual({ kind: 'ok' })
  })

  it('el cero y lo que no es un número no son de acá', () => {
    expect(checkTypedAmount(0)).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(Number.NaN)).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(-500)).toEqual({ kind: 'ok' })
  })

  it('con referencia, lo mismo que había pasa siempre', () => {
    expect(checkTypedAmount(pesos(500), { referenceCents: pesos(500) })).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(pesos(15_000), { referenceCents: pesos(15_000) })).toEqual({
      kind: 'ok',
    })
  })

  it('con referencia, entre la quinta parte y cinco veces no pregunta', () => {
    const reference = { referenceCents: pesos(15_000) }
    expect(checkTypedAmount(pesos(3_000), reference)).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(pesos(12_000), reference)).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(pesos(75_000), reference)).toEqual({ kind: 'ok' })
  })

  it('con referencia, propone agregar los ceros que faltan', () => {
    const check = checkTypedAmount(pesos(15), { referenceCents: pesos(15_000) })
    expect(check).toMatchObject({ kind: 'ask', why: 'low', suggestedCents: pesos(15_000) })
    const close = checkTypedAmount(pesos(12), { referenceCents: pesos(15_000) })
    expect(close).toMatchObject({ kind: 'ask', why: 'low', suggestedCents: pesos(12_000) })
  })

  it('con referencia, propone sacar el cero que sobra', () => {
    const check = checkTypedAmount(pesos(150_000), { referenceCents: pesos(15_000) })
    expect(check).toMatchObject({ kind: 'ask', why: 'high', suggestedCents: pesos(15_000) })
  })

  it('elige el candidato que queda más cerca de la referencia', () => {
    // 7 contra un millón: 700.000 queda adentro (entre 200.000 y 5.000.000); 7.000.000, no.
    const far = checkTypedAmount(pesos(7), { referenceCents: pesos(1_000_000) })
    expect(far).toMatchObject({ kind: 'ask', why: 'low', suggestedCents: pesos(700_000) })
    // 1 contra 30: entran 10 y 100; 10 está más cerca.
    const near = checkTypedAmount(pesos(1), { referenceCents: pesos(30) })
    expect(near).toMatchObject({ kind: 'ask', why: 'low', suggestedCents: pesos(10) })
  })

  it('si ningún candidato queda cerca de la referencia, pregunta sin proponer', () => {
    // 999.999 contra $ 1: sacando cifras quedan 99.999, 9.999, 999, 99 y 9; ninguno llega a $ 5.
    const check = checkTypedAmount(pesos(999_999), { referenceCents: pesos(1) })
    expect(check).toMatchObject({ kind: 'ask', why: 'high', suggestedCents: null })
    if (check.kind === 'ask') expect(typedQuestion(check)).toBe(nb('¿Seguro que $ 999.999?'))
  })

  it('más de lo que hay en el cajón: pregunta y propone un cero menos', () => {
    const check = checkTypedAmount(pesos(80_000), { capCents: pesos(54_000) })
    expect(check).toEqual({
      kind: 'ask',
      why: 'over',
      typedCents: pesos(80_000),
      suggestedCents: pesos(8_000),
    })
  })

  it('más de lo que hay, sin candidato que entre: pregunta igual', () => {
    const check = checkTypedAmount(pesos(9), { capCents: pesos(5) })
    expect(check).toMatchObject({ kind: 'ask', why: 'over', suggestedCents: null })
    if (check.kind === 'ask') expect(typedQuestion(check)).toBe(nb('¿Seguro que $ 9?'))
  })

  it('con el cajón en cero, cualquier retiro se pregunta', () => {
    expect(checkTypedAmount(pesos(2_000), { capCents: 0 })).toMatchObject({
      kind: 'ask',
      why: 'over',
    })
  })

  it('un monto chico que con los ceros se pasaría del cajón no se propone', () => {
    const check = checkTypedAmount(pesos(129), { capCents: pesos(54_000) })
    expect(check).toMatchObject({ kind: 'ask', why: 'small', suggestedCents: null })
    const fits = checkTypedAmount(pesos(8), { capCents: pesos(54_000) })
    expect(fits).toMatchObject({ kind: 'ask', why: 'small', suggestedCents: pesos(8_000) })
  })

  it('lo que entra en el cajón y no es chico pasa sin preguntar', () => {
    expect(checkTypedAmount(pesos(8_000), { capCents: pesos(54_000) })).toEqual({ kind: 'ok' })
    expect(checkTypedAmount(pesos(54_000), { capCents: pesos(54_000) })).toEqual({ kind: 'ok' })
  })
})
