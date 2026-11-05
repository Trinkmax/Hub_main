import 'server-only'

import { audienciasExecutors, audienciasTools } from '../tools/mensajeria/audiencias'
import { bandejaExecutors, bandejaTools } from '../tools/mensajeria/bandeja'
import { difusionesExecutors, difusionesTools } from '../tools/mensajeria/difusiones'
import { flowsExecutors, flowsTools } from '../tools/mensajeria/flows'
import { MENSAJERIA_MANUAL } from '../tools/mensajeria/manual'
import { tareasExecutors, tareasTools } from '../tools/mensajeria/tareas'
import type { TexArea } from './types'

export const mensajeriaArea: TexArea = {
  id: 'mensajeria',
  label: 'Mensajería y Marketing',
  summary:
    'El WhatsApp del bar: bandeja, difusiones, audiencias, automatizaciones y plantillas. Las tareas de marketing.',
  manual: MENSAJERIA_MANUAL,
  // El orden es fijo: el caché de la API depende de que la lista sea siempre la misma.
  tools: [...bandejaTools, ...difusionesTools, ...audienciasTools, ...flowsTools, ...tareasTools],
  executors: {
    ...bandejaExecutors,
    ...difusionesExecutors,
    ...audienciasExecutors,
    ...flowsExecutors,
    ...tareasExecutors,
  },
  visible: (ctx) => ctx.role === 'owner',
}
