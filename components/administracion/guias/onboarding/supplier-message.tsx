import { MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'

/** El mensaje para los proveedores, armado con los datos de la SAS del bar. */
export type SupplierMessageData =
  | { status: 'ready'; message: string; why: string | null }
  /** Faltan la razón social de la SAS (Ajustes › Datos de la SAS). */
  | { status: 'missing' }
  /** No pudimos leer los datos de la SAS. */
  | { status: 'error' }

/**
 * «Pedíselo a tus proveedores»: el mensaje listo para copiar o mandar por
 * WhatsApp (el link abre WhatsApp con el texto; los contactos los elige la
 * persona). Sin datos de la SAS, dice dónde completarlos. Los botones solo
 * para quien carga.
 */
export function SupplierMessage({
  data,
  base,
  canWrite,
}: {
  data: SupplierMessageData
  base: string
  canWrite: boolean
}) {
  if (data.status === 'error') {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        No pudimos leer los datos de la SAS para armar el mensaje. Recargá la página.
      </p>
    )
  }
  if (data.status === 'missing') {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        {canWrite ? 'Completá la razón social en ' : 'Falta la razón social en '}
        <Link
          href={`${base}/ajustes?tab=sas`}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Ajustes › Datos de la SAS
        </Link>
        {canWrite ? ' y te armamos el mensaje.' : '.'}
      </p>
    )
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(data.message)}`
  return (
    <figure className="rounded-lg border border-border/60 bg-secondary/30 p-3 sm:p-4">
      <figcaption className="text-xs font-medium text-muted-foreground">
        El mensaje, listo para mandar
      </figcaption>
      <blockquote className="mt-1.5 text-sm leading-relaxed text-foreground text-pretty">
        {data.message}
      </blockquote>
      {data.why ? (
        <p className="mt-2 text-xs text-muted-foreground text-pretty">{data.why}</p>
      ) : null}
      {canWrite ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <CopyButton
            value={data.message}
            label="Copiar el mensaje"
            copiedLabel="Copiado"
            className="h-11 w-full sm:w-auto md:h-9"
          />
          <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-auto md:h-9">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              Mandarlo por WhatsApp
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </Button>
        </div>
      ) : null}
    </figure>
  )
}
