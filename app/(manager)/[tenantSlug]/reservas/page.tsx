import { redirect } from 'next/navigation'
import { legacyReservasRedirect } from '@/lib/salon/calendar-links'

export const dynamic = 'force-dynamic'

// La lista de reservas se retiró: el calendario (/eventos/programados) es la
// puerta única para ver y cargar reservas, cortadas por servicio. Este redirect
// (temporal, como el de /eventos) cubre bookmarks, el historial y los links
// viejos, y traduce lo que se pueda: ?day abre ese día (con ?nueva resaltada),
// ?from abre su mes y ?q abre el buscador del calendario. Solo aplica a la
// lista exacta: /reservas/nuevo y /reservas/[id] siguen siendo rutas propias.
// El 307 HTTP de verdad lo da el proxy (legacyReservasTarget en
// lib/supabase/middleware.ts) con el mismo mapeo: el loading.tsx de
// [tenantSlug] vuelve streaming esta página y en carga dura el redirect() de
// acá saldría como 200 + meta refresh. Esto queda de red de seguridad.
// No valida rol acá a propósito: no lee datos, y el calendario ya exige
// RESERVATION_STAFF_ROLES (igual que hacía esta página).
export default async function ReservasRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  redirect(legacyReservasRedirect(tenantSlug, sp))
}
