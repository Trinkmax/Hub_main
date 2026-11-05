import 'server-only'

import { documentExecutor } from './document-action'
import { texActionTools, texExecutors } from './tools/actions'
import { texReadTools } from './tools/read'
import type { TexExecutor, TexTool, TexToolContext } from './tools/types'
import { uiTools } from './tools/ui'

/**
 * Todas las herramientas de Tex, en un orden fijo: el caché de la API depende de que la lista sea
 * exactamente la misma entre un pedido y otro.
 */
const ALL_TOOLS: readonly TexTool[] = [...uiTools, ...texReadTools, ...texActionTools]

const EXECUTORS: Readonly<Record<string, TexExecutor>> = {
  document: documentExecutor,
  ...texExecutors,
}

export function texExecutor(name: string): TexExecutor | null {
  return EXECUTORS[name] ?? null
}

function allowed(tool: TexTool, ctx: TexToolContext): boolean {
  if (tool.need === 'read') return ctx.access.read
  if (tool.need === 'write') return ctx.access.write
  return ctx.access.write || ctx.isAccountant
}

export function texToolsFor(ctx: TexToolContext): TexTool[] {
  return ALL_TOOLS.filter((tool) => allowed(tool, ctx))
}

/** El nombre lindo de un paso ya hecho, para volver a dibujar una charla guardada. */
export function texStepLabel(name: string, input: unknown): string {
  const tool = ALL_TOOLS.find((t) => t.name === name)
  if (!tool) return 'Miré algo'
  const parsed = tool.input.safeParse(input)
  return parsed.success ? tool.done(parsed.data) : tool.done(input)
}
