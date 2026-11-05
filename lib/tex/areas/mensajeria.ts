import 'server-only'

import type { TexArea } from './types'

export const mensajeriaArea: TexArea = {
  id: 'mensajeria',
  label: 'Mensajería y Marketing',
  summary:
    'El WhatsApp del bar: bandeja, difusiones, audiencias, automatizaciones y plantillas. Las tareas de marketing.',
  manual: '',
  tools: [],
  executors: {},
  visible: (ctx) => ctx.role === 'owner',
}
