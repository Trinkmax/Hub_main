import { redirect } from 'next/navigation'
import { bookHref, firstParam } from './_lib/periods'

/**
 * `/libros` ya no es una pantalla: Contabilidad abre en Sumas y saldos, con lo que traía el link
 * (`?mes=` de los mensajes a la contadora, el Resumen y las rutas viejas). Las solapas las dibuja
 * `AdmNav`; el paquete del mes y la historia están en Cierre de mes.
 */
export default async function LibrosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const kept: Record<string, string | null> = {}
  for (const key of Object.keys(sp)) kept[key] = firstParam(sp[key])
  redirect(bookHref(`/${tenantSlug}/administracion/libros/sumas-y-saldos`, kept))
}
