import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSampleOrder } from '@/lib/ticketing/queries'
import { TopBar } from '../../_components/chrome'
import { SampleView } from './_components/sample-view'

/**
 * Una entrada de muestra para ver y filmar cómo queda sin pagar: el pago, la
 * entrada que se imprime, el corte en la puerta y la pantalla de quien recibe. No
 * toca la base ni crea reservas. No la enlaza nadie y no se indexa.
 *
 * `?pelicula=<slug>` elige la película, `?nombre=` el nombre, `?personas=` cuántos y
 * `?ver=puerta` abre lo que ve quien recibe. `?video=1` es para grabar: sin los botones
 * de la muestra, y el talón se corta solo.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { absolute: 'Entrada de muestra' },
  robots: { index: false, follow: false },
}

export default async function MuestraPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  const text = (key: string) => {
    const value = sp[key]
    return typeof value === 'string' ? value : undefined
  }
  const people = Number.parseInt(text('personas') ?? '', 10)
  const page = await getSampleOrder(tenantSlug, {
    film: text('pelicula'),
    name: text('nombre'),
    people: Number.isFinite(people) ? people : undefined,
  })
  if (!page) notFound()

  return (
    <>
      {text('ver') === 'puerta' ? null : <TopBar venue={page.venue} />}
      <SampleView
        order={page.order}
        tenantName={page.venue.tenantName}
        address={page.venue.address}
        door={text('ver') === 'puerta'}
        video={text('video') === '1'}
      />
    </>
  )
}
