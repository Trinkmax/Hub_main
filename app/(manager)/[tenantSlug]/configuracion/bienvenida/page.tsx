import { redirect } from 'next/navigation'

// El "Regalo de bienvenida" se movió al Club de beneficios (/club/bienvenida).
// Redirect para no romper links viejos ni bookmarks.
export default async function BienvenidaRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club/bienvenida`)
}
