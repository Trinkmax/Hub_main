import { redirect } from 'next/navigation'

// "Puntos y recompensas" vive en el editor del club (/club, pestaña "Puntos y niveles").
// Mantenemos este redirect para no romper links viejos ni bookmarks.
export default async function PuntosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=programa`)
}
