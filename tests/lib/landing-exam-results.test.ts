import { describe, expect, it } from 'vitest'
import {
  countedResultIds,
  type ExamResult,
  formatAverage,
  formatExamDuration,
  normalizeTakerName,
  parseExamResult,
  parseExamResultsOrder,
  sortExamResults,
  summarizeExamResults,
} from '@/lib/landings/exam-results'

function result(
  partial: Partial<ExamResult> & { id: string; name: string; score: number },
): ExamResult {
  return {
    total: 20,
    stations: [],
    answers: [],
    durationSeconds: 300,
    leftScreen: 0,
    attempt: 1,
    deviceId: 'cel-1',
    createdAt: '2026-11-26T19:00:00.000Z',
    ...partial,
  }
}

describe('leer una fila', () => {
  it('arma el resultado con las estaciones y las respuestas', () => {
    const parsed = parseExamResult({
      id: 'r1',
      taker_name: 'Raul',
      score: 16,
      total: 20,
      stations: [{ name: 'Cafetería', ok: 3, of: 5 }],
      answers: [
        {
          station: 'Cafetería',
          question: '¿Qué lleva el Capuccino?',
          picked: null,
          right: 'Espresso…',
          ok: false,
        },
      ],
      duration_seconds: 339,
      left_screen: 1,
      attempt: 2,
      device_id: 'cel',
      created_at: '2026-11-26T19:50:33Z',
    })
    expect(parsed.name).toBe('Raul')
    expect(parsed.stations).toEqual([{ name: 'Cafetería', ok: 3, of: 5 }])
    expect(parsed.answers[0]?.picked).toBeNull()
    expect(parsed.leftScreen).toBe(1)
    expect(parsed.attempt).toBe(2)
  })

  it('si el JSON no cierra, lo deja vacío en vez de romper la pantalla', () => {
    const parsed = parseExamResult({
      id: 'r2',
      taker_name: 'Ana',
      score: 3,
      total: 10,
      stations: 'cualquier cosa',
      answers: [{ question: 1 }],
      duration_seconds: 10,
      created_at: '2026-11-26T19:00:00Z',
    })
    expect(parsed.stations).toEqual([])
    expect(parsed.answers).toEqual([])
    expect(parsed.deviceId).toBeNull()
  })
})

describe('quién cuenta para el promedio', () => {
  it('la misma persona escrita distinto es la misma', () => {
    expect(normalizeTakerName('  Raúl   Gómez ')).toBe(normalizeTakerName('raul gomez'))
  })

  it('cuenta el primer intento de cada uno', () => {
    const results = [
      result({ id: 'b', name: 'raul', score: 19, createdAt: '2026-11-26T20:00:00Z' }),
      result({ id: 'a', name: 'Raúl', score: 12, createdAt: '2026-11-26T19:00:00Z' }),
      result({ id: 'c', name: 'Ana', score: 15, createdAt: '2026-11-26T19:30:00Z' }),
    ]
    expect([...countedResultIds(results)].sort()).toEqual(['a', 'c'])
  })
})

describe('el resumen', () => {
  const answers = (oks: boolean[]) =>
    oks.map((ok, i) => ({
      station: i < 2 ? 'Cafetería' : 'Noche',
      question: `P${i}`,
      picked: ok ? 'bien' : 'mal',
      right: 'bien',
      ok,
    }))

  const results = [
    result({
      id: 'a',
      name: 'Ana',
      score: 14,
      stations: [
        { name: 'Cafetería', ok: 5, of: 5 },
        { name: 'Noche', ok: 2, of: 5 },
      ],
      answers: answers([true, true, false, false]),
      createdAt: '2026-11-26T19:00:00Z',
    }),
    result({
      id: 'b',
      name: 'Beto',
      score: 10,
      stations: [
        { name: 'Cafetería', ok: 4, of: 5 },
        { name: 'Noche', ok: 1, of: 5 },
      ],
      answers: answers([true, false, false, true]),
      createdAt: '2026-11-26T19:10:00Z',
    }),
    // Ana otra vez: se muestra, pero no mejora el promedio.
    result({ id: 'c', name: 'ana', score: 20, createdAt: '2026-11-26T19:20:00Z' }),
  ]

  it('promedia el primer intento de cada persona', () => {
    const summary = summarizeExamResults(results)
    expect(summary.takers).toBe(2)
    expect(summary.repeats).toBe(1)
    expect(summary.total).toBe(20)
    expect(summary.average).toBeCloseTo(12)
  })

  it('«le fue bien» es 70 % o más: 14 de 20', () => {
    const summary = summarizeExamResults(results)
    expect(summary.goodFrom).toBe(14)
    expect(summary.good).toBe(1)
    expect(
      summarizeExamResults([result({ id: 'x', name: 'X', score: 7, total: 10 })]).goodFrom,
    ).toBe(7)
  })

  it('suma cada estación entre todos', () => {
    expect(summarizeExamResults(results).stations).toEqual([
      { name: 'Cafetería', ok: 9, of: 10, ratio: 0.9 },
      { name: 'Noche', ok: 3, of: 10, ratio: 0.3 },
    ])
  })

  it('las preguntas que más se equivocaron, primero las que nadie supo', () => {
    const hardest = summarizeExamResults(results).hardest
    expect(hardest.map((q) => q.question)).toEqual(['P2', 'P1', 'P3'])
    expect(hardest[0]).toMatchObject({ wrong: 2, asked: 2, right: 'bien', station: 'Noche' })
  })

  it('sin resultados no inventa nada', () => {
    const empty = summarizeExamResults([])
    expect(empty).toMatchObject({
      takers: 0,
      repeats: 0,
      total: null,
      average: null,
      goodFrom: null,
      good: 0,
    })
    expect(empty.stations).toEqual([])
    expect(empty.hardest).toEqual([])
  })
})

describe('el orden de la lista', () => {
  const results = [
    result({ id: 'a', name: 'A', score: 10, createdAt: '2026-11-26T19:00:00Z' }),
    result({ id: 'b', name: 'B', score: 18, createdAt: '2026-11-26T19:05:00Z' }),
    result({ id: 'c', name: 'C', score: 18, createdAt: '2026-11-26T18:55:00Z' }),
  ]

  it('por nota: la mejor arriba y, si empatan, quien lo rindió antes', () => {
    expect(sortExamResults(results, 'nota').map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('por los más nuevos', () => {
    expect(sortExamResults(results, 'recientes').map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('por nota, un intento repetido va al final aunque tenga la mejor nota', () => {
    const withRepeat = [
      ...results,
      result({ id: 'd', name: 'a', score: 20, createdAt: '2026-11-26T19:30:00Z' }),
    ]
    expect(sortExamResults(withRepeat, 'nota').map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('cualquier otra cosa en la dirección es por nota', () => {
    expect(parseExamResultsOrder('recientes')).toBe('recientes')
    expect(parseExamResultsOrder(undefined)).toBe('nota')
    expect(parseExamResultsOrder(['recientes'])).toBe('nota')
  })
})

describe('cómo se escriben', () => {
  it('el tiempo', () => {
    expect(formatExamDuration(339)).toBe('5 min 39 s')
    expect(formatExamDuration(45)).toBe('45 s')
    expect(formatExamDuration(120)).toBe('2 min')
    expect(formatExamDuration(-3)).toBe('0 s')
  })

  it('el promedio', () => {
    expect(formatAverage(15.25)).toBe('15,3')
    expect(formatAverage(12)).toBe('12')
  })
})
