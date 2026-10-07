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
        <span className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full bg-(--wa-accent) text-white shadow-md">
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
            Todavía no conectaste tu WhatsApp: hacelo desde el engranaje → Canales
          </>
        )}
      </p>
    </div>
  )
}
