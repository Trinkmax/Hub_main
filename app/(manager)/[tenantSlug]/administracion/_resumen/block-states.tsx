import { PanelError as KitPanelError } from '@/components/administracion/kit/panel-states'

// El link callado de un panel es el del kit, tal cual.
export { PanelLink } from '@/components/administracion/kit/panel-states'

/**
 * El motivo de un error, dicho para el Resumen. Las lecturas comparten sus
 * mensajes con los reportes, y el de «tardó demasiado» sugiere probar «con un
 * período más corto»: acá no hay ningún período para elegir, así que esa
 * parte se saca. El resto del mensaje va tal cual.
 */
export function homeErrorText(message: string): string {
  return message.replace(' o con un período más corto', '')
}

/**
 * Un bloque del Resumen que no se pudo leer: es el `PanelError` del kit
 * (conserva su lugar y su título, dice por qué y ofrece reintentar), con el
 * motivo dicho para esta pantalla (`homeErrorText`). En las demás pantallas se
 * usa el del kit directo.
 */
export function PanelError({
  title,
  message,
  className,
}: {
  title: string
  message: string
  className?: string
}) {
  return <KitPanelError title={title} message={homeErrorText(message)} className={className} />
}
