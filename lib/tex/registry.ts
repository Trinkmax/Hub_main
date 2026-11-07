import 'server-only'

import { z } from 'zod'
import { administracionArea } from './areas/administracion'
import { agendaArea } from './areas/agenda'
import { clientesArea } from './areas/clientes'
import { mensajeriaArea } from './areas/mensajeria'
import { negocioArea } from './areas/negocio'
import { pedidosArea } from './areas/pedidos'
import type { TexArea } from './areas/types'
import { type TexScreenDef, texScreensFor } from './screens'
import { defineTool, type TexExecutor, type TexTool, type TexToolContext } from './tools/types'
import { uiTools, uiToolsFor } from './tools/ui'

/**
 * Todo lo que sabe hacer Tex, por área, en un orden fijo: el caché de la API depende de que la lista
 * sea exactamente la misma entre un pedido y otro.
 */
export const TEX_AREAS: readonly TexArea[] = [
  administracionArea,
  clientesArea,
  mensajeriaArea,
  agendaArea,
  negocioArea,
  pedidosArea,
]

export function texExecutor(name: string): TexExecutor | null {
  for (const area of TEX_AREAS) {
    const executor = area.executors[name]
    if (executor) return executor
  }
  return null
}

function allowed(tool: TexTool, ctx: TexToolContext): boolean {
  const { need } = tool
  if (need === 'read') return ctx.access.read
  if (need === 'write') return ctx.access.write
  if (need === 'poster') return ctx.access.write || ctx.isAccountant
  if (need.feature && !ctx.features[need.feature]) return false
  return need.roles.includes(ctx.role)
}

export function texAreasFor(ctx: TexToolContext): TexArea[] {
  return TEX_AREAS.filter((area) => area.visible(ctx))
}

export function texScreensForContext(ctx: TexToolContext): TexScreenDef[] {
  return texScreensFor({ role: ctx.role, features: ctx.features, accounting: ctx.access.read })
}

/** El manual de un área: se lee cuando hace falta, para no cargarlo en cada mensaje. */
function manualTool(areas: readonly TexArea[]): TexTool {
  return defineTool({
    name: 'leer_manual',
    description:
      'El manual de un área: cómo funciona, las reglas, las recetas paso a paso y las palabras que se usan. Leelo antes de explicar cómo funciona algo o cómo se hace, y antes de contestar algo de lo que no estés seguro.',
    input: z.object({
      area: z
        .enum(areas.map((area) => area.id) as [string, ...string[]])
        .describe('El área, de la lista «Áreas».'),
    }),
    need: { roles: ['owner', 'editor', 'host', 'accountant'] },
    core: true,
    doing: () => 'Repasando cómo funciona',
    done: () => 'Repasé cómo funciona',
    run: async (input) => {
      const area = areas.find((a) => a.id === input.area)
      return {
        kind: 'data',
        data: { manual: area?.manual ?? '' },
        limit: 40_000,
      }
    },
  })
}

/** Lo que puede usar esta persona: las de pantalla y el manual siempre; el resto, según su rol. */
export function texToolsFor(ctx: TexToolContext): TexTool[] {
  const areas = texAreasFor(ctx)
  return [
    ...uiToolsFor(texScreensForContext(ctx)),
    manualTool(areas),
    ...areas.flatMap((area) => area.tools).filter((tool) => allowed(tool, ctx)),
  ]
}

const ALL_TOOLS: readonly TexTool[] = [...uiTools, ...TEX_AREAS.flatMap((area) => area.tools)]

/** El nombre lindo de un paso ya hecho, para volver a dibujar una charla guardada. */
export function texStepLabel(name: string, input: unknown): string {
  if (name === 'leer_manual') return 'Repasé cómo funciona'
  const tool = ALL_TOOLS.find((t) => t.name === name)
  if (!tool) return 'Miré algo'
  const parsed = tool.input.safeParse(input)
  return parsed.success ? tool.done(parsed.data) : tool.done(input)
}
