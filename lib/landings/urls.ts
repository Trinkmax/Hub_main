import 'server-only'
import { getAppUrl } from '@/lib/app-url'
import { HAS_LANDINGS_HOST, landingsOrigin } from './security'

/**
 * La base de las URLs públicas de las landings. `${base}/${slug}` es siempre el
 * link que se comparte, sin importar el modo:
 *
 *   con host dedicado → https://paginas.tudominio            → …/halloween
 *   sin host dedicado → https://tudominio/p                  → …/halloween
 *
 * Devolver la base ya armada (y no el host suelto) es lo que permite que el
 * panel no tenga que saber en qué modo está corriendo.
 */
export async function getLandingsBase(): Promise<string> {
  const origin = landingsOrigin()
  if (HAS_LANDINGS_HOST && origin) return origin
  return `${await getAppUrl()}/p`
}

/** La misma base sin protocolo, para mostrarla adelante del input del slug. */
export function landingsPrefix(base: string): string {
  return `${base.replace(/^https?:\/\//, '')}/`
}
