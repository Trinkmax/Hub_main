import { redirect } from 'next/navigation'

// Marcas aliadas se unificó en /menu (Club → "Aliados").
export default async function AliadosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=aliados`)
}
