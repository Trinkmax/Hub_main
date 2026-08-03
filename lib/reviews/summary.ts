// Helpers de presentación de reseñas en la ficha del cliente. Viven acá y no en
// el componente para poder testearlos sin DB ni render.

export const REVIEW_SOURCE_LABELS = {
  wallet: 'Wallet',
  whatsapp: 'WhatsApp',
  qr: 'QR',
  manual: 'Manual',
} as const

export type ReviewSource = keyof typeof REVIEW_SOURCE_LABELS

/**
 * El `source` está acotado por un check en la DB, pero si mañana se agrega uno
 * nuevo preferimos mostrar el crudo antes que dejar un chip vacío en la ficha.
 */
export function reviewSourceLabel(source: string): string {
  return source in REVIEW_SOURCE_LABELS ? REVIEW_SOURCE_LABELS[source as ReviewSource] : source
}

/** 1–2★ es lo primero que el dueño busca al abrir la ficha: se destacan. */
export function isLowRating(rating: number): boolean {
  return rating <= 2
}

export type ReviewsSummary = { total: number; average: number }

/** Promedio a un decimal. Sin reseñas, `average` es 0 y `total` manda. */
export function summarizeRatings(ratings: number[]): ReviewsSummary {
  if (ratings.length === 0) return { total: 0, average: 0 }
  const sum = ratings.reduce((acc, rating) => acc + rating, 0)
  return {
    total: ratings.length,
    average: Math.round((sum / ratings.length) * 10) / 10,
  }
}

/** Línea del bloque Insights: "★ 4,3 · 3 reseñas". Sin reseñas devuelve "—". */
export function formatReviewsSummary(summary: ReviewsSummary): string {
  if (summary.total === 0) return '—'
  const average = summary.average.toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return `★ ${average} · ${summary.total} ${summary.total === 1 ? 'reseña' : 'reseñas'}`
}
