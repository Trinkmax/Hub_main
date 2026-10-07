import { redirect } from 'next/navigation'

// Las punch cards viven en el editor del club (/club, pestaña "Punch cards").
// Redirect para no romper links viejos ni bookmarks.
export default async function PunchCardsRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=punch`)
}
