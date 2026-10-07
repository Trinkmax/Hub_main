import { redirect } from 'next/navigation'

// Link viejo: el regalo de bienvenida vive en /club, pestaña «Bienvenida».
export default async function BienvenidaRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=bienvenida`)
}
