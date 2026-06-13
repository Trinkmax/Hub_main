import { redirect } from 'next/navigation'

// "Puntos y recompensas" se unificó bajo el Club de beneficios (/club/puntos).
// Mantenemos este redirect para no romper links viejos ni bookmarks.
export default async function PuntosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club/puntos`)
}
