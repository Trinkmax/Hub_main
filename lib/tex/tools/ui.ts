import { z } from 'zod'
import { TEX_SCREENS, type TexScreenDef, texScreen, texScreenHref } from '../screens'
import { defineTool, type TexTool } from './types'

/**
 * Lo que Tex hace con la pantalla de la persona: llevarla a otro lado, señalar algo y mostrarle un
 * recorrido. No toca la base. Las rutas salen de la lista cerrada de `screens.ts`.
 */

const screenParams = {
  id: z
    .string()
    .optional()
    .describe(
      'El id, en las pantallas de una sola cosa (un comprobante, un proveedor, una cuenta).',
    ),
  mes: z.string().optional().describe('Mes yyyy-MM.'),
  cuenta: z.string().optional().describe('El id de una cuenta, en el Mayor.'),
  desde: z.string().optional().describe('Fecha yyyy-MM-dd.'),
  hasta: z.string().optional().describe('Fecha yyyy-MM-dd.'),
  semana: z.string().optional().describe('El lunes de la semana, yyyy-MM-dd.'),
  fecha: z
    .string()
    .optional()
    .describe('El día, yyyy-MM-dd, en las pantallas que abren en un día.'),
  tab: z.string().optional().describe('La solapa. Cada pantalla dice las suyas.'),
  q: z.string().max(60).optional().describe('Lo que se busca, en las pantallas con buscador.'),
  chat: z.string().optional().describe('El id de una conversación, para abrir ese chat.'),
  evento: z.string().optional().describe('El id de un formato de evento.'),
  etiqueta: z.string().optional().describe('El id de una etiqueta de clientes.'),
  estrellas: z.string().optional().describe('De 1 a 5, para ver solo esas reseñas.'),
}

/** Quien llegó hasta Tex: las pantallas ya vienen filtradas por lo que ve cada uno. */
const ANYONE = { roles: ['owner', 'editor', 'host', 'accountant'] } as const

/** Las herramientas de pantalla, con las pantallas que ve esta persona. */
export function uiToolsFor(screens: readonly TexScreenDef[]): TexTool[] {
  const screenId = z
    .enum(screens.map((screen) => screen.id) as [string, ...string[]])
    .describe('La pantalla, de la lista «Pantallas».')
  return [
    defineTool({
      name: 'ir_a',
      description:
        'Lleva a la persona a una pantalla, ya mismo. Usala cuando pregunta dónde está algo, cuando pide que la lleves o para mostrarle lo que acabás de hacer. Después de esto ya está viendo esa pantalla.',
      input: z.object({
        pantalla: screenId,
        ...screenParams,
        senalar: z
          .string()
          .max(80)
          .optional()
          .describe(
            'Un texto visible en esa pantalla para señalarlo al llegar: un botón, una columna, un nombre.',
          ),
        nota: z
          .string()
          .max(160)
          .optional()
          .describe('Lo que le decís al señalarlo, en una oración.'),
      }),
      need: ANYONE,
      core: true,
      mood: 'working',
      doing: (input) => `Yendo a ${texScreen(input.pantalla)?.label ?? 'esa pantalla'}`,
      done: (input) => `Fuimos a ${texScreen(input.pantalla)?.label ?? 'esa pantalla'}`,
      run: async (input, ctx) => {
        const link = texScreenHref(ctx.slug, input.pantalla, input)
        if (!link.ok) return { kind: 'error', message: link.error }
        return {
          kind: 'data',
          data: { listo: true, ya_esta_en: link.label },
          events: [
            { type: 'navigate', href: link.href, label: link.label },
            ...(input.senalar
              ? [{ type: 'point' as const, text: input.senalar, note: input.nota ?? null }]
              : []),
          ],
        }
      },
    }),

    defineTool({
      name: 'senalar',
      description:
        'Señala algo que está a la vista en la pantalla actual: Tex va hasta ahí y lo marca. Pasale un texto que se lea tal cual en pantalla (un botón, una columna, un nombre, un importe).',
      input: z.object({
        texto: z.string().min(1).max(80).describe('El texto, tal cual se lee en pantalla.'),
        nota: z
          .string()
          .max(160)
          .optional()
          .describe('Lo que le decís al señalarlo, en una oración.'),
      }),
      need: ANYONE,
      core: true,
      mood: 'working',
      doing: (input) => `Señalando «${input.texto}»`,
      done: (input) => `Señalé «${input.texto}»`,
      run: async (input) => ({
        kind: 'data',
        data: { listo: true },
        events: [{ type: 'point', text: input.texto, note: input.nota ?? null }],
      }),
    }),

    defineTool({
      name: 'mostrar_pasos',
      description:
        'Muestra cómo se hace algo en el sistema, paso a paso: Tex va pantalla por pantalla señalando cada cosa y la persona avanza con «Seguir». Usala cuando pregunta cómo se hace algo y prefiere hacerlo a mano. De 2 a 6 pasos.',
      input: z.object({
        titulo: z.string().min(1).max(80).describe('Qué se está mostrando.'),
        pasos: z
          .array(
            z.object({
              pantalla: screenId
                .optional()
                .describe('A dónde ir en este paso; sin esto, se queda ahí.'),
              senalar: z
                .string()
                .max(80)
                .optional()
                .describe('El texto que se señala en pantalla.'),
              nota: z.string().min(1).max(200).describe('Qué hacer en este paso, en una oración.'),
            }),
          )
          .min(2)
          .max(6),
      }),
      need: ANYONE,
      core: true,
      mood: 'working',
      doing: (input) => `Armando «${input.titulo}»`,
      done: (input) => `Mostré «${input.titulo}»`,
      run: async (input, ctx) => {
        const steps = []
        for (const paso of input.pasos) {
          let href: string | null = null
          if (paso.pantalla) {
            const link = texScreenHref(ctx.slug, paso.pantalla)
            if (!link.ok) return { kind: 'error', message: link.error }
            href = link.href
          }
          steps.push({ href, point: paso.senalar ?? null, note: paso.nota })
        }
        return {
          kind: 'data',
          data: { listo: true, pasos: steps.length },
          events: [{ type: 'guide', title: input.titulo, steps }],
        }
      },
    }),
  ]
}

/** Con todas las pantallas: para reconocer los nombres de una charla guardada y en los tests. */
export const uiTools = uiToolsFor(TEX_SCREENS)
