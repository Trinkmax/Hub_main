import { redirect } from 'next/navigation'

// "Templates" dejó de ser una sección propia: ahora es la pestaña "Eventos" dentro
// de Calendario. Mantenemos la ruta viva como redirect para no romper deep-links viejos.
export default async function TemplatesRedirectPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/eventos/programados?tab=eventos`)
}
