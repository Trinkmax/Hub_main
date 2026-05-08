import { describe, expect, it } from 'vitest'
import { csvEscape, rowsToCsv } from '@/lib/stats/csv'

describe('csvEscape', () => {
  it('valor simple no se wrappea', () => {
    expect(csvEscape('hola')).toBe('hola')
  })
  it('null/undefined → string vacío', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })
  it('coma fuerza wrap', () => {
    expect(csvEscape('uno, dos')).toBe('"uno, dos"')
  })
  it('comilla doble se escapa duplicada', () => {
    expect(csvEscape('di "hola"')).toBe('"di ""hola"""')
  })
  it('newline fuerza wrap', () => {
    expect(csvEscape('linea1\nlinea2')).toBe('"linea1\nlinea2"')
  })
  it('número se serializa sin comillas', () => {
    expect(csvEscape(42)).toBe('42')
  })
})

describe('rowsToCsv', () => {
  it('emite header + filas separadas con newline', () => {
    const csv = rowsToCsv(
      ['nombre', 'edad'],
      [
        ['Juan', 30],
        ['María, López', 28],
      ],
    )
    expect(csv).toBe(`nombre,edad\nJuan,30\n"María, López",28`)
  })

  it('headers vacíos no rompen', () => {
    expect(rowsToCsv(['a', 'b'], [])).toBe('a,b')
  })
})
