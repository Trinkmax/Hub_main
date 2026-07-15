import { redirect } from 'next/navigation'

// El "Regalo de bienvenida" se unificó en el editor de /menu (Club → "Bienvenida").
// Redirect para no romper links viejos ni bookmarks.
export default async function BienvenidaRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/menu?world=club&tab=bienvenida`)
}
