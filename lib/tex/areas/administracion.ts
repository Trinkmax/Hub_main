import 'server-only'

import { documentExecutor } from '../document-action'
import { texActionTools, texExecutors } from '../tools/actions'
import { texReadTools } from '../tools/read'
import { administracionManual } from './administracion-manual'
import type { TexArea } from './types'

export const administracionArea: TexArea = {
  id: 'administracion',
  label: 'Administración',
  summary:
    'La plata del bar: compras, pagos, gastos fijos, sueldos, cierres del día, proyección de ventas, cajas y contabilidad.',
  manual: administracionManual(),
  tools: [...texReadTools, ...texActionTools],
  executors: { document: documentExecutor, ...texExecutors },
  visible: (ctx) => ctx.access.read,
}
