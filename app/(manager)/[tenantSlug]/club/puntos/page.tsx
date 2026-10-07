import { redirect } from 'next/navigation'

// Link viejo: puntos y recompensas viven en /club, pestaña «Puntos y niveles».
export default async function PuntosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=programa`)
}
