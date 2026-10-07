import type { StatusMap } from '@/components/ui/status-badge'

/**
 * Estado de un canal de Meta (WhatsApp, Instagram) para `StatusBadge`. Vive
 * acá hasta que exista `lib/meta/status-meta.ts` (el lote no toca `lib/`).
 */
export type ChannelStatusKey = 'connected' | 'disconnected' | 'error'

export const CHANNEL_STATUS: StatusMap<ChannelStatusKey> = {
  connected: {
    label: 'Conectado',
    tone: 'success',
    description: 'Los mensajes entran y salen con normalidad.',
  },
  error: {
    label: 'Necesita atención',
    tone: 'danger',
    description: 'La conexión se cortó: los mensajes no están entrando ni saliendo.',
  },
  disconnected: {
    label: 'Sin conectar',
    tone: 'neutral',
    description: 'Todavía no está conectado.',
  },
}
