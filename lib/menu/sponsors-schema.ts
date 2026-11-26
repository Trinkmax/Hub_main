/**
 * Leer los sponsors de la carta desde la configuración del bar — del lado del servidor (y de los
 * scripts). Está aparte de `sponsors.ts` para que la validación con zod no viaje al celular: allá solo
 * hace falta dibujar los sellos, no leerlos de la base.
 */
import { z } from 'zod'
import { foldText } from './carta'
import { type CartaSponsor, MAX_SPONSORS, safeLogoUrl } from './sponsors'

const sponsorSchema = z.object({
  name: z.string().trim().min(1).max(60),
  logo_url: z.string(),
  ratio: z.number().min(0.2).max(8),
  density: z.number().min(0.02).max(1).nullish(),
  keywords: z.array(z.string()).max(12).nullish(),
})

/** Lo que se guarda en `tenants.settings.carta_sponsors`. */
export type StoredSponsor = z.input<typeof sponsorSchema>

/**
 * Los sponsors de un bar a partir de su `settings`. No confía en la forma: una marca mal cargada se
 * saltea y las demás se muestran igual (la carta pública no se puede romper por un logo).
 */
export function parseCartaSponsors(settings: unknown): CartaSponsor[] {
  if (!settings || typeof settings !== 'object') return []
  const raw = (settings as Record<string, unknown>).carta_sponsors
  if (!Array.isArray(raw)) return []
  const sponsors: CartaSponsor[] = []
  for (const candidate of raw) {
    if (sponsors.length >= MAX_SPONSORS) break
    const parsed = sponsorSchema.safeParse(candidate)
    if (!parsed.success) continue
    const logoUrl = safeLogoUrl(parsed.data.logo_url)
    if (!logoUrl) continue
    const keywords = (parsed.data.keywords ?? [])
      .map((keyword) => foldText(keyword))
      .filter((keyword) => keyword.length >= 2 && keyword.length <= 40)
    sponsors.push({
      name: parsed.data.name,
      logoUrl,
      ratio: parsed.data.ratio,
      density: parsed.data.density ?? null,
      keywords: [...new Set(keywords)],
    })
  }
  return sponsors
}
