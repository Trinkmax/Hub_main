import { redirect } from 'next/navigation'

// Las punch cards se unificaron bajo el Club de beneficios (/club/punch-cards).
// Redirect para no romper links viejos ni bookmarks.
export default async function PunchCardsRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club/punch-cards`)
}
