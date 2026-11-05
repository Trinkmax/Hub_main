import 'server-only'

import { negocioManual } from '../tools/negocio/_manual'
import { cartaExecutors, cartaTools } from '../tools/negocio/carta'
import { configuracionExecutors, configuracionTools } from '../tools/negocio/configuracion'
import { numerosTools } from '../tools/negocio/numeros'
import type { TexArea } from './types'

export const negocioArea: TexArea = {
  id: 'negocio',
  label: 'Carta, Estadísticas y Configuración',
  summary:
    'La carta, los números del negocio, las reseñas, las páginas y la configuración del bar. Su manual tiene el mapa de todo el panel.',
  manual: negocioManual,
  tools: [...cartaTools, ...numerosTools, ...configuracionTools],
  executors: { ...cartaExecutors, ...configuracionExecutors },
  visible: (ctx) => ctx.role === 'owner' || ctx.role === 'editor',
}
