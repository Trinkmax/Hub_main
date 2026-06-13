// Decisión de redirección de reseña (PURA → testeable). Espejo de la regla del
// flujo público. Semántica del toggle:
//   - sin URL de Maps → nunca redirige (todo queda como feedback interno).
//   - gating ON  → sólo 5★ va a Maps; 1–4★ quedan internas (lo que pidió el dueño).
//   - gating OFF → cualquier puntaje va a Maps (100% dentro de la política de Google).
export function decideReviewRedirect(input: {
  rating: number
  gatingEnabled: boolean
  mapsUrl: string | null
}): { redirectTo: string | null; redirectedToMaps: boolean } {
  const url = input.mapsUrl?.trim()
  if (!url) return { redirectTo: null, redirectedToMaps: false }
  if (input.gatingEnabled) {
    return input.rating === 5
      ? { redirectTo: url, redirectedToMaps: true }
      : { redirectTo: null, redirectedToMaps: false }
  }
  return { redirectTo: url, redirectedToMaps: true }
}
