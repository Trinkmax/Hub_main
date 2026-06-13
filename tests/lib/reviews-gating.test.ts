import { describe, expect, it } from 'vitest'
import { decideReviewRedirect } from '@/lib/reviews/gating'

const MAPS = 'https://maps.google.com/?cid=123'

describe('decideReviewRedirect', () => {
  it('sin URL de Maps → nunca redirige (cualquier puntaje)', () => {
    expect(decideReviewRedirect({ rating: 5, gatingEnabled: true, mapsUrl: null })).toEqual({
      redirectTo: null,
      redirectedToMaps: false,
    })
    expect(decideReviewRedirect({ rating: 5, gatingEnabled: false, mapsUrl: '   ' })).toEqual({
      redirectTo: null,
      redirectedToMaps: false,
    })
  })

  it('gating ON: sólo 5★ va a Maps', () => {
    expect(decideReviewRedirect({ rating: 5, gatingEnabled: true, mapsUrl: MAPS })).toEqual({
      redirectTo: MAPS,
      redirectedToMaps: true,
    })
    for (const rating of [1, 2, 3, 4]) {
      expect(decideReviewRedirect({ rating, gatingEnabled: true, mapsUrl: MAPS })).toEqual({
        redirectTo: null,
        redirectedToMaps: false,
      })
    }
  })

  it('gating OFF: cualquier puntaje va a Maps', () => {
    for (const rating of [1, 3, 5]) {
      expect(decideReviewRedirect({ rating, gatingEnabled: false, mapsUrl: MAPS })).toEqual({
        redirectTo: MAPS,
        redirectedToMaps: true,
      })
    }
  })
})
