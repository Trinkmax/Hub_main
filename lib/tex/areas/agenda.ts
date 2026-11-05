import 'server-only'

import { agendaActionTools, agendaExecutors } from '../tools/agenda/actions'
import { agendaManual } from '../tools/agenda/manual'
import { agendaReadTools } from '../tools/agenda/read'
import type { TexArea } from './types'

export const agendaArea: TexArea = {
  id: 'agenda',
  label: 'Reservas, Calendario y Entradas',
  summary:
    'Las reservas, el cupo por servicio, los eventos del calendario, el tablero de la noche, las comisiones, las señas y la venta de entradas.',
  manual: agendaManual,
  tools: [...agendaReadTools, ...agendaActionTools],
  executors: agendaExecutors,
  visible: (ctx) => ctx.role === 'owner' || ctx.role === 'host',
}
