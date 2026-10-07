import { redirect } from 'next/navigation'

// Las punch cards se unificaron en el editor de /menu (Club → "Punch cards").
// Redirect para no romper links viejos ni bookmarks.
export default async function PunchCardsRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=punch`)
}
