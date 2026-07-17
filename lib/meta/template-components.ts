/**
 * Construcción y validación de componentes de plantillas de WhatsApp.
 *
 * Puro (sin `server-only`): lo usan el schema (validación), el creador de
 * plantillas (payload a Meta) y el preview del cliente. El contrato sigue la
 * doc oficial de Meta: variables POSICIONALES (`{{1}}`, `{{2}}`…) con ejemplos
 * en `example.body_text` / `example.header_text`, y botones QUICK_REPLY / URL.
 */

export type TemplateButtonInput =
  | { type: 'quick_reply'; text: string }
  | { type: 'url'; text: string; url: string }

export type TemplateComponentsInput = {
  bodyText: string
  bodyExamples?: string[]
  headerText?: string | null
  headerExample?: string | null
  footerText?: string | null
  buttons?: TemplateButtonInput[]
}

export type MetaComponent =
  | { type: 'HEADER'; format: 'TEXT'; text: string; example?: { header_text: string[] } }
  | { type: 'BODY'; text: string; example?: { body_text: string[][] } }
  | { type: 'FOOTER'; text: string }
  | {
      type: 'BUTTONS'
      buttons: Array<
        { type: 'QUICK_REPLY'; text: string } | { type: 'URL'; text: string; url: string }
      >
    }

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g

/** Números de variable posicional únicos que aparecen en el texto, ordenados. */
export function extractPositionalVars(text: string): number[] {
  const nums = new Set<number>()
  for (const match of text.matchAll(VAR_RE)) {
    nums.add(Number(match[1]))
  }
  return [...nums].sort((a, b) => a - b)
}

/** true si los números son exactamente 1, 2, 3… sin huecos (o si está vacío). */
export function isContiguousFrom1(nums: number[]): boolean {
  return nums.every((n, i) => n === i + 1)
}

/** Reemplaza `{{n}}` por su ejemplo (o deja el placeholder si falta). Para preview. */
export function fillExamples(text: string, examples: string[]): string {
  return text.replace(VAR_RE, (_match, digits) => {
    const example = examples[Number(digits) - 1]
    return example?.trim() ? example.trim() : `{{${digits}}}`
  })
}

/**
 * Arma el array `components` para el POST a Meta. Asume input ya validado por el
 * schema. Devuelve `parameterFormat: 'positional'` si hay alguna variable, para
 * setear `parameter_format` en el payload.
 */
export function buildTemplateComponents(input: TemplateComponentsInput): {
  components: MetaComponent[]
  parameterFormat?: 'positional'
} {
  const components: MetaComponent[] = []
  let usesVars = false

  const headerText = input.headerText?.trim()
  if (headerText) {
    const header: Extract<MetaComponent, { type: 'HEADER' }> = {
      type: 'HEADER',
      format: 'TEXT',
      text: headerText,
    }
    if (extractPositionalVars(headerText).length > 0 && input.headerExample?.trim()) {
      header.example = { header_text: [input.headerExample.trim()] }
      usesVars = true
    }
    components.push(header)
  }

  const body: Extract<MetaComponent, { type: 'BODY' }> = { type: 'BODY', text: input.bodyText }
  if (extractPositionalVars(input.bodyText).length > 0) {
    body.example = { body_text: [(input.bodyExamples ?? []).map((e) => e.trim())] }
    usesVars = true
  }
  components.push(body)

  const footerText = input.footerText?.trim()
  if (footerText) {
    components.push({ type: 'FOOTER', text: footerText })
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) =>
        b.type === 'url'
          ? { type: 'URL' as const, text: b.text, url: b.url }
          : { type: 'QUICK_REPLY' as const, text: b.text },
      ),
    })
  }

  return usesVars ? { components, parameterFormat: 'positional' } : { components }
}
