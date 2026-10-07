import type { StatusMap } from '@/components/ui/status-badge'

/*
 * Mapas de estado de la carta (kit HUB §3.4). Viven acá mientras el lote de la
 * carta no puede tocar `lib/`; el destino es `lib/menu/status-meta.ts`.
 */

export type MenuActiveState = 'active' | 'paused'

/** Categoría de la carta. */
export const CATEGORY_STATUS: StatusMap<MenuActiveState> = {
  active: { label: 'Activa', tone: 'success' },
  paused: {
    label: 'Pausada',
    tone: 'neutral',
    description: 'No se ve en la carta pública, con todo lo que tiene adentro.',
  },
}

/** Ítem de la carta. */
export const ITEM_STATUS: StatusMap<MenuActiveState> = {
  active: { label: 'Disponible', tone: 'success' },
  paused: {
    label: 'Pausado',
    tone: 'neutral',
    description: 'Oculto para el cliente hasta que lo actives.',
  },
}
