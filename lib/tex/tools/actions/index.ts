import 'server-only'

import type { TexExecutor, TexTool } from '../types'
import { cajasActionTools, cajasExecutors } from './cajas'
import { comprasActionTools, comprasExecutors } from './compras'
import { contabilidadActionTools, contabilidadExecutors } from './contabilidad'
import { gastosActionTools, gastosExecutors } from './gastos'
import { ventasActionTools, ventasExecutors } from './ventas'

/**
 * Lo que Tex puede preparar. Ninguna de estas herramientas escribe: arman un tique. Los comprobantes
 * se ejecutan con `documentExecutor`; lo demás (un proveedor, un gasto fijo, los objetivos) con un
 * ejecutor de acá, que llama a la misma server action del formulario.
 */
export const texActionTools: readonly TexTool[] = [
  ...comprasActionTools,
  ...ventasActionTools,
  ...cajasActionTools,
  ...gastosActionTools,
  ...contabilidadActionTools,
]

export const texExecutors: Readonly<Record<string, TexExecutor>> = {
  ...comprasExecutors,
  ...ventasExecutors,
  ...cajasExecutors,
  ...gastosExecutors,
  ...contabilidadExecutors,
}
