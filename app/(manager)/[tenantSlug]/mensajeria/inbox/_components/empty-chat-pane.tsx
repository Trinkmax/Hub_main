import { Lock, MessageCircle, Star, Unplug } from 'lucide-react'

/** Panel derecho cuando no hay chat elegido, estilo pantalla de inicio de WhatsApp Web. */
export function EmptyChatPane({
  hasConversations,
  channelConnected,
}: {
  hasConversations: boolean
  channelConnected: boolean
}) {
  return (
    <div className="relative hidden h-full flex-col items-center justify-center gap-4 border-b-[6px] border-(--wa-accent) bg-(--wa-panel-soft) px-8 text-center md:flex">
      <div className="relative">
        <span className="flex size-24 items-center justify-center rounded-full bg-(--wa-panel)">
          <MessageCircle className="size-11 text-(--wa-muted)" strokeWidth={1.5} aria-hidden />
        </span>
        {/* Plano, con un aro del fondo para separarlo del círculo (sin sombra). */}
        <span className="absolute -right-1 -bottom-1 flex size-9 items-center justify-center rounded-full bg-(--wa-accent-deep) text-(--wa-panel) ring-4 ring-(--wa-panel-soft)">
          <Star className="size-4.5" aria-hidden />
        </span>
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-2xl font-light text-(--wa-text)">Tus chats con clientes</h2>
        <p className="text-sm leading-relaxed text-(--wa-muted)">
          {hasConversations
            ? 'Elegí una charla de la izquierda para responder. Al lado de cada cliente vas a ver sus puntos, visitas y categoría del club.'
            : 'Cuando un cliente te escriba por WhatsApp o Instagram, la charla aparece acá, con sus puntos y visitas al lado.'}
        </p>
      </div>
      <p className="absolute bottom-8 flex items-center gap-1.5 text-xs text-(--wa-muted)">
        {channelConnected ? (
          <>
            <Lock className="size-3" aria-hidden />
            Conectado a tu cuenta de WhatsApp Business
          </>
        ) : (
          <>
            <Unplug className="size-3" aria-hidden />
            Todavía no conectaste tu WhatsApp: hacelo desde Ajustes, en Canales conectados.
          </>
        )}
      </p>
    </div>
  )
}
