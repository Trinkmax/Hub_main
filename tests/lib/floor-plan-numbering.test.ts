import { describe, expect, it } from 'vitest'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'

describe('suggestNextLabel', () => {
  it('base case: sin labels existentes devuelve String(numberStart)', () => {
    expect(suggestNextLabel(1, [])).toBe('1')
    expect(suggestNextLabel(101, [])).toBe('101')
    expect(suggestNextLabel(0, [])).toBe('0')
  })

  it('saltea labels tomados consecutivos (no hay hueco)', () => {
    expect(suggestNextLabel(1, ['1', '2', '3'])).toBe('4')
  })

  it('rellena el primer hueco disponible desde numberStart', () => {
    // 1 y 3 tomados, 2 libre
    expect(suggestNextLabel(1, ['1', '3'])).toBe('2')
    // 1,2,4 tomados, 3 libre
    expect(suggestNextLabel(1, ['1', '2', '4'])).toBe('3')
  })

  it('ignora labels no numéricos al buscar el próximo entero', () => {
    // 'Barra' y 'VIP' no son enteros → no afectan; 1 tomado, 2 libre
    expect(suggestNextLabel(1, ['1', 'Barra', 'VIP'])).toBe('2')
    // solo labels no numéricos → arranca en numberStart
    expect(suggestNextLabel(5, ['Barra', 'Reservada'])).toBe('5')
  })

  it('ignora numéricos con formato distinto a String(n) (ceros a la izquierda, decimales)', () => {
    // '01' no es igual a String(1) → '1' sigue libre como string
    expect(suggestNextLabel(1, ['01'])).toBe('1')
    // '2.0' no matchea String(2)
    expect(suggestNextLabel(2, ['2.0'])).toBe('2')
  })

  it('PA: arranca en 101 y rellena huecos por encima', () => {
    expect(suggestNextLabel(101, [])).toBe('101')
    expect(suggestNextLabel(101, ['101', '102'])).toBe('103')
    expect(suggestNextLabel(101, ['101', '103'])).toBe('102')
  })

  it('labels por debajo de numberStart no cuentan', () => {
    // '1','2' están por debajo de 101 → no afectan; arranca en 101
    expect(suggestNextLabel(101, ['1', '2', '50'])).toBe('101')
  })
})
