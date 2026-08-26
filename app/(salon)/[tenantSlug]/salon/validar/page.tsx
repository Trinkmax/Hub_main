import { redirect } from 'next/navigation'

/**
 * Compat: la pantalla se llama `/salon/escanear` desde el rediseño del panel de
 * mozos (el mozo no "valida", suma puntos). Queda el redirect porque un celular
 * con la PWA instalada puede tener la URL vieja en el historial o en la pantalla
 * de inicio. Se puede borrar en un par de releases.
 */
export default async function ValidarRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ code?: string }>
}) {
  const { tenantSlug } = await params
  const { code } = await searchParams
  const qs = code ? `?code=${encodeURIComponent(code)}` : ''
  redirect(`/${tenantSlug}/salon/escanear${qs}`)
}
