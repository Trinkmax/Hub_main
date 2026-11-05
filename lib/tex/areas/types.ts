import type { TexExecutor, TexTool, TexToolContext } from '../tools/types'

/**
 * Un área del panel para Tex: lo que sabe (`manual`, que lee cuando hace falta), lo que hace y quién la ve.
 * Las pantallas van aparte (`lib/tex/area-screens/`), porque son puras.
 */
export type TexArea = {
  id: string
  label: string
  /** Una línea: qué hay en esta área. Va siempre en las instrucciones. */
  summary: string
  /** Cómo funciona, las reglas y las palabras de esta área. Tex lo lee con `leer_manual`. */
  manual: string
  tools: readonly TexTool[]
  executors: Readonly<Record<string, TexExecutor>>
  /** ¿Esta persona ve esta área? Las mismas reglas que el menú. */
  visible: (ctx: TexToolContext) => boolean
}
