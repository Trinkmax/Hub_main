import 'server-only'

import { clientesActionTools, clientesExecutors } from '../tools/clientes/actions'
import { clubActionTools, clubExecutors } from '../tools/clientes/club-actions'
import { clientesManual } from '../tools/clientes/manual'
import { clientesReadTools } from '../tools/clientes/read'
import type { TexArea } from './types'

export const clientesArea: TexArea = {
  id: 'clientes',
  label: 'Clientes y Club',
  summary:
    'Los clientes del bar, sus puntos, visitas, etiquetas y canjes, y el club: niveles, reglas de puntos, recompensas, aliados y punch cards.',
  manual: clientesManual,
  tools: [...clientesReadTools, ...clientesActionTools, ...clubActionTools],
  executors: { ...clientesExecutors, ...clubExecutors },
  visible: (ctx) => ctx.role === 'owner',
}
