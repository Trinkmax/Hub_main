import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Panel, StatusPill } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { InboxNext } from '@/lib/imports/ui/inbox'

/**
 * «Te toca»: lo que hay que hacer AHORA en «Importar», en una oración, con el
 * único botón primario de la pantalla al lado (debajo y a todo el ancho en el
 * celular).
 *
 * Es la misma regla de «Hoy te toca» del Resumen (`buildInbox().next`): si acá
 * dice que toca subir Mercado Pago, allá también. Solo lo ve quien puede cargar
 * (la página no lo monta en solo lectura). Server-safe.
 */
export function NextUp({ next }: { next: InboxNext }) {
  return (
    <Panel className="border-warning/40 bg-warning/6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-2">
          <StatusPill tone="warn">Te toca</StatusPill>
          <p className="font-serif text-xl font-semibold leading-snug tracking-tight text-pretty sm:text-2xl">
            {next.sentence}
          </p>
        </div>
        <Button asChild className="h-12 w-full shrink-0 gap-2 px-5 text-base sm:w-auto">
          <Link href={next.action.href}>
            {next.action.label}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
    </Panel>
  )
}

/** Sin nada que toque: una línea que dice que está al día y cuándo vuelve a tocar. */
export function AgendaLine({ agenda }: { agenda: string }) {
  return (
    <p className="text-sm text-muted-foreground text-pretty">
      <span className="font-medium text-foreground">Estás al día.</span> {agenda}
    </p>
  )
}
