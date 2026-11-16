'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, RefreshCw } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { forceCartaRefresh } from '@/lib/menu/actions'
import type { MenuRevisionStatus } from '@/lib/menu/revision'

/** «recién», «hace 3 minutos», «hace 2 días». `null` si no hay fecha. */
function ago(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  // Menos de un minuto (o un reloj atrasado que la pone en el futuro): no hace falta el detalle.
  if (Date.now() - date.getTime() < 60_000) return 'recién'
  return formatDistanceToNowStrict(date, { locale: es, addSuffix: true })
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return Date.parse(a) === Date.parse(b)
}

/** Lo más nuevo entre lo que trajo la página y lo que devolvió el botón. */
function newest(
  fromPage: MenuRevisionStatus | null,
  fromButton: MenuRevisionStatus | null,
): MenuRevisionStatus | null {
  if (!fromPage) return fromButton
  if (!fromButton) return fromPage
  return fromButton.rev >= fromPage.rev ? fromButton : fromPage
}

/**
 * «Último cambio: hace 3 minutos». Vive adentro del popover, que se monta al abrirse: así el «hace»
 * se calcula cuando se mira y no cuando cargó la página.
 */
function StatusLines({ status }: { status: MenuRevisionStatus | null }): React.JSX.Element | null {
  if (!status) return null
  const lastChange = ago(status.changedAt)
  const lastChangeWasManual = sameInstant(status.changedAt, status.forcedAt)
  const lastManual = lastChangeWasManual ? null : ago(status.forcedAt)
  if (!lastChange && !lastManual) return null
  return (
    <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
      {lastChange ? (
        <p>{`Último cambio: ${lastChange}${lastChangeWasManual ? ', a mano' : ''}.`}</p>
      ) : null}
      {lastManual ? <p>{`Última actualización a mano: ${lastManual}.`}</p> : null}
    </div>
  )
}

/**
 * «Actualizar en los celulares» (pedido del socio: «un botón como el de WordPress para borrar el
 * caché»). Ya es automático: cualquier cambio del menú sube la versión de la carta y los celulares
 * que la tienen abierta la recargan al volver a mirarla. El botón la sube a mano, por las dudas.
 * Ver docs/features/carta-al-dia.md.
 */
export function CartaRefreshButton({
  tenantSlug,
  status,
}: {
  tenantSlug: string
  status: MenuRevisionStatus | null
}): React.JSX.Element {
  const [fromButton, setFromButton] = useState<MenuRevisionStatus | null>(null)
  const [pending, start] = useTransition()

  const onRefresh = () => {
    start(async () => {
      try {
        const r = await forceCartaRefresh(tenantSlug)
        if (!r.ok) {
          toast.error(r.message)
          return
        }
        setFromButton({ rev: r.data.rev, changedAt: r.data.changedAt, forcedAt: r.data.changedAt })
        toast.success('Listo: los celulares con la carta abierta la recargan apenas la miren.')
      } catch {
        toast.error('No pudimos actualizar la carta. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="menu-carta-refresh">
          <RefreshCw className="size-4" />
          Actualizar en los celulares
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3" sideOffset={6}>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Carta al día
        </p>
        <p className="text-sm">
          Los cambios llegan solos: cualquiera que vuelva a mirar la carta ve la versión nueva.
        </p>
        <StatusLines status={newest(status, fromButton)} />
        <Button
          size="sm"
          className="mt-3 w-full gap-1.5"
          onClick={onRefresh}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {pending ? 'Actualizando…' : 'Actualizar ahora'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
