import { Tags } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { comprasHref } from '../_lib/links'

/**
 * «76 de 79 proveedores no tienen categoría»: la franja que invita a ordenar la
 * casa una sola vez. Lleva al clasificador (`?filtro=sin-clasificar`), el mismo
 * destino y el mismo verbo de «Clasificar proveedores» de la puesta en marcha.
 *
 * Es una franja callada y su botón va en contorno: en esta pantalla lo primero
 * es lo que se debe (con deuda a la vista, la pestaña la dibuja debajo de la
 * libreta). Solo la ve quien carga (la monta la pestaña con permiso de
 * escritura) y solo si falta alguno.
 */
export function UnclassifiedStrip({
  tenantSlug,
  pending,
  total,
}: {
  tenantSlug: string
  /** Cuántos no tienen categoría. */
  pending: number
  /** A cuántos se les puede elegir una. */
  total: number
}) {
  if (pending <= 0) return null
  const all = Math.max(total, pending)
  return (
    <section
      aria-label="Proveedores sin categoría"
      className="flex flex-col gap-3 rounded-2xl bg-secondary/50 p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-2xs max-sm:hidden"
      >
        <Tags className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug text-pretty">
          {pending === 1 && all === 1 ? (
            'Tu proveedor no tiene categoría'
          ) : (
            <>
              <span className="tabular-nums">
                {pending} de {all}
              </span>{' '}
              {/* El sustantivo concuerda con el total; el verbo, con los que faltan. */}
              {all === 1 ? 'proveedor' : 'proveedores'} {pending === 1 ? 'no tiene' : 'no tienen'}{' '}
              categoría
            </>
          )}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground text-pretty">
          {pending === 1
            ? 'Decí una sola vez en qué le comprás y sus compras se ordenan solas. Es un toque; si no, te lo preguntamos la primera vez que le cargues algo.'
            : 'Decí una sola vez en qué le comprás a cada uno y sus compras se ordenan solas. Es un toque por proveedor; si no, te lo preguntamos la primera vez que le cargues algo.'}
        </p>
      </div>
      <Button asChild variant="outline" className="h-11 shrink-0 rounded-full px-5">
        <Link href={comprasHref(tenantSlug, 'proveedores', { filtro: 'sin-clasificar' })}>
          {pending === 1 ? 'Clasificarlo ahora' : 'Clasificarlos ahora'}
        </Link>
      </Button>
    </section>
  )
}
