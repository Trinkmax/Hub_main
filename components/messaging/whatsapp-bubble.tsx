type BubbleButton = { id: string; text: string }

/**
 * Burbuja estilo WhatsApp para previsualizar una plantilla o mensaje.
 * Presentacional puro (server o client). La usan el creador de plantillas, el
 * armado de difusiones y el envío de mensajes aprobados desde el chat.
 *
 * Es una foto del WhatsApp del teléfono en modo oscuro: los colores son los
 * de WhatsApp a propósito (no siguen el tema del panel). Del kit toma el piso
 * de 12 px y el contraste del pie (blanco al 70 % sobre el verde da 4,8:1).
 */
export function WhatsAppBubble({
  header,
  body,
  footer,
  buttons = [],
  placeholder = 'Tu mensaje aparecerá acá…',
}: {
  header?: string | null
  body: string
  footer?: string | null
  buttons?: BubbleButton[]
  placeholder?: string
}) {
  return (
    <div className="space-y-1 rounded-xl bg-[#0b141a] p-3">
      <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-sm bg-[#005c4b] px-3 py-2 text-sm text-white shadow">
        {header ? <p className="mb-1 font-semibold leading-snug">{header}</p> : null}
        <p className="whitespace-pre-wrap break-words leading-snug">{body || placeholder}</p>
        {footer ? <p className="mt-1 text-xs text-white/70">{footer}</p> : null}
        <span className="mt-1 block text-right text-xs text-white/60" aria-hidden="true">
          14:32
        </span>
      </div>
      {buttons.length > 0 ? (
        <div className="space-y-0.5">
          {buttons.map((b) => (
            <div
              key={b.id}
              className="rounded-lg bg-[#1f2c34] px-3 py-1.5 text-center text-[13px] font-medium text-[#53bdeb]"
            >
              {b.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
