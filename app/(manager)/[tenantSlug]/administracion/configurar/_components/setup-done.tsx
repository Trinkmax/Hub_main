import { ArrowUpRight, CheckCircle2, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { WizardProgress } from './wizard-progress'

/**
 * Paso 4 · Listo (H.3): qué hacer ahora. Lo dibuja la página cuando la
 * puesta en marcha ya terminó (con o sin saldos iniciales), también si se
 * vuelve a entrar a `/configurar` más adelante: por eso dice que ya está
 * configurada y manda a Ajustes, que es donde se cambia lo que se cargó acá.
 * Server-safe.
 */
export function SetupDone({ tenantSlug }: { tenantSlug: string }) {
  const base = `/${tenantSlug}/administracion`
  const next = [
    {
      title: 'Cargá el cierre de ayer',
      description: 'Lo que se vendió y cómo te pagaron.',
      href: `${base}/ventas/cierre`,
    },
    {
      title: 'Cargá un gasto',
      description: 'El hielo, la verdulería, una factura de un proveedor.',
      href: `${base}?accion=gasto`,
    },
    {
      title: 'Habilitá a tu socio',
      description: 'Ajustes › Accesos: Administración es privada hasta que la habilites.',
      href: `${base}/ajustes?tab=accesos`,
    },
    {
      title: 'Sumá a la contadora',
      description: 'Ve y exporta los libros; no carga ni cambia nada.',
      href: `${base}/ajustes?tab=accesos`,
    },
  ]

  return (
    <div className="space-y-6">
      <WizardProgress current={3} />
      <section className="card-hairline space-y-5 rounded-xl border bg-card p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
          <div className="space-y-1">
            <h2 className="font-serif text-xl font-semibold tracking-tight">
              Administración ya está configurada.
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Desde ahora, todo lo que cargues suma en las cajas, las cuentas y los libros. Los
              datos de la SAS, las cajas y los medios de cobro se cambian en Ajustes.
            </p>
          </div>
        </div>
        <ol className="space-y-2">
          {next.map((item, index) => (
            <li key={item.title}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3 outline-none transition-colors hover:border-border hover:bg-background/80 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs font-semibold tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
                <ArrowUpRight
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link href={`${base}/ajustes`}>
              <Settings2 className="size-4" aria-hidden />
              Ir a Ajustes
            </Link>
          </Button>
          <Button asChild className="h-11 min-w-[160px] md:h-9">
            <Link href={base}>Ir al Resumen</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
