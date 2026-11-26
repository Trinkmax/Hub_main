import { z } from 'zod'

/**
 * Resultados de los exámenes que se publican como páginas de Marketing (`landing_exam_results`).
 *
 * La página del examen es HTML suelto: al terminar llama a `submit_landing_exam_result` con la clave
 * pública y la fila queda con el texto de cada pregunta y de lo que se contestó, así el resultado
 * sigue siendo legible aunque el examen se corrija después. Acá vive lo que el panel hace con esas
 * filas; sin `server-only` porque no toca la base.
 */

/** Una estación (o parte) del examen con lo que sacó esa persona: «Cafetería 4 de 5». */
export type ExamStation = { name: string; ok: number; of: number }

/** Una pregunta tal como la vio y la contestó (`picked` en null si no respondió a tiempo). */
export type ExamAnswer = {
  station: string
  question: string
  picked: string | null
  right: string
  ok: boolean
}

export type ExamResult = {
  id: string
  name: string
  score: number
  total: number
  stations: ExamStation[]
  answers: ExamAnswer[]
  durationSeconds: number
  leftScreen: number
  attempt: number
  deviceId: string | null
  createdAt: string
}

/** Desde qué parte de las preguntas bien decimos que «le fue bien»: 7 de cada 10. */
export const GOOD_RATIO = 0.7

const stationSchema = z.object({
  name: z.string(),
  ok: z.number().int().nonnegative(),
  of: z.number().int().positive(),
})

const answerSchema = z.object({
  station: z.string().catch(''),
  question: z.string(),
  picked: z.string().nullable().catch(null),
  right: z.string(),
  ok: z.boolean(),
})

/** Una fila de `landing_exam_results`. Si una parte en JSON no cierra, se muestra vacía y no rompe. */
export function parseExamResult(row: Record<string, unknown>): ExamResult {
  const stations = z.array(stationSchema).safeParse(row.stations)
  const answers = z.array(answerSchema).safeParse(row.answers)
  return {
    id: String(row.id),
    name: String(row.taker_name ?? ''),
    score: Number(row.score ?? 0),
    total: Number(row.total ?? 0),
    stations: stations.success ? stations.data : [],
    answers: answers.success ? answers.data : [],
    durationSeconds: Number(row.duration_seconds ?? 0),
    leftScreen: Number(row.left_screen ?? 0),
    attempt: Number(row.attempt ?? 1),
    deviceId: typeof row.device_id === 'string' ? row.device_id : null,
    createdAt: String(row.created_at),
  }
}

/** «Raúl  Gómez» y «raul gomez» son la misma persona para saber quién lo volvió a rendir. */
export function normalizeTakerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const byOldest = (a: ExamResult, b: ExamResult) => a.createdAt.localeCompare(b.createdAt)

/**
 * Qué intentos cuentan para el promedio: el primero de cada persona. Si alguien lo vuelve a rendir
 * (otro celular, o «lo va a rendir otra persona» con su mismo nombre), la segunda nota se muestra pero
 * no mejora el promedio: la primera es la que dice cuánto sabía.
 */
export function countedResultIds(results: ExamResult[]): Set<string> {
  const first = new Map<string, string>()
  for (const result of [...results].sort(byOldest)) {
    const key = normalizeTakerName(result.name)
    if (!first.has(key)) first.set(key, result.id)
  }
  return new Set(first.values())
}

export type ExamSummary = {
  /** Personas distintas que lo rindieron. */
  takers: number
  /** Intentos que no cuentan (la misma persona otra vez). */
  repeats: number
  /** Preguntas del examen (las del intento más nuevo). */
  total: number | null
  /** Nota promedio, en la escala de `total`. */
  average: number | null
  /** Nota desde la que «le fue bien» (70 %, redondeado para arriba). */
  goodFrom: number | null
  /** Cuántas personas llegaron a `goodFrom`. */
  good: number
  /** Promedio por estación, en el orden del examen. */
  stations: Array<{ name: string; ok: number; of: number; ratio: number }>
  /** Las preguntas que más se equivocaron (hasta 3), con la respuesta que era. */
  hardest: Array<{ question: string; station: string; right: string; wrong: number; asked: number }>
}

export function summarizeExamResults(results: ExamResult[]): ExamSummary {
  const ids = countedResultIds(results)
  const counted = results.filter((result) => ids.has(result.id)).sort(byOldest)
  const latest = counted.at(-1) ?? null
  const total = latest?.total ?? null

  const ratios = counted.filter((r) => r.total > 0).map((r) => r.score / r.total)
  const averageRatio = ratios.length
    ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
    : null

  const stations = new Map<string, { ok: number; of: number }>()
  const questions = new Map<
    string,
    { station: string; right: string; wrong: number; asked: number }
  >()
  for (const result of counted) {
    for (const station of result.stations) {
      const acc = stations.get(station.name) ?? { ok: 0, of: 0 }
      acc.ok += station.ok
      acc.of += station.of
      stations.set(station.name, acc)
    }
    for (const answer of result.answers) {
      const acc = questions.get(answer.question) ?? {
        station: answer.station,
        right: answer.right,
        wrong: 0,
        asked: 0,
      }
      acc.asked += 1
      if (!answer.ok) acc.wrong += 1
      questions.set(answer.question, acc)
    }
  }

  return {
    takers: counted.length,
    repeats: results.length - counted.length,
    total,
    average: averageRatio === null || total === null ? null : averageRatio * total,
    goodFrom: total === null ? null : Math.ceil(GOOD_RATIO * total - 1e-9),
    good: counted.filter((r) => r.total > 0 && r.score / r.total >= GOOD_RATIO - 1e-9).length,
    stations: [...stations].map(([name, { ok, of }]) => ({
      name,
      ok,
      of,
      ratio: of ? ok / of : 0,
    })),
    hardest: [...questions]
      .map(([question, acc]) => ({ question, ...acc }))
      .filter((q) => q.wrong > 0)
      .sort((a, b) => b.wrong / b.asked - a.wrong / a.asked || b.wrong - a.wrong)
      .slice(0, 3),
  }
}

export type ExamResultsOrder = 'nota' | 'recientes'

export function parseExamResultsOrder(value: unknown): ExamResultsOrder {
  return value === 'recientes' ? 'recientes' : 'nota'
}

/**
 * Por nota (la mejor arriba; empate, quien lo rindió antes) o por los más nuevos. Por nota, los
 * intentos que no cuentan (`counted` no los tiene) van al final: un 20 de alguien que lo rindió dos
 * veces no puede encabezar la lista.
 */
export function sortExamResults(
  results: ExamResult[],
  order: ExamResultsOrder,
  counted: Set<string> = countedResultIds(results),
): ExamResult[] {
  const sorted = [...results]
  if (order === 'recientes') return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ratio = (r: ExamResult) => (r.total > 0 ? r.score / r.total : 0)
  const repeat = (r: ExamResult) => (counted.has(r.id) ? 0 : 1)
  return sorted.sort((a, b) => repeat(a) - repeat(b) || ratio(b) - ratio(a) || byOldest(a, b))
}

/** 339 → «5 min 39 s»; 45 → «45 s». */
export function formatExamDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/** 15.25 → «15,3». Sin decimales si es entero. */
export function formatAverage(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)
}
