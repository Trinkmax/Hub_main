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

/**
 * Corre el cursor fuera de un `{{n}}` si cayó adentro.
 *
 * Sin esto, tocar un botón de variable con el cursor en medio de otra
 * (`{{|1}}`) escupía `{{{{2}}1}}` — texto roto que el dueño tiene que
 * arreglar a mano sin entender qué pasó.
 */
export function caretOutsideVariable(text: string, position: number): number {
  for (const match of text.matchAll(VAR_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (position > start && position < end) return end
  }
  return position
}

/**
 * Renumera las variables del texto para que queden 1, 2, 3… en orden de
 * aparición, arrastrando ejemplos y significados.
 *
 * Meta exige numeración contigua desde 1. Si el dueño borra el `{{1}}` del
 * medio del texto le queda `{{2}} {{3}}` y el alta se rechaza por una regla
 * que no tiene por qué conocer. Corriendo esto en cada tecleada, el problema
 * no puede existir. Una variable repetida (`{{1}}` dos veces) sigue siendo la
 * misma después de renumerar.
 */
export function renumberPositionalVars(
  text: string,
  prev: { examples: string[]; hints: Record<string, string> },
): { text: string; examples: string[]; hints: Record<string, string> } {
  const order: number[] = []
  for (const match of text.matchAll(VAR_RE)) {
    const n = Number(match[1])
    if (!order.includes(n)) order.push(n)
  }

  const oldToNew = new Map(order.map((old, i) => [old, i + 1]))
  const nextText = text.replace(VAR_RE, (match, digits) => {
    const mapped = oldToNew.get(Number(digits))
    return mapped ? `{{${mapped}}}` : match
  })

  const examples = order.map((old) => prev.examples[old - 1] ?? '')
  const hints: Record<string, string> = {}
  order.forEach((old, i) => {
    const hint = prev.hints[String(old)]
    if (hint) hints[String(i + 1)] = hint
  })

  return { text: nextText, examples, hints }
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

/**
 * Parsea los `components` de una plantilla ya sincronizada de Meta (formato
 * HEADER/BODY/FOOTER/BUTTONS) a partes simples, para preview.
 */
export function parseMetaComponents(components: unknown): {
  header: string | null
  body: string
  footer: string | null
  buttons: string[]
} {
  const arr = Array.isArray(components) ? components : []
  const find = (type: string) =>
    arr.find(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        String((c as { type?: string }).type).toUpperCase() === type,
    ) as { text?: string; buttons?: Array<{ text?: string }> } | undefined

  const header = find('HEADER')
  const body = find('BODY')
  const footer = find('FOOTER')
  const buttons = find('BUTTONS')

  return {
    header: header?.text?.trim() ? header.text : null,
    body: body?.text ?? '',
    footer: footer?.text?.trim() ? footer.text : null,
    buttons: (buttons?.buttons ?? []).map((b) => b?.text ?? '').filter((t) => t.length > 0),
  }
}
