import { slugify } from '@/lib/tenant/slugify'

/**
 * Deriva un slug válido (2–40 chars) y único a partir de un nombre, evitando
 * colisiones con `existing` (slugs ya usados). Sufija `-2`, `-3`… hasta
 * encontrar uno libre; lanza si no encuentra ninguno.
 */
export function uniqueSlugFrom(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  let base = slugify(name)
  if (base.length < 2) base = 'formato'

  if (!taken.has(base)) return base

  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`
    const candidate = base.slice(0, 40 - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`uniqueSlugFrom: no se pudo derivar un slug libre para "${name}"`)
}
