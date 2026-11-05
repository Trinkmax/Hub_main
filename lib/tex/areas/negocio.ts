import 'server-only'

import type { TexArea } from './types'

export const negocioArea: TexArea = {
  id: 'negocio',
  label: 'Carta, Estadísticas y Configuración',
  summary:
    'La carta, los números del negocio, las reseñas, las páginas y la configuración del bar.',
  manual: '',
  tools: [],
  executors: {},
  visible: (ctx) => ctx.role === 'owner' || ctx.role === 'editor',
}
