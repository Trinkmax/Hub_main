import { redirect } from 'next/navigation'

// Link viejo: Marcas aliadas vive en /club, pestaña «Aliados».
export default async function AliadosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=aliados`)
}
