import { ChevronDown } from 'lucide-react'
import Link from 'next/link'

/**
 * «¿Y lo que no viene en ningún archivo?»: lo que ARCA, Mercado Pago y el banco
 * no traen, por qué, y dónde se carga, con el nombre que cada destino tiene en
 * su pantalla. Es el puente con «sin factura» (que queda registrado igual) y
 * con el bar sin punto de venta (las ventas se anotan a mano).
 *
 * Plegado: es una consulta, no una tarea. Solo para quien puede cargar (la
 * página no lo monta en solo lectura). Server-safe.
 */
export function StillManual({ slug }: { slug: string }) {
  const base = `/${slug}/administracion`
  const items: ReadonlyArray<{ what: string; why: string; where: string; href: string }> = [
    {
      what: 'Lo que se vendió cada día',
      why: 'No hay punto de venta conectado: se anota a mano.',
      where: 'Cerrar el día',
      href: `${base}/ventas/cierre`,
    },
    {
      what: 'Lo que pagaste sin factura (hielo, verdulería, un flete)',
      why: 'No está en ARCA porque no tiene factura a nombre del bar. Queda registrado igual.',
      where: 'Pagué algo recién',
      href: `${base}/importar?accion=gasto`,
    },
    {
      what: 'Lo que te depositó una tarjeta o una app de delivery',
      why: 'Todavía no hay archivo de las tarjetas.',
      where: 'Me entró plata',
      href: `${base}/importar?accion=cobrar`,
    },
    {
      what: 'Facturas en papel o del exterior',
      why: 'No figuran en Mis Comprobantes.',
      where: 'Cargar una compra que debo',
      href: `${base}/compras/nueva`,
    },
    {
      what: 'Sueldos y cargas sociales',
      why: 'Los lleva tu contadora con su sistema.',
      where: 'Sueldos del mes',
      href: `${base}/libros/asiento-manual?tipo=sueldos`,
    },
  ]
  return (
    <details className="card-hairline group/manual rounded-2xl border bg-card shadow-xs [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg font-semibold leading-snug tracking-tight">
            ¿Y lo que no viene en ningún archivo?
          </span>
          <span className="block text-sm text-muted-foreground">
            Cinco cosas que se cargan a mano, y dónde.
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/manual:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border/60 px-4 py-4 sm:px-5">
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <li
              key={item.what}
              className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium leading-snug">{item.what}</p>
                <p className="text-sm text-muted-foreground text-pretty">{item.why}</p>
              </div>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9"
              >
                {item.where}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          ¿No sabés dónde va algo?{' '}
          <Link
            href={`${base}/guias`}
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mirá la guía
          </Link>
          .
        </p>
      </div>
    </details>
  )
}
