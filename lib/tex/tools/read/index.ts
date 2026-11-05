import 'server-only'

import type { TexTool } from '../types'
import { ajustesReadTools } from './ajustes'
import { cajasReadTools } from './cajas'
import { comprasReadTools } from './compras'
import { gastosReadTools } from './gastos'
import { librosReadTools } from './libros'
import { resumenReadTools } from './resumen'
import { ventasReadTools } from './ventas'

/** Lo que Tex puede mirar. Cada archivo es un área; el orden es fijo (ver `registry.ts`). */
export const texReadTools: readonly TexTool[] = [
  ...resumenReadTools,
  ...cajasReadTools,
  ...comprasReadTools,
  ...gastosReadTools,
  ...ventasReadTools,
  ...librosReadTools,
  ...ajustesReadTools,
]
