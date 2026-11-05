import 'server-only'

import type { TexArea } from './types'

export const clientesArea: TexArea = {
  id: 'clientes',
  label: 'Clientes y Club',
  summary: 'Los clientes del bar, sus puntos y visitas, y el programa de fidelización.',
  manual: '',
  tools: [],
  executors: {},
  visible: (ctx) => ctx.role === 'owner',
}
