import { ArrowLeft, Hand } from 'lucide-react'
import Link from 'next/link'

/** «← Volver a …» arriba del encabezado (admin-ui §1 «Volver»). Server-safe. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
    >
      <ArrowLeft className="size-3" aria-hidden />
      {label}
    </Link>
  )
}

/**
 * «¿Qué queda para cargar a mano?» (diseño §4.5): lo que los importadores
 * todavía no traen, dónde se carga y por qué. Plegado, con el link a la guía
 * completa. Server-safe.
 */
export function StillManual({ slug }: { slug: string }) {
  const base = `/${slug}/administracion`
  const items: Array<{ what: string; where: string; href: string; why: string }> = [
    {
      what: 'Las ventas de cada día',
      where: 'Ventas › Cargar cierre',
      href: `${base}/ventas/cierre`,
      why: 'Pegás la columna del cierre de caja del sistema que usás hoy.',
    },
    {
      what: 'Gastos chicos sin factura (hielo, verdulería)',
      where: 'Nuevo gasto',
      href: `${base}?accion=gasto`,
      why: 'No aparecen en ARCA porque no tienen factura a tu nombre.',
    },
    {
      what: 'Liquidaciones de tarjetas (bruto, arancel, retenciones)',
      where: 'Registrar un cobro',
      href: `${base}?accion=cobrar`,
      why: 'Todavía no hay importador de las procesadoras de tarjetas.',
    },
    {
      what: 'Facturas en papel, del exterior o de contingencia',
      where: 'Compras › Nueva factura',
      href: `${base}/compras/nueva`,
      why: 'No figuran en «Mis Comprobantes» de ARCA.',
    },
    {
      what: 'Sueldos y cargas sociales',
      where: 'Libros › Asiento manual',
      href: `${base}/libros/asiento-manual`,
      why: 'Los lleva tu contador o contadora con su propio sistema.',
    },
  ]
  return (
    <details className="card-hairline group rounded-xl border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
          <Hand className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg font-semibold tracking-tight">
            ¿Qué queda para cargar a mano?
          </span>
          <span className="block text-sm text-muted-foreground">
            Lo que estos archivos todavía no traen, y dónde se carga.
          </span>
        </span>
        <span className="text-xs font-medium text-muted-foreground group-open:hidden">Ver</span>
        <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
          Ocultar
        </span>
      </summary>
      <div className="border-t border-border/60 px-5 py-4">
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <li
              key={item.what}
              className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{item.what}</p>
                <p className="text-sm text-muted-foreground text-pretty">{item.why}</p>
              </div>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2 sm:min-h-0 sm:self-center"
              >
                {item.where}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          La guía completa, con lo que se carga una sola vez y lo de todos los días, está en{' '}
          <Link
            href={`${base}/guias/como-arrancar`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Cómo arrancar
          </Link>
          .
        </p>
      </div>
    </details>
  )
}
