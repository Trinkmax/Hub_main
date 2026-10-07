import { redirect } from 'next/navigation'

// Link viejo: los niveles viven en /club, pestaña «Puntos y niveles».
export default async function NivelesRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=programa`)
}
