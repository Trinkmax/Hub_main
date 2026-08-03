import { describe, expect, it } from 'vitest'
import {
  formatReviewsSummary,
  isLowRating,
  reviewSourceLabel,
  summarizeRatings,
} from '@/lib/reviews/summary'

describe('reviewSourceLabel', () => {
  it('traduce los orígenes del check de la DB', () => {
    expect(reviewSourceLabel('wallet')).toBe('Wallet')
    expect(reviewSourceLabel('whatsapp')).toBe('WhatsApp')
    expect(reviewSourceLabel('qr')).toBe('QR')
    expect(reviewSourceLabel('manual')).toBe('Manual')
  })

  it('un origen nuevo se muestra crudo en vez de dejar el chip vacío', () => {
    expect(reviewSourceLabel('instagram')).toBe('instagram')
    expect(reviewSourceLabel('')).toBe('')
  })
})

describe('isLowRating', () => {
  it('1 y 2 estrellas son las que el dueño busca primero', () => {
    expect(isLowRating(1)).toBe(true)
    expect(isLowRating(2)).toBe(true)
  })

  it('3 para arriba no lleva acento', () => {
    for (const rating of [3, 4, 5]) expect(isLowRating(rating)).toBe(false)
  })
})

describe('summarizeRatings', () => {
  it('sin reseñas devuelve total 0 y no divide por cero', () => {
    expect(summarizeRatings([])).toEqual({ total: 0, average: 0 })
  })

  it('promedia con un decimal', () => {
    expect(summarizeRatings([5, 4, 4])).toEqual({ total: 3, average: 4.3 })
    expect(summarizeRatings([1, 2])).toEqual({ total: 2, average: 1.5 })
    expect(summarizeRatings([5])).toEqual({ total: 1, average: 5 })
  })
})

describe('formatReviewsSummary', () => {
  it('sin reseñas muestra el guion del bloque Insights', () => {
    expect(formatReviewsSummary({ total: 0, average: 0 })).toBe('—')
  })

  it('usa coma decimal y siempre un decimal', () => {
    expect(formatReviewsSummary({ total: 3, average: 4.3 })).toBe('★ 4,3 · 3 reseñas')
    expect(formatReviewsSummary({ total: 2, average: 5 })).toBe('★ 5,0 · 2 reseñas')
  })

  it('singular cuando dejó una sola', () => {
    expect(formatReviewsSummary({ total: 1, average: 2 })).toBe('★ 2,0 · 1 reseña')
  })
})
