import { EyeOff, PackageX } from 'lucide-react'
import type { StatusMap } from '@/components/ui/status-badge'

/*
 * Mapas de estado del Club de beneficios (kit HUB §3.4: un estado dice lo
 * mismo y tiene el mismo tono en toda la app). Viven acá mientras el lote del
 * club no puede tocar `lib/`; el destino es `lib/points/status-meta.ts`.
 */

export type ActiveState = 'active' | 'inactive'

/** Nivel del club. */
export const TIER_STATUS: StatusMap<ActiveState> = {
  active: { label: 'Activo', tone: 'success' },
  inactive: {
    label: 'Inactivo',
    tone: 'neutral',
    description: 'No se asigna ni se muestra al socio.',
  },
}

/** Regla de puntos. */
export const RULE_STATUS: StatusMap<ActiveState> = {
  active: { label: 'Activa', tone: 'success' },
  inactive: {
    label: 'Pausada',
    tone: 'neutral',
    description: 'No suma puntos hasta que la reactives.',
  },
}

/** Marca aliada: oculta es el motivo número uno de «no se ve nada en la billetera». */
export const PARTNER_STATUS: StatusMap<'visible' | 'hidden'> = {
  visible: { label: 'Visible', tone: 'success' },
  hidden: {
    label: 'Oculta · no se ve en la billetera',
    tone: 'warning',
    description: 'Prendé el interruptor para publicarla.',
  },
}

/** Punch card. */
export const PUNCH_STATUS: StatusMap<'on' | 'off'> = {
  on: { label: 'Prendida', tone: 'success' },
  off: {
    label: 'Apagada',
    tone: 'warning',
    description: 'No aparece en la billetera y nadie suma sellos nuevos.',
  },
}

/** Marcas de una recompensa del catálogo (pueden ir varias juntas). */
export const REWARD_FLAG: StatusMap<'paused' | 'hidden' | 'sold-out'> = {
  paused: {
    label: 'Pausada',
    tone: 'neutral',
    description: 'No se puede canjear hasta que la reactives.',
  },
  hidden: {
    label: 'Oculta',
    tone: 'neutral',
    icon: EyeOff,
    description: 'Sigue vigente, pero no aparece en la carta pública.',
  },
  'sold-out': {
    label: 'Sin stock',
    tone: 'warning',
    icon: PackageX,
    description: 'Se muestra agotada y nadie puede canjearla.',
  },
}
