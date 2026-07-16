import { redirect } from 'next/navigation'

// El Regalo de bienvenida se unificó en /menu (Club → "Bienvenida").
export default async function BienvenidaRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=bienvenida`)
}
