import 'server-only'

import type { TexArea } from './types'

export const agendaArea: TexArea = {
  id: 'agenda',
  label: 'Reservas, Calendario y Entradas',
  summary:
    'Las reservas, los eventos del calendario, el tablero de la noche y la venta de entradas.',
  manual: '',
  tools: [],
  executors: {},
  visible: (ctx) => ctx.role === 'owner' || ctx.role === 'host',
}
