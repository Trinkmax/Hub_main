import { redirect } from 'next/navigation'

// Los eventos se unificaron en el Calendario (/eventos/programados). El sistema
// viejo de "Shows y fiestas" se retiró; este redirect cubre links/bookmarks.
export default async function EventosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/eventos/programados`)
}
