import { SectionNotFound } from './_components/section-not-found'

/**
 * Un comprobante, asiento o ficha que no existe (o que es de otro bar: la RLS no lo muestra). Con «solo
 * compras y pagos», también lo que no es de su acceso: el texto lo elige `SectionNotFound`.
 */
export default function AdministracionNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <SectionNotFound />
    </div>
  )
}
